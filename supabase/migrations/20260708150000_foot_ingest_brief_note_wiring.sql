-- T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH — 도파민 간략메모(brief_note) → 풋CRM 배선
-- ============================================================================
-- ★ 문제(4번 미반영): 도파민 CTI가 문제성발톱(발톱무좀/내성발톱 등) 선택 UI + push payload
--   reservation.brief_note 동봉을 배포(commit 66d661d)했으나, 풋CRM 수신부(RPC + ingest EF)가
--   brief_note 를 읽지 않아 풋 예약상세 팝업>간략메모(reservations.brief_note read)에서 공란.
--   → 3번(도파민 버튼)=정상, 4번(풋 예약상세 간략메모)=미반영. (박민지 팀장 현장 확인 완료.)
--
-- ★ 해소(ADDITIVE, 스키마 무변경): upsert_reservation_from_source RPC 에 p_brief_note 배선.
--   reservations.brief_note = 旣존 컬럼(TEXT NULL, 20260624100000_resvmgmt_overhaul2_w2.sql).
--   FE(ReservationDetailPopup.tsx <간략메모>, Dashboard, Reservations)가 read 하는 표시 SoT.
--   (예약메모=reservation_memo_history[timeline]와 직교 — 본 배선은 brief_note 단독.)
--
-- ★ 구현 binding:
--   1. p_brief_note TEXT DEFAULT NULL 을 末尾(18th) append. (PG 함수 식별자=(name, arg types)이므로
--      17-arg signature 명시 DROP 후 18-arg CREATE — 오버로드 충돌 차단. 190000/rpc17 선례 동일.)
--   2. INSERT VALUES: brief_note = p_brief_note.
--   3. ON CONFLICT DO UPDATE: brief_note = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note)
--      — 빈값/공백 재push=기존 brief_note 보존(no-op), non-empty=갱신(간략메모 편집 재push 반영).
--   4. 취소 fast-path·lifecycle 가드·timeline(rmh) upsert·나머지 컬럼 upsert 全 불변(strict superset).
--
-- ★ 선행 권위 body = 20260701020000_foot_resv_memo_timeline_retarget_provenance.sql (17-arg + 가드#5
--   + 예약메모 timeline 재타겟). 본 migration = 그 body의 strict superset(brief_note 배선만 추가).
--   ⇒ 본 migration 이 upsert_reservation_from_source 의 새 최종 권위 body.
--     이후 20260701020000/193000/190000/rpc17 단독 재적용 금지(clobber).
--
-- ★ 게이트 = ADDITIVE 확정 → 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). supervisor = DDL-diff only.
--   DA GO+ADDITIVE: MSG-tjrg. rollback: 20260708150000_foot_ingest_brief_note_wiring.rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- PG 함수 식별자 = (name, arg types). 17-arg → 18-arg = 인자수 변경 →
-- 기존 17-arg signature 명시 DROP 후 18-arg CREATE (오버로드 잔존/ambiguity 차단).
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
);

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
      name = CASE
        WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <> '' THEN EXCLUDED.name
        ELSE customers.name
      END,
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

-- service_role 키로만 호출 (anon/authenticated 차단) — 18-arg 시그니처 기준 (REPLACE 는 ACL 보존)
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (18-arg superset + lifecycle 가드#5 + 예약메모 timeline + 간략메모 brief_note 배선).
   (source_system, external_id) idempotent. p_memo non-empty → reservation_memo_history 멱등 upsert.
   p_brief_note → reservations.brief_note (INSERT + ON CONFLICT COALESCE-보존; 예약상세 팝업 간략메모 FE read SoT).
   ★ reservations.memo 매핑 제거(deprecated, FE 미read) = timeline-only SoT. brief_note 는 별개 표시축.
   p_status=cancelled → self-mint 행만 cancelled 전이+슬롯 release. active 재푸시=mutable UPDATE(in-flight/terminal reject).
   9~18 trailing DEFAULT → 8-arg 후방호환. (BRIEF-NOTE ⊃ TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP[timeline] ⊃ COMPANION + 가드#5)';

COMMIT;

-- 사후 검증 (수동):
--   (a) 18-arg 단일 signature: \df upsert_reservation_from_source → 1행(18 args), 17-arg 잔존 없음.
--   (b) brief_note INSERT 결선: pg_get_functiondef(...) ILIKE '%v_real_name, NULLIF(btrim(p_brief_note)%'.
--   (c) brief_note ON CONFLICT 보존: functiondef ILIKE '%brief_note%COALESCE(NULLIF(btrim(p_brief_note)%'.
--   (d) 취소 fast-path 무변경: cancel 시 brief_note 미터치(다른 컬럼 불변) 회귀 없음.
