-- T-20260609-foot-SELFCHECKIN-ADDR-3COL-SPLIT (DB-gate: supervisor 실행)
--
-- 목적: 셀프접수(foot-checkin 키오스크) 일반 신규환자 등록 경로의 주소를
--   2번차트 칸별(기본주소/상세주소/우편번호)로 분리 저장하도록 한다.
--   FE 는 INSERT 경로(newCustomerPayload)에서 이미 postal_code/address_detail 컬럼을
--   직접 세팅하므로 DB 변경 불필요. 단, 초진 동선의 RPC 경로
--   fn_selfcheckin_update_personal_info 는 p_address_detail 은 받지만
--   p_postal_code 파라미터가 없어 우편번호가 차트로 연동되지 못한다.
--
-- 변경:
--   fn_selfcheckin_update_personal_info 에 p_postal_code 파라미터 추가
--   + UPDATE 절에 postal_code = COALESCE(p_postal_code, postal_code) 추가.
--   기존 9-arg 시그니처 DROP 후 10-arg 재생성 (PostgREST 오버로드 모호성 방지).
--   나머지 동작(생년월일·주소·상세주소·동의·방문경로·HIRA·30분/clinic 검증) 불변.
--
-- 배포 순서 (중요):
--   본 DB 마이그레이션을 FE(foot-checkin) 배포보다 먼저(또는 동시) 적용한다.
--   - DB 선적용 시: 구 FE(p_postal_code 미전달)도 10-arg DEFAULT NULL 로 정상 동작.
--   - FE 선적용 시: FE 가 p_postal_code 전달 → 구 9-arg 함수와 시그니처 불일치로
--     PostgREST "function not found" → 개인정보 저장 silent 실패. 반드시 DB 먼저.
--
-- 롤백: 20260609235500_selfcheckin_personal_info_postal_code.rollback.sql
--
-- 적용 방법 (supervisor DB-gate 실행):
--   supabase db push --file supabase/migrations/20260609235500_selfcheckin_personal_info_postal_code.sql

BEGIN;

-- 기존 9-arg 시그니처 제거 후 10-arg 재생성 (오버로드 모호성 방지).
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id       UUID,
  p_clinic_id         UUID,
  p_birth_date        TEXT     DEFAULT NULL,
  p_address           TEXT     DEFAULT NULL,
  p_address_detail    TEXT     DEFAULT NULL,
  p_postal_code       TEXT     DEFAULT NULL,   -- T-20260609 3COL-SPLIT 신규: 우편번호 분리 저장
  p_privacy_consent   BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN  DEFAULT NULL,
  p_visit_route       TEXT     DEFAULT NULL,   -- 방문경로 대분류('워크인')
  p_visit_route_detail TEXT    DEFAULT NULL    -- 방문경로 소분류(유입경로)
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
  -- AC-7: p_insurance_consent = true 일 때만 hira_consent 갱신 (false로 리셋 방지)
  -- T-20260609 3COL-SPLIT: postal_code COALESCE 갱신 추가 (우편번호 차트 연동).
  UPDATE customers
  SET
    birth_date         = COALESCE(p_birth_date,        birth_date),
    address            = COALESCE(p_address,           address),
    address_detail     = COALESCE(p_address_detail,    address_detail),
    postal_code        = COALESCE(p_postal_code,       postal_code),
    privacy_consent    = COALESCE(p_privacy_consent,   privacy_consent),
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
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP + LEADSRC-UI-VISITPATH + T-20260609-foot-SELFCHECKIN-ADDR-3COL-SPLIT:'
  ' 초진 셀프접수 개인정보(생년월일·주소·상세주소·우편번호·동의·방문경로) 저장.'
  ' v4: p_postal_code 추가 — 우편번호 2번차트 칸별 연동(주소 3컬럼 분리).'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장.';

COMMIT;
