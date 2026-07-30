-- T-20260628-foot-ANON-KIOSK-CUTOVER — L1730 disposition (DA-ow58 CONSULT-REPLY)
--   SSOT: da_decision_foot_kiosk_L1730_customers_revoke_routing_20260719.md
--   ticket DA-20260719-foot-KIOSK-L1730-REVOKE-ROUTING (verdict GO, ADDITIVE)
--
-- 목적:
--   키오스크 셀프체크인의 검증예약 기존고객 contact/consent 갱신을 name+phone 재해소 RPC(v3)에서
--   check_in_id-keyed update-only RPC(fn_selfcheckin_update_personal_info)로 라우팅한다.
--     - §25 INV-0 안전: check_in.customer_id 로 UPDATE(신규 INSERT 없음) → 중복차트 벡터 제거.
--     - §16-5 안전: check_in_id-bearer(세션 minted·30분 가드·clinic 이중검증) — customer_id-bearer 아님.
--   v3(_upsert_customer_resolve_v3)는 [성함 AND 연락처] 복합키 재해소 + 0-match 시 신규 INSERT(created)라
--   검증예약 고객 표기차 시 §25 INV-0 위반 벡터 → 이 write path 로 부적합(DA Q2=NO). v3 는 워크인/직접입력
--   branch(旣 컷오버)용으로 유지.
--
-- 변경 (ADDITIVE only):
--   fn_selfcheckin_update_personal_info 13-arg → 15-arg. 신규 파라미터 2종 (DEFAULT NULL, 하위호환):
--     + p_sms_opt_in     BOOLEAN  DEFAULT NULL  -- COALESCE + sms_opt_in_at CASE (v3 규약 미러)
--     + p_customer_email TEXT     DEFAULT NULL  -- COALESCE(NULLIF(btrim),..) (v3 규약 미러)
--   ※ consent 3파라미터(p_consent_sensitive/agreed_at/version)는 20260629120000_foot_consent_sensitive
--     에서 旣추가(13-arg) → 본 마이그는 그대로 재사용. DA "+5" 중 미보유 2종만 신규.
--
-- ADDITIVE 근거: 신규 DEFAULT NULL 파라미터 2종, 기존 컬럼(sms_opt_in/sms_opt_in_at/customer_email) 재사용,
--   반환형(JSONB) 불변, 스키마 컬럼 ADD/DROP 없음. 구 13-arg 호출자는 신규 2파라미터 DEFAULT NULL 로 무회귀.
--   → §3.1 CEO/대표 게이트 면제, supervisor DDL-diff 단일 게이트.
--
-- 백필: 금지 — 기존 row 의 sms_opt_in/email 은 소급 불가(NULL 전달 시 COALESCE 유지).
--
-- 롤백: 20260719160000_selfcheckin_update_personal_info_contact_additive.rollback.sql
--   (15-arg DROP → 20260629120000 canonical 13-arg 복원. 데이터·컬럼 무변경.)
--
-- 적용 (dev-foot DB-gate 실행):
--   supabase db push --file supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.sql

BEGIN;

-- ─── 잔존 가능한 구/신 시그니처 제거 (오버로드 모호성 방지 — consolidate 선례) ───
--   13-arg canonical (20260629120000_foot_consent_sensitive, 현 prod)
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
);
--   15-arg (본 마이그 재실행 대비)
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id        UUID,
  p_clinic_id          UUID,
  p_birth_date         TEXT        DEFAULT NULL,
  p_address            TEXT        DEFAULT NULL,
  p_address_detail     TEXT        DEFAULT NULL,
  p_postal_code        TEXT        DEFAULT NULL,
  p_privacy_consent    BOOLEAN     DEFAULT NULL,
  p_insurance_consent  BOOLEAN     DEFAULT NULL,   -- → hira_consent
  p_visit_route        TEXT        DEFAULT NULL,
  p_visit_route_detail TEXT        DEFAULT NULL,
  -- T-20260615-foot-CONSENT-SENSITIVE (20260629120000, 개보법 §23) — 旣존
  p_consent_sensitive  BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at  TIMESTAMPTZ DEFAULT NULL,
  p_consent_version    TEXT        DEFAULT NULL,
  -- ★ ADDITIVE (T-20260628 DA-ow58) — L1730 contact 라우팅. DEFAULT NULL 하위호환.
  p_sms_opt_in         BOOLEAN     DEFAULT NULL,
  p_customer_email     TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
