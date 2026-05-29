-- T-20260529-foot-SELFCHECKIN-FLOW-REVAMP (스펙 보강 — MSG-20260529-101029-ly5u)
-- AC-7: fn_selfcheckin_update_personal_info 에 p_insurance_consent 파라미터 추가
--        → customers.hira_consent / hira_consent_at 업데이트
-- AC-9: fn_selfcheckin_rrn_match 신규
--        → 셀프접수 후 주민번호 기준으로 데스크 기입 고객 레코드와 자동 매칭
--
-- 롤백: 20260529002000_selfcheckin_insurance_rrn_match.rollback.sql
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260529002000_selfcheckin_insurance_rrn_match.sql

BEGIN;

-- ─── 1. fn_selfcheckin_update_personal_info (REPLACE — p_insurance_consent 추가) ──
-- 기존 파라미터 유지 + p_insurance_consent 추가 (DEFAULT NULL → 하위 호환)
-- 체크 시 customers.hira_consent = true / hira_consent_at = now()

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id      UUID,
  p_clinic_id        UUID,
  p_birth_date       TEXT     DEFAULT NULL,
  p_address          TEXT     DEFAULT NULL,
  p_address_detail   TEXT     DEFAULT NULL,
  p_privacy_consent  BOOLEAN  DEFAULT NULL,
  p_insurance_consent BOOLEAN DEFAULT NULL   -- AC-7 신규
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
  UPDATE customers
  SET
    birth_date        = COALESCE(p_birth_date,      birth_date),
    address           = COALESCE(p_address,         address),
    address_detail    = COALESCE(p_address_detail,  address_detail),
    privacy_consent   = COALESCE(p_privacy_consent, privacy_consent),
    hira_consent      = CASE
                          WHEN p_insurance_consent = true THEN true
                          ELSE hira_consent           -- 기존 값 유지 (false 전달 시도 무시)
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
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장.';


-- ─── 2. fn_selfcheckin_rrn_match (신규 — AC-9) ────────────────────────────────
-- 셀프접수 후 birth_date(주민번호 앞6자리) 기준으로 데스크 기입 레코드와 자동 매칭
--
-- 동작:
--   1. 현재 check_in 의 customer_id / birth_date 조회
--   2. 동일 clinic_id 내 당일 check_in 이 있는 다른 customers 중 birth_date 일치 검색
--   3. 발견 시 → 현재 check_in.customer_id 를 기존(먼저 생성된) 고객 ID 로 교체
--   4. 교체된 customer는 birth_date/address/hira_consent 가 이미 데스크 입력값을 포함할 수 있으므로
--      selfcheckin 값(p_birth_date, p_address, p_hira_consent)을 덧씌워 최신화
--
-- 안전 조건:
--   - 현재 check_in 생성 30분 이내
--   - clinic_id 이중 검증
--   - 매칭 대상: 당일(Asia/Seoul 기준) check_in 보유 + 같은 birth_date
--   - 복수 후보 시 가장 오래된(먼저 생성된) 고객 사용
--
-- 반환: { success, matched, merged_to_customer_id }

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
  v_self_bd        TEXT;             -- selfcheckin 고객의 birth_date
  v_self_cust_id   UUID;
  v_target_cust_id UUID;             -- 매칭된 기존 고객 ID
  v_today          DATE;
BEGIN
  -- ① 현재 check_in 조회 + 보안 검증
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

  -- ② 셀프접수 고객의 birth_date 조회
  SELECT birth_date INTO v_self_bd
  FROM   customers
  WHERE  id = v_self_cust_id;

  -- birth_date 미입력이면 매칭 불가
  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  -- 오늘 날짜 (Asia/Seoul)
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  -- ③ 동일 birth_date + 당일 체크인 + 다른 고객 검색 (먼저 생성된 순)
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

  -- 매칭 없으면 그대로 반환
  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  -- ④ 현재 check_in 의 customer_id 를 기존 고객으로 교체
  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 에서 수집한 최신 데이터 병합
  --    (birth_date/address/hira_consent 는 이미 fn_selfcheckin_update_personal_info 에서 v_self_cust_id 에 저장됨)
  UPDATE customers dest
  SET
    birth_date    = COALESCE(src.birth_date,   dest.birth_date),
    address       = COALESCE(src.address,      dest.address),
    hira_consent  = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                            THEN src.hira_consent_at
                           ELSE dest.hira_consent_at
                      END,
    updated_at    = now()
  FROM customers src
  WHERE dest.id   = v_target_cust_id
    AND src.id    = v_self_cust_id;

  -- ⑥ selfcheckin 으로 생성된 임시 고객 레코드 정리 (check_in 이 없으면 삭제)
  --    check_in 이 아직 있으면 삭제 안 함 (다른 접수가 있을 수 있음)
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
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-9: 셀프접수 주민번호 자동 매칭.'
  ' birth_date(앞6자리) + 당일 check_in 조건으로 데스크 기입 레코드와 병합.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;
