-- T-20260602-foot-CONSENT-TIMESTAMP-COLS — 풋 셀프접수 동의 시각추적 컬럼 보강
-- (parent: T-20260602-foot-CHECKIN-RESV-YESNO-FLOW)
--
-- 요구:
--   1. privacy_consent_at (timestamptz, NULL 허용) 신규 컬럼
--   2. sms_opt_in_at      (timestamptz, NULL 허용) 신규 컬럼
--   3. fn_selfcheckin_update_personal_info 가 privacy_consent_at 를 hira 패턴과 동일하게 기록
--   4. 백필 금지 — 기존 row 의 동의 시각은 소급 불가(NULL 유지). 일괄 UPDATE 없음.
--
-- 대상 DB: foot Supabase rxlomoozakkjesdqjtvd
-- 롤백: 20260602190000_consent_timestamp_cols.rollback.sql
--
-- 적용 방법 (supervisor DB게이트 통과 후 실행):
--   supabase db push --file supabase/migrations/20260602190000_consent_timestamp_cols.sql

BEGIN;

-- ─── 1. 신규 컬럼 2개 (NULL 허용, 백필 없음) ──────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_in_at      timestamptz;

COMMENT ON COLUMN public.customers.privacy_consent_at IS
  'T-20260602-foot-CONSENT-TIMESTAMP-COLS: 개인정보 수집·이용 동의 시각. 기존 row 소급 불가(NULL).';
COMMENT ON COLUMN public.customers.sms_opt_in_at IS
  'T-20260602-foot-CONSENT-TIMESTAMP-COLS: 예약문자 수신 동의 시각. 기존 row 소급 불가(NULL).';

-- ─── 2. fn_selfcheckin_update_personal_info (REPLACE — privacy_consent_at 기록 추가) ──
-- 기존 시그니처/파라미터 유지. privacy_consent_at 만 hira 패턴과 동일하게 병기.
--   p_privacy_consent = true  → privacy_consent_at = now()
--   p_privacy_consent = false → privacy_consent_at = NULL (동의 철회 시 시각 제거)
--   p_privacy_consent = NULL  → 기존 값 유지
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id      UUID,
  p_clinic_id        UUID,
  p_birth_date       TEXT     DEFAULT NULL,
  p_address          TEXT     DEFAULT NULL,
  p_address_detail   TEXT     DEFAULT NULL,
  p_privacy_consent  BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
BEGIN
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  UPDATE customers
  SET
    birth_date        = COALESCE(p_birth_date,      birth_date),
    address           = COALESCE(p_address,         address),
    address_detail    = COALESCE(p_address_detail,  address_detail),
    privacy_consent   = COALESCE(p_privacy_consent, privacy_consent),
    privacy_consent_at = CASE
                           WHEN p_privacy_consent = true  THEN now()
                           WHEN p_privacy_consent = false THEN NULL
                           ELSE privacy_consent_at      -- NULL 전달 시 기존 값 유지
                         END,
    hira_consent      = CASE
                          WHEN p_insurance_consent = true THEN true
                          ELSE hira_consent
                        END,
    hira_consent_at   = CASE
                          WHEN p_insurance_consent = true THEN now()
                          ELSE hira_consent_at
                        END,
    updated_at        = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 초진 셀프접수 개인정보(생년월일·주소·동의) 저장.'
  ' v2(AC-7): p_insurance_consent=true 시 hira_consent/hira_consent_at 갱신.'
  ' v3(T-20260602-CONSENT-TIMESTAMP-COLS): p_privacy_consent=true 시 privacy_consent_at=now().'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장.';

COMMIT;