BEGIN
  -- check_in 존재 + clinic_id 일치 확인
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  -- 30분 이내 생성된 체크인만 허용
  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  -- customer_id 필수 (§25 INV-0: 신규 INSERT 없음 — 링크된 고객만 UPDATE)
  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  -- 고객 정보 업데이트 (NULL 파라미터는 기존 값 유지)
  UPDATE customers
  SET
    birth_date         = COALESCE(p_birth_date,         birth_date),
    address            = COALESCE(p_address,            address),
    address_detail     = COALESCE(p_address_detail,     address_detail),
    postal_code        = COALESCE(p_postal_code,        postal_code),
    privacy_consent    = COALESCE(p_privacy_consent,    privacy_consent),
    privacy_consent_at = CASE
                           WHEN p_privacy_consent = true  THEN now()
                           WHEN p_privacy_consent = false THEN NULL
                           ELSE privacy_consent_at
                         END,
    visit_route        = COALESCE(p_visit_route,        visit_route),
    visit_route_detail = COALESCE(p_visit_route_detail, visit_route_detail),
    hira_consent       = CASE
                           WHEN p_insurance_consent = true THEN true
                           ELSE hira_consent
                         END,
    hira_consent_at    = CASE
                           WHEN p_insurance_consent = true THEN now()
                           ELSE hira_consent_at
                         END,
    -- T-20260615-foot-CONSENT-SENSITIVE (개보법 §23):
    --   p_consent_sensitive=true 시에만 FALSE→TRUE 갱신 + agreed_at/version 최초기록 보존(COALESCE).
    --   이미 TRUE 인 row 는 그대로(다운그레이드 방지). NULL 전달 시 기존 유지.
    consent_sensitive  = CASE
                           WHEN p_consent_sensitive = true THEN true
                           ELSE consent_sensitive
                         END,
    consent_agreed_at  = CASE
                           WHEN p_consent_sensitive = true
                             THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                           ELSE consent_agreed_at
                         END,
    consent_version    = CASE
                           WHEN p_consent_sensitive = true
                             THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                           ELSE consent_version
                         END,
    -- ★ ADDITIVE (T-20260628 DA-ow58): sms_opt_in / customer_email — v3 규약 미러.
    --   sms_opt_in: TRUE→now() 기록 / FALSE→시각 clear / NULL→유지.
    --   customer_email: 공백 trim 후 non-empty 시에만 COALESCE 갱신(빈 문자열로 덮어쓰기 방지).
    sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
    sms_opt_in_at      = CASE
                           WHEN p_sms_opt_in IS TRUE  THEN now()
                           WHEN p_sms_opt_in IS FALSE THEN NULL
                           ELSE sms_opt_in_at
                         END,
    customer_email     = COALESCE(NULLIF(btrim(p_customer_email), ''), customer_email),
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260611-CONSOLIDATE + T-20260615-CONSENT-SENSITIVE + T-20260628-ANON-KIOSK-CUTOVER(DA-ow58): 15-arg.'
  ' 생년월일·주소(기본/상세/우편번호)·동의(privacy+at, hira+at, sensitive+agreed_at+version)·방문경로(대/소)'
  ' + sms_opt_in(+at)·customer_email. check_in_id-keyed update-only(§25 INV-0), anon SECURITY DEFINER'
  ' — 30분/clinic 이중검증. 하위호환: 구 13-arg 호출자는 신규 2파라미터 DEFAULT NULL. RRN 비저장.';

COMMIT;
