-- T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD — 지혈 제2벡터 (edit/reschedule/취소 push 경로)
-- ============================================================================
-- ★ 문제(제2 bleed vector): edit/reschedule/취소 라우팅이 호출하는 RPC
--   upsert_reservation_from_source 의 customers ON CONFLICT DO UPDATE `name` 절이
--   기존 non-empty customers.name 을 push 명(별칭 'ok' 등)으로 무조건 override.
--   기존 CASE 는 preserve-on-NULL 만 있고 never-downgrade 미구현 → 현장 정정 본명 재오염.
--   제1벡터 EF 가드(T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD, EF v25 prod-LIVE)와 동일 drift의
--   제2 인스턴스(신규예약 아닌 수정/재예약/취소 push 경로).
--
-- ★ 해소(비파괴 CREATE OR REPLACE, 스키마/트리거 무변경): ON CONFLICT 의 name merge 절만
--   never-downgrade 표준으로 교체. EF 가드와 동형:
--     name = COALESCE(NULLIF(btrim(customers.name),''), NULLIF(btrim(EXCLUDED.name),''), customers.name)
--   ① never-downgrade : 기존 non-empty customers.name = no-touch (override 금지, §4-6 규칙3).
--   ② preserve-on-NULL: 기존값이 빈값/공백일 때만 push 명으로 채움 (§4-2b 불변식3·§4-6 규칙4).
--   ③ create-only     : 신규 고객(행 부재)은 INSERT 로 push 명 초기 적재(불변).
--   push 명은 reservations.customer_real_name 스냅샷(§4-2b 예약시점·표시전용 폴백)으로 착지 — 기존 불변.
--
-- ★ 비파괴 불변식: 함수 signature(18-arg)/반환(UUID)/기타 merge절/취소 fast-path/lifecycle 가드#5/
--   timeline(rmh) upsert/brief_note 배선 全 무변경 = 선행 권위 body(20260708150000)의 strict copy 이며
--   ON CONFLICT customers.name 절만 교체. 인자수 무변경 → DROP 불요(CREATE OR REPLACE 로 ACL 보존).
--   트리거 trg_sync_customer_name 무접촉(정식 mirror cascade). DROP/타입/PK/UNIQUE 변경 0.
--   ⇒ 본 migration 이 upsert_reservation_from_source 의 새 최종 권위 body.
--
-- ★ 계약 근거: DA-20260713-CRM-INGEST-NAME-OVERWRITE-BAN (GO) §L12("도파민-ingest EF/upsert 가
--   기존 non-empty customers.name 덮어쓰기 = NO-GO") + §L40(§4-6 규칙3 override 금지) + never-downgrade
--   판정. RPC upsert 는 CONSULT 가 명시 커버('EF/upsert') → 旣비준 canon 집행이며 신규 계약/재정의 아님.
--   롱레 canon(ingest RPC = customers.name 무접점)으로 foot 수렴.
--
-- ★ 게이트 = 비파괴 DDL + DA GO → 대표게이트 면제(autonomy §3.1). supervisor = DDL-diff only
--   (diff 가 name merge절 교체로 국한됨을 확인). MIG-GATE 4필드 evidence 기입 의무(면제 아님):
--   mig_files / mig_dryrun(No-Persistence Protocol) / mig_ledger_check / mig_rollback.
--   rollback: 20260713150000_foot_rpc_upsert_name_never_downgrade_guard.rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 인자수 무변경(18-arg 동일 signature) → DROP 불요. CREATE OR REPLACE 로 body 교체
-- (기존 ACL/REVOKE 보존). ON CONFLICT customers.name 절만 never-downgrade 로 교체.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system       TEXT,
  p_external_id         TEXT,
  p_clinic_slug         TEXT,
  p_customer_phone      TEXT,
  p_customer_name       TEXT,
  p_reservation_date    DATE,
  p_reservation_time    TIME,
  p_memo                TEXT    DEFAULT NULL,
  p_status              TEXT    DEFAULT 'confirmed',
  p_visit_type          TEXT    DEFAULT 'new',
  p_created_via         TEXT    DEFAULT NULL,
  p_service_id          UUID    DEFAULT NULL,
  p_registrar_id        UUID    DEFAULT NULL,
  p_registrar_name      TEXT    DEFAULT NULL,
  p_customer_real_name  TEXT    DEFAULT NULL,
  p_customer_real_phone TEXT    DEFAULT NULL,
  p_is_companion        BOOLEAN DEFAULT false,
  p_brief_note          TEXT    DEFAULT NULL   -- 18th (末尾): 간략메모(문제성발톱 등). ADDITIVE.
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id      UUID;
  v_customer_id    UUID;
  v_reservation_id UUID;
  v_norm_phone     TEXT;
  v_real_name      TEXT;
  v_created_via    TEXT;
  v_visit_type     TEXT;
  v_cur_status     TEXT;   -- 가드#5: 멱등키 행의 현재 lifecycle 상태(선조회)
  v_memo_clean     TEXT;   -- timeline 가드: btrim + NULLIF empty
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
  -- 가드#5: 풋이 물리동선으로 이미 진행시킨(되돌리기 금지) 상태 집합.
  c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
BEGIN
  -- 1. 입력 검증 (멱등키)
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- (a)② 취소 fast-path (ADDITIVE) — p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release.
  --   ★ self-mint scope(가드#3): source_system=p_source_system AND NOT NULL 인 행만 주소지정.
  --   ★ 멱등(가드#2): 이미 cancelled → 성공 no-op(기존 id 회신).
  --   ★ lifecycle 가드(#5): checked_in/done/no_show → reject(stale cancel clobber 금지).
  --   ★ memo/brief_note: 매핑 제거(timeline-only). 취소는 간략메모/timeline 기록 미대상(AC 범위 외).
  -- ────────────────────────────────────────────────────────────────
  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    SELECT r.id, r.status INTO v_reservation_id, v_cur_status
      FROM public.reservations r
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
     LIMIT 1;

    IF v_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_cur_status = 'cancelled' THEN
      RETURN v_reservation_id;
    END IF;

    IF v_cur_status = ANY (c_inflight_terminal) THEN
      RAISE EXCEPTION 'lifecycle-invalid cancel: reservation % is "%" (in-flight/terminal) — TM cancel rejected (foot physical-flow owns lifecycle)',
        v_reservation_id, v_cur_status
        USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
    END IF;

    -- confirmed/reserved → cancelled 전이 + 슬롯 release. (memo/brief_note 매핑 제거: 다른 컬럼 불변)
    UPDATE public.reservations r
       SET status     = 'cancelled',
           updated_at = now()
     WHERE r.id = v_reservation_id;

    RETURN v_reservation_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 가드#5 (active 재푸시): self-mint 행이 이미 물리동선 진행/취소 상태면 stale edit clobber 금지 → reject.
  -- ────────────────────────────────────────────────────────────────
  SELECT r.status INTO v_cur_status
    FROM public.reservations r
   WHERE r.source_system IS NOT NULL
     AND r.source_system = p_source_system
     AND r.external_id   = p_external_id
   LIMIT 1;

  IF v_cur_status = ANY (c_inflight_terminal) OR v_cur_status = 'cancelled' THEN
    RAISE EXCEPTION 'lifecycle-invalid edit: reservation (%/%) is "%" — TM stale edit rejected (foot physical-flow owns lifecycle)',
      p_source_system, p_external_id, v_cur_status
      USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
  END IF;

  -- 2. 클리닉 조회 (active/upsert 경로)
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  -- 본명/동행명 스냅샷 (§4-2b): customer_real_name 우선 → 후방호환 customer_name 폴백.
  v_real_name := COALESCE(
    NULLIF(btrim(p_customer_real_name), ''),
    NULLIF(btrim(p_customer_name), '')
  );

  -- created_via / visit_type enum 가드 (비-enum → NULL/기본, CHECK 위반 500 차단)
  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  -- 3~4. customer 산출 (discriminator-gated)
  IF p_is_companion THEN
    v_customer_id := NULL;
    v_norm_phone  := NULL;
  ELSE
    v_norm_phone := public.normalize_phone(p_customer_phone);
    INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
    ON CONFLICT (clinic_id, phone) DO UPDATE SET
      -- ★ never-downgrade 가드 (T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD;
      --   DA-20260713 §L12(EF/upsert)·§L40(§4-6 규칙3 override 금지)):
      --   ① 기존 non-empty customers.name = no-touch(override 금지). 착지 CRM은 push명이 별칭/본명
      --      판별 불가(cue_cards 단일 name) → preserve/never-downgrade 기본값.
      --   ② 기존값이 빈값/공백일 때만 non-empty push 명으로 채움(preserve-on-NULL).
      --   push 명은 reservations.customer_real_name 스냅샷으로 착지(유실 방지). EF 가드(제1벡터)와 동형.
      name = COALESCE(NULLIF(btrim(customers.name), ''), NULLIF(btrim(EXCLUDED.name), ''), customers.name),
      updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 멱등.
  --   ★ reservations.memo 매핑 제거(timeline-only). brief_note(간략메모)는 FE read SoT → 배선(ADDITIVE).
  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time,
    visit_type, status,
    source_system, external_id,
    created_via, service_id, registrar_id, registrar_name,
    customer_real_name, brief_note
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'),
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name, NULLIF(btrim(p_brief_note),'')
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id        = EXCLUDED.customer_id,
    customer_name      = EXCLUDED.customer_name,
    customer_phone     = EXCLUDED.customer_phone,
    reservation_date   = EXCLUDED.reservation_date,
    reservation_time   = EXCLUDED.reservation_time,
    visit_type         = EXCLUDED.visit_type,
    status             = EXCLUDED.status,
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    brief_note         = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 6. 예약메모 timeline 가드 INSERT (SoT 재타겟 = reservation_memo_history).
  --   (간략메모 brief_note 와 직교 — 본 블록 불변.)
  -- ────────────────────────────────────────────────────────────────
  v_memo_clean := NULLIF(btrim(p_memo), '');
  IF v_memo_clean IS NOT NULL THEN
    INSERT INTO public.reservation_memo_history
      (reservation_id, clinic_id, content, created_by, created_by_name, source_system)
    VALUES
      (v_reservation_id, v_clinic_id, v_memo_clean, NULL, '도파민TM', p_source_system)
    ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL
    DO UPDATE SET
      content    = EXCLUDED.content,
      created_at = now();
  END IF;

  RETURN v_reservation_id;
END;
$$;

-- service_role 키로만 호출 (anon/authenticated 차단) — 18-arg 시그니처 기준 (REPLACE 는 ACL 보존이나 명시 재적용=멱등)
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (18-arg superset + lifecycle 가드#5 + 예약메모 timeline + 간략메모 brief_note 배선 + customers.name never-downgrade 가드).
   (source_system, external_id) idempotent. p_memo non-empty → reservation_memo_history 멱등 upsert.
   p_brief_note → reservations.brief_note (INSERT + ON CONFLICT COALESCE-보존; 예약상세 팝업 간략메모 FE read SoT).
   ★ customers ON CONFLICT name = never-downgrade(COALESCE(NULLIF(btrim(customers.name),''), NULLIF(btrim(EXCLUDED.name),''), customers.name)):
     기존 non-empty 본명 no-touch(override 금지 §4-6 규칙3), 빈값일 때만 push명 채움. push명은 customer_real_name 스냅샷 착지. DA-20260713 §L12/§L40.
   ★ reservations.memo 매핑 제거(deprecated, FE 미read) = timeline-only SoT. brief_note 는 별개 표시축.
   p_status=cancelled → self-mint 행만 cancelled 전이+슬롯 release. active 재푸시=mutable UPDATE(in-flight/terminal reject).
   9~18 trailing DEFAULT → 8-arg 후방호환. (NAME-NEVER-DOWNGRADE ⊃ BRIEF-NOTE ⊃ TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP[timeline] ⊃ COMPANION + 가드#5)';

COMMIT;

-- 사후 검증 (수동):
--   (a) 18-arg 단일 signature 유지: \df upsert_reservation_from_source → 1행(18 args), 오버로드 잔존 없음.
--   (b) never-downgrade 결선: pg_get_functiondef(...) ILIKE '%COALESCE(NULLIF(btrim(customers.name)%'  → true.
--   (c) 舊 CASE override 제거: functiondef ILIKE '%WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <>%' → false.
--   (d) 기타 merge절/취소 fast-path/timeline/brief_note 무변경(strict copy) 회귀 없음.
