-- T-20260721-foot-COMPANION-PHONE-EXPOSE-DECISION — 동행자 연락처 표시전용 carriage (표시전용 재사용)
-- ============================================================================
-- ★ 목적 (DA 확정 판정 MSG-20260721-161823-xckd):
--   동행(companion) 예약상세에 '동행자 연락처'를 표시한다. 단, provision 실번호 경로는 REJECT
--   (동행≠예약자 differ = 제3자 공유폰 collapse 미탐지 = §461/INV-1·§52 위반, 2026-07-01 허브#000982
--   collapse 사고 재도입 금지). 채택 = 기존 표준 customer_real_phone(비키·표시전용, INV-3) 재사용.
--
-- ★ 변경 델타 (ADDITIVE 2건):
--   (1) reservations.customer_real_phone TEXT ADD (nullable, non-key = 식별 미참여). 부재 시 신설.
--       비키·표시전용(INV-3): PK/UNIQUE/FK/index 미참여, JOIN/dedup/귀속 키 절대 비사용(§4-2b).
--   (2) upsert_reservation_from_source RPC 가 p_customer_real_phone(旣존 16th arg, accept-ignore)를
--       reservations.customer_real_phone 로 persist. 시그니처(18-arg) 무변경 → 후방호환 100%.
--         · INSERT: NULLIF(btrim(p_customer_real_phone),'')  (공백→NULL 정규화, 표시전용)
--         · ON CONFLICT: COALESCE(NULLIF(btrim(EXCLUDED.customer_real_phone),''), reservations.customer_real_phone)
--           = preserve-on-NULL (빈값 재push 시 기존값 유지, customer_real_name 과 동형).
--
-- ★ ★ RC-CORRECTION (2026-07-22, dev-foot 착수 apply 시 supervisor DDL-diff 대비 재검):
--   본 CREATE OR REPLACE body 는 **prod 실재 최신 body(pg_get_functiondef 스냅샷)**를 base 로 하며
--   customer_real_phone 절만 ADD 한 strict superset 이다. 초기 초안(e05a870a)은 20260713150000 을
--   base 로 삼아 **20260715 마스킹-reject 가드(_fn_is_masked_pii, DA-20260715 RESCOPE, fail-closed)를
--   누락**(prod body 가 그 사이 20260715120000 로 전진) → CREATE OR REPLACE 시 PHI write-path 가드
--   유실 REGRESSION 이었다. 정정: 마스킹-reject 가드 블록 원문 보존 + customer_real_phone 4개 지점만 ADD.
--   ⇒ 본 migration 이 prod body ⊃ 마스킹-reject ⊃ never-downgrade ⊃ brief_note ⊃ TM-edit-cancel ⊃
--      MEMO-timeline ⊃ COMPANION + 가드#5 + customer_real_phone 의 새 최종 권위 body.
--
-- ★ 티켓 §4 재조정 근거: 티켓은 "RPC provision_companion_customer 에 trailing DEFAULT arg 추가"라
--   명시하나, foot 의 실 RPC 는 upsert_reservation_from_source 이며 p_customer_real_phone(16th)
--   arg 가 이미 DEFAULT NULL 로 존재(20260630170000 §447 positional parity, 現 accept-ignore).
--   ⇒ 신규 arg 추가 불요. 시그니처 무변경으로 persist 만 배선 = 티켓 의도("실번호 운반, 후방호환 100%")를
--     더 안전하게 달성(caller 계약·ACL·오버로드 위험 0). "trailing arg 추가"의 목표를 signature-stable 로 대체.
--
-- ★ 동행 identity 절대 무변(티켓 §1): p_is_companion 분기(customer_id=NULL, v_norm_phone=NULL) 무접촉.
--   phone_e164/customer_phone/provision 경로 전혀 안 건드림. customer_real_phone 는 별개 표시축(비키).
--   ★ 동행(p_is_companion=true) 경로는 마스킹-reject 가드에 미도달(ELSE 분기에만 존재) = 행위불변.
--
-- ★ cross_crm_data_contract 신규변경 없음 (§4-2b-1/INV-3 foot 채택 — 표준 필드명 재사용, 신규 계약 아님).
--
-- ★ 게이트: db_change=true → MIG-GATE 4필드 evidence 의무(면제 아님):
--   mig_files(멱등가드+롤백 동봉) / mig_dryrun(No-Persistence Protocol) / mig_ledger_check / mig_rollback.
--   supervisor DDL-diff DB-GATE = diff 가 (1) 컬럼 ADD + (2) RPC body customer_real_phone 절 ADD 로
--   국한됨을 확인(마스킹-reject 가드 保存 재확인). DA CONSULT RESOLVED. 대표게이트 면제(autonomy §3.1).
--   rollback: 20260721150000_foot_reservations_customer_real_phone_add.rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- (1) ADDITIVE 컬럼: reservations.customer_real_phone (nullable, non-key, 멱등 IF NOT EXISTS)
--     비키·표시전용(INV-3): 어떤 제약/인덱스에도 미참여. NULL=정상(동행 무-연락처 등).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_real_phone TEXT;

