-- T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED (DB-gate: supervisor 실행)
--
-- 근인 (live 증거 기반, AC-5):
--   FE(foot-checkin) fac28a2(T-20260609-ADDR-3COL-SPLIT) 가 RPC fn_selfcheckin_update_personal_info
--   를 10-arg(p_postal_code 포함)로 호출하나, prod DB 에는 9-arg(20260609234500 visit_route)만 적용됨.
--   → PostgREST PGRST202 "function not found" → FE try/catch{} silent-fail → 초진(예약/워크인) 개인정보
--     RPC 갱신 전체 실패.
--   추가로 20260602190000(privacy_consent_at/sms_opt_in_at 컬럼 + privacy_consent_at 기록)도 prod 미적용.
--
--   live probe (2026-06-11):
--     - RPC 10-arg 호출 → PGRST202 (10-arg 부재 확정)
--     - RPC  9-arg 호출 → check_in_not_found (9-arg 존재 확정)
--     - customers.privacy_consent_at / sms_opt_in_at → 42703 (컬럼 부재 확정)
--
--   증상 귀속:
--     - 예약경로(기존 고객 phone 직접매칭 → check_in.customer_id = 데스크레코드): 주소·동의가 100% RPC
--       의존 → RPC 실패로 데스크 2번차트 미반영. (병합 RPC rrn_match 는 phone 직접매칭이라 미발동 → 무관)
--     - 워크인 신규: customers INSERT(newCustomerPayload)가 address/postal_code/address_detail/privacy_consent
--       를 직접 저장 → 정상으로 관측. 단 hira_consent 는 INSERT 미포함(RPC 전용) → RPC 실패로 누락(미감지).
--
-- 변경 (canonical 최종형 통합 — 마이그 적용 순서 어긋남 정합화):
--   1. customers.privacy_consent_at / sms_opt_in_at 컬럼 추가 (20260602190000 흡수, idempotent)
--   2. fn_selfcheckin_update_personal_info 를 10-arg canonical 로 재정의:
--      birth_date / address / address_detail / postal_code / privacy_consent(+at) /
--      insurance_consent→hira_consent(+at) / visit_route(+detail)
--      → 기존 9-arg(234500) + 7-arg(20260602190000) 시그니처 DROP 후 10-arg 재생성(오버로드 모호성 제거)
--
-- 배포 순서 (중요):
--   본 DB 마이그레이션을 먼저 적용한다. FE(fac28a2)는 이미 10-arg 전달 중이므로 본 마이그 적용
--   즉시 현장 버그(예약 미반영 + hira 누락)가 해소된다. (FE 재배포 없이도 효력)
--   - 구 FE(p_postal_code 미전달)도 10-arg 전부 DEFAULT NULL 이므로 호환.
--
-- 백필: 금지 — 기존 row 의 동의/주소는 소급 불가(NULL 유지). 누락분 backfill 은 본 티켓 scope 제외.
--
-- 롤백: 20260611100000_selfcheckin_personal_info_consolidate.rollback.sql
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.sql

BEGIN;

-- ─── 1. 동의 시각 audit 컬럼 (idempotent — 20260602190000 미적용분 흡수) ───
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_in_at      timestamptz;

COMMENT ON COLUMN public.customers.privacy_consent_at IS
  'T-20260602/T-20260611: 개인정보 수집·이용 동의 시각. 기존 row 소급 불가(NULL).';
COMMENT ON COLUMN public.customers.sms_opt_in_at IS
  'T-20260602/T-20260611: 예약문자 수신 동의 시각. 기존 row 소급 불가(NULL).';

-- ─── 2. fn_selfcheckin_update_personal_info — 10-arg canonical 재정의 ───
-- 잔존 가능한 구 시그니처 모두 제거 (오버로드 모호성 방지).
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN                       -- 7-arg (20260602190000)
);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT           -- 9-arg (20260609234500, 현 prod)
);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT     -- 10-arg (재실행 대비)
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id        UUID,
  p_clinic_id          UUID,
  p_birth_date         TEXT     DEFAULT NULL,
  p_address            TEXT     DEFAULT NULL,
  p_address_detail     TEXT     DEFAULT NULL,
  p_postal_code        TEXT     DEFAULT NULL,   -- 3COL-SPLIT: 우편번호 분리 저장
  p_privacy_consent    BOOLEAN  DEFAULT NULL,
  p_insurance_consent  BOOLEAN  DEFAULT NULL,   -- → hira_consent
  p_visit_route        TEXT     DEFAULT NULL,   -- 방문경로 대분류('워크인')
  p_visit_route_detail TEXT     DEFAULT NULL    -- 방문경로 소분류(유입경로)
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
  --   AC-2: p_privacy_consent=true → privacy_consent_at=now(); false → NULL(철회); NULL → 유지
  --   AC-3/AC-7: p_insurance_consent=true → hira_consent/hira_consent_at 갱신(false 리셋 방지)
  --   3COL-SPLIT: postal_code COALESCE 갱신(우편번호 차트 연동)
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
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260529-FLOW-REVAMP + 20260602-CONSENT-TIMESTAMP + 20260609-LEADSRC-VISITPATH + 20260609-ADDR-3COL-SPLIT'
  ' + T-20260611-CONSENT-ADDR-NOTSAVED(consolidate): 초진 셀프접수 개인정보 저장 canonical 10-arg.'
  ' 생년월일·주소(기본/상세/우편번호 3컬럼)·동의(privacy+at, hira+at)·방문경로(대/소분류).'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장.';

COMMIT;
