-- T-20260609-foot-SELFREG-ADDR-SYNC
-- AC-3 진단: 셀프접수(SelfCheckIn) 신규 환자가 입력한 주소 중 우편번호(postal_code)·상세주소(address_detail)가
--            차트2(CustomerChartPage)에 연동되지 않는 원인은 fn_selfcheckin_rrn_match 의 병합(⑤) 누락.
--            셀프접수는 임시 customers 레코드에 address/postal_code/address_detail 를 모두 write 하지만,
--            주민번호 자동 매칭이 데스크 기입 레코드(dest)로 customer 를 재지정하며 병합할 때
--            birth_date/address/hira_consent 만 옮기고 postal_code/address_detail 은 빠뜨린 뒤 임시 레코드를 삭제 →
--            우편번호·상세주소가 유실되어 차트2에서 보이지 않음.
--
-- AC-1 수정: fn_selfcheckin_rrn_match 병합 ⑤ 에 postal_code, address_detail 추가.
-- AC-2 방어: COALESCE(src.x, dest.x) — 셀프접수 입력이 비어 있으면(NULL) 기존(dest) 값 유지.
--            빈 입력으로 기존 주소/우편번호/상세주소를 덮어쓰지 않음(기존 address 병합 패턴과 동일).
--
-- 변경 함수: public.fn_selfcheckin_rrn_match (CREATE OR REPLACE — 시그니처 불변)
-- 롤백: 20260609230000_selfcheckin_rrn_match_addr_sync.rollback.sql
--
-- 적용 방법 (supervisor 실행):
--   supabase db push --file supabase/migrations/20260609230000_selfcheckin_rrn_match_addr_sync.sql

BEGIN;

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
  --    (birth_date/address/postal_code/address_detail/hira_consent 는 이미
  --     fn_selfcheckin_update_personal_info + 직접 INSERT 단계에서 v_self_cust_id 에 저장됨)
  --    T-20260609-foot-SELFREG-ADDR-SYNC AC-1: postal_code/address_detail 병합 추가.
  --    AC-2: COALESCE 로 src(셀프접수) 빈 입력 시 dest(기존) 값 유지 — 덮어쓰기 방지.
  UPDATE customers dest
  SET
    birth_date      = COALESCE(src.birth_date,      dest.birth_date),
    address         = COALESCE(src.address,         dest.address),
    postal_code     = COALESCE(src.postal_code,     dest.postal_code),
    address_detail  = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent    = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                            THEN src.hira_consent_at
                           ELSE dest.hira_consent_at
                      END,
    updated_at      = now()
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
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-9 + T-20260609-foot-SELFREG-ADDR-SYNC AC-1: 셀프접수 주민번호 자동 매칭.'
  ' birth_date(앞6자리) + 당일 check_in 조건으로 데스크 기입 레코드와 병합.'
  ' 병합 시 address/postal_code/address_detail 모두 이관(COALESCE — 빈 입력 덮어쓰기 방지).'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;