COMMENT ON COLUMN public.reservations.customer_real_phone IS
  'T-20260721-foot-COMPANION-PHONE-EXPOSE: 동행 본인 실 연락처 스냅샷(비키·표시전용, INV-3, §4-2b). '
  '동행(customer_id=NULL·customer_phone=NULL) 예약상세 ''동행자 연락처'' 표시 소스. '
  'PK/UNIQUE/FK/index 미참여 = 식별 미참여. JOIN/dedup/귀속 키 절대 비사용. NULL=정상. write=upsert RPC/ingest EF only.';

-- ────────────────────────────────────────────────────────────────
-- (2) RPC body 재정의 (18-arg 동일 signature → DROP 불요, CREATE OR REPLACE ACL 보존).
--     ★ prod 실재 최신 body(마스킹-reject 가드 포함)의 strict copy + customer_real_phone persist 절만 ADD.
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
  v_real_phone     TEXT;   -- T-20260721 COMPANION-PHONE-EXPOSE: 동행 실연락처 스냅샷(표시전용, 비키)
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

  -- T-20260721 COMPANION-PHONE-EXPOSE: 동행 실연락처 스냅샷(표시전용, 비키). 공백→NULL 정규화.
  --   ★ 동행 identity(phone_e164/customer_phone) 와 무관한 별개 표시축 — 역조회/귀속 미사용.
  v_real_phone := NULLIF(btrim(p_customer_real_phone), '');

  -- created_via / visit_type enum 가드 (비-enum → NULL/기본, CHECK 위반 500 차단)
  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  -- 3~4. customer 산출 (discriminator-gated) — ★ 동행 identity 절대 무변(티켓 §1)
  IF p_is_companion THEN
    v_customer_id := NULL;
    v_norm_phone  := NULL;
  ELSE
    v_norm_phone := public.normalize_phone(p_customer_phone);

    -- ── 마스킹-reject 가드 (DA-20260715 RESCOPE, fail-closed) — customers 권위 name/phone persist 경계 ──
    --   탐지=helper / raise=여기. 취소·companion 무write 경로엔 미도달(행위불변). raw 입력만 customers 진입.
    IF public._fn_is_masked_pii(p_customer_name, p_customer_phone) THEN
      RAISE EXCEPTION 'masked PII rejected (reservation upsert ingress)'
        USING ERRCODE = '22023',
              HINT = 'T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE: raw name/phone 필요(마스킹값 customers write 금지)';
    END IF;

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
    customer_real_name, customer_real_phone, brief_note
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'),
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name, v_real_phone, NULLIF(btrim(p_brief_note),'')
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id         = EXCLUDED.customer_id,
    customer_name       = EXCLUDED.customer_name,
    customer_phone      = EXCLUDED.customer_phone,
    reservation_date    = EXCLUDED.reservation_date,
    reservation_time    = EXCLUDED.reservation_time,
    visit_type          = EXCLUDED.visit_type,
    status              = EXCLUDED.status,
    created_via         = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id          = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id        = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name      = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name  = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    -- T-20260721 COMPANION-PHONE-EXPOSE: preserve-on-NULL (빈값 재push 시 기존 동행연락처 유지)
    customer_real_phone = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_phone),''), reservations.customer_real_phone),
    brief_note          = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note),
    updated_at          = now()
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
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (18-arg superset + lifecycle 가드#5 + 마스킹-reject 가드(_fn_is_masked_pii) + 예약메모 timeline + 간략메모 brief_note + customers.name never-downgrade + 동행연락처 customer_real_phone 표시전용 배선).
   (source_system, external_id) idempotent. p_customer_real_phone → reservations.customer_real_phone (INSERT + ON CONFLICT COALESCE-보존; 예약상세 팝업 ''동행자 연락처'' 표시전용, 비키·INV-3, §4-2b). 동행 identity(customer_id/phone) 무변.
   p_brief_note → reservations.brief_note. customers ON CONFLICT name = never-downgrade. p_status=cancelled → self-mint 행만 cancelled 전이.
   (COMPANION-PHONE-EXPOSE ⊃ MASKREJECT ⊃ NAME-NEVER-DOWNGRADE ⊃ BRIEF-NOTE ⊃ TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP[timeline] ⊃ COMPANION + 가드#5)';

COMMIT;

-- 사후 검증 (수동, apply 후 supervisor DB-GATE / POSTCHECK):
--   (a) 컬럼 실재: SELECT 1 FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='reservations' AND column_name='customer_real_phone'; → 1행.
--   (b) 비키 확인: customer_real_phone 이 어떤 index/제약에도 미포함
--        SELECT indexdef FROM pg_indexes WHERE tablename='reservations' AND indexdef ILIKE '%customer_real_phone%'; → 0행.
--   (c) 18-arg 단일 signature 유지: \df upsert_reservation_from_source → 1행(18 args), 오버로드 잔존 없음.
--   (d) persist 결선: pg_get_functiondef(...) ILIKE '%customer_real_phone = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_phone)%' → true.
--   (e) 마스킹-reject 가드 保存: pg_get_functiondef(...) ILIKE '%_fn_is_masked_pii%' → true (REGRESSION 차단 확인).
