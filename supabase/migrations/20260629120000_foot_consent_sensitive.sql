-- ============================================================
-- Migration: foot_CONSENT-SENSITIVE — customers 민감정보 동의 3컬럼 + RPC 13-arg
-- Ticket: T-20260615-foot-CONSENT-SENSITIVE (P1)
-- 개보법 §23: 민감정보(건강·진료정보) 별도 동의 — body 검증 패턴 이식(foot 아키텍처 맞춤).
-- SUPERVISOR DDL-diff 게이트 필수 (ADDITIVE — 파괴변경 0)
-- 대상 DB: foot Supabase rxlomoozakkjesdqjtvd
-- ============================================================
--
-- ※ body 레퍼런스(checkin_update_customer_fields)와 foot 의 self-checkin write-path 는 함수가 다름.
--   foot canonical write-path = fn_selfcheckin_update_personal_info (10-arg, 20260611100000).
--   body 의 RPC 시그니처를 그대로 복붙하지 않고, foot 의 현 canonical 함수에 3파라미터를 ADDITIVE 확장한다.
--
-- 변경 내용:
--   1. customers 테이블 ADDITIVE 3컬럼 추가 (ADD COLUMN IF NOT EXISTS)
--      - consent_sensitive   BOOLEAN      DEFAULT FALSE  (★DB default FALSE 고수 — 미동의 row 허위기록 방지)
--      - consent_agreed_at   TIMESTAMPTZ  nullable       (동의셋 증빙 타임스탬프)
--      - consent_version     TEXT         nullable       (foot-2026-06 — body/derm/scalp 문자열 복붙 금지)
--   2. fn_selfcheckin_update_personal_info 10-arg → 13-arg (consent 3파라미터 추가, 하위호환 DEFAULT NULL)
--   3. fn_selfcheckin_rrn_match 병합 set-list 에 consent_sensitive 3컬럼 이관 추가
--      (merge-path 보강 — 2레코드 병합 시 셀프접수 임시레코드의 민감정보 동의 유실 방지.
--       privacy/hira/sms 와 동일 패턴, 20260611140000 선례. 신규 컬럼 없음 → 데이터계약 비변경.)
--
-- 비파괴 정책:
--   - 레거시 privacy_consent / hira_consent 컬럼 공존 (제거 없음)
--   - CHECK constraint 추가 없음 (Lovable CHECK 갱신 불요)
--   - ADDITIVE only — 기존 row 는 consent_sensitive = FALSE 유지
--   - 백필 금지 — 과거 동의는 소급 불가(NULL/FALSE 유지)
--
-- 롤백: 20260629120000_foot_consent_sensitive.rollback.sql
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260629120000_foot_consent_sensitive.sql
-- ============================================================

BEGIN;

-- ─── 1. customers ADDITIVE 3컬럼 추가 ────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS consent_sensitive   BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_agreed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version     TEXT;

COMMENT ON COLUMN public.customers.consent_sensitive IS
  'T-20260615-foot-CONSENT-SENSITIVE: 민감정보(건강·진료정보) 수집·이용 동의 (개보법 §23). '
  'DB DEFAULT FALSE — 폼 캡처 시점에 TRUE 기록. 기존 row 는 false 유지(허위기록 방지).';

COMMENT ON COLUMN public.customers.consent_agreed_at IS
  'T-20260615-foot-CONSENT-SENSITIVE: 동의셋 증빙 타임스탬프. '
  'consent_sensitive 포함 동의셋 기록 시각 (최초 기록 후 불변 — COALESCE 보존).';

COMMENT ON COLUMN public.customers.consent_version IS
  'T-20260615-foot-CONSENT-SENSITIVE: 동의 항목셋 버전. foot-2026-06 고정. '
  'body-2026-06 / scalp-2026-06 / derm-2026-06 복붙 금지 — 도메인별 버전 분리.';

-- ─── 2. fn_selfcheckin_update_personal_info — 13-arg canonical 재정의 ─────────
-- 잔존 10-arg(20260611100000) 제거 후 13-arg 재생성(오버로드 모호성 제거).
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT          -- 10-arg (현 prod canonical)
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id        UUID,
  p_clinic_id          UUID,
  p_birth_date         TEXT     DEFAULT NULL,
  p_address            TEXT     DEFAULT NULL,
  p_address_detail     TEXT     DEFAULT NULL,
  p_postal_code        TEXT     DEFAULT NULL,
  p_privacy_consent    BOOLEAN  DEFAULT NULL,
  p_insurance_consent  BOOLEAN  DEFAULT NULL,   -- → hira_consent
  p_visit_route        TEXT     DEFAULT NULL,
  p_visit_route_detail TEXT     DEFAULT NULL,
  -- T-20260615-foot-CONSENT-SENSITIVE: 추가 3파라미터 (DEFAULT NULL → 구 FE 하위호환)
  p_consent_sensitive  BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at  TIMESTAMPTZ DEFAULT NULL,
  p_consent_version    TEXT        DEFAULT NULL
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

  -- customer_id 필수
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
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260611-CONSENT-ADDR-NOTSAVED(consolidate) + T-20260615-CONSENT-SENSITIVE: 초진 셀프접수 개인정보 저장 13-arg.'
  ' 생년월일·주소(기본/상세/우편번호)·동의(privacy+at, hira+at, sensitive+agreed_at+version)·방문경로(대/소분류).'
  ' sensitive: FALSE→TRUE 시 consent_agreed_at/version 최초기록 보존(COALESCE, foot-2026-06).'
  ' 하위호환: 구 10-arg 호출자는 신규 3파라미터 DEFAULT NULL 사용. anon SECURITY DEFINER — 30분/clinic 이중검증. RRN 비저장.';

-- ─── 3. fn_selfcheckin_rrn_match — 병합 set-list 에 consent_sensitive 이관 추가 ──
-- (merge-path 보강: 2레코드 병합 시 셀프접수 임시레코드가 수집한 민감정보 동의가 ⑥ DELETE 로 유실되는 것 방지.
--  privacy/hira/sms 와 동일 패턴 — 20260611140000 선례. 시그니처(UUID,UUID) 불변. 신규 컬럼 없음.)
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_rrn_match(
  p_check_in_id  UUID,
  p_clinic_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci             check_ins%ROWTYPE;
  v_self_bd        TEXT;
  v_self_cust_id   UUID;
  v_target_cust_id UUID;
  v_today          DATE;
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

  v_self_cust_id := v_ci.customer_id;

  SELECT birth_date INTO v_self_bd
  FROM   customers
  WHERE  id = v_self_cust_id;

  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  SELECT c.id INTO v_target_cust_id
  FROM   customers c
  JOIN   check_ins ci ON ci.customer_id = c.id
  WHERE  c.clinic_id  = p_clinic_id
    AND  c.id        <> v_self_cust_id
    AND  c.birth_date = v_self_bd
    AND  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::DATE = v_today
    AND  ci.status   <> 'cancelled'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 수집 최신 데이터 병합
  --    동의류: src=true 우선(다운그레이드 방지), 신규 동의 시각(_at) 이관.
  --    T-20260615-CONSENT-SENSITIVE: consent_sensitive(+agreed_at/version) 동일 패턴 이관 추가.
  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,      dest.birth_date),
    address            = COALESCE(src.address,         dest.address),
    postal_code        = COALESCE(src.postal_code,     dest.postal_code),
    address_detail     = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                              THEN src.hira_consent_at
                             ELSE dest.hira_consent_at
                        END,
    privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
    privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
                              THEN src.privacy_consent_at
                             ELSE dest.privacy_consent_at
                        END,
    sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
    sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
                              THEN src.sms_opt_in_at
                             ELSE dest.sms_opt_in_at
                        END,
    consent_sensitive  = CASE WHEN src.consent_sensitive = true THEN true ELSE dest.consent_sensitive END,
    consent_agreed_at  = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_agreed_at
                             ELSE dest.consent_agreed_at
                        END,
    consent_version    = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_version
                             ELSE dest.consent_version
                        END,
    updated_at         = now()
  FROM customers src
  WHERE dest.id   = v_target_cust_id
    AND src.id    = v_self_cust_id;

  IF NOT EXISTS (
    SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id
  ) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'success',               true,
    'matched',               true,
    'merged_to_customer_id', v_target_cust_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_rrn_match IS
  'T-20260611-CONSENT-ADDR-NOTSAVED(merge-path) + T-20260615-CONSENT-SENSITIVE: 셀프접수 주민번호 자동 매칭. '
  'birth_date(앞6자리)+당일 check_in 으로 데스크 레코드와 병합. '
  '병합 시 address/postal_code/address_detail(COALESCE) + hira/privacy/sms/sensitive 동의(true 우선, _at 이관) 전부 이관. '
  'anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

-- PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- 검증 쿼리 (supervisor apply 후):
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'customers'
--   AND column_name IN ('consent_sensitive', 'consent_agreed_at', 'consent_version')
-- ORDER BY column_name;
--
-- SELECT proname, pg_get_function_identity_arguments(oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('fn_selfcheckin_update_personal_info', 'fn_selfcheckin_rrn_match');
-- ============================================================
