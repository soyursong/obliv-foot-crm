-- T-20260529-foot-SELFCHECKIN-FLOW-REVAMP (PUSH AC-8 갱신 — MSG-20260529-101051-iln0)
-- AC-8 '불일치 시 데스크 알림': fn_selfcheckin_rrn_match 에
--   · 매칭 실패 → check_ins.notes.rrn_match_pending = true (데스크 배지 표시)
--   · 매칭 성공 → notes.rrn_match_pending 플래그 제거
--
-- 전제: 20260529002000_selfcheckin_insurance_rrn_match.sql 적용 완료
-- 롤백: 20260529003000_selfcheckin_rrn_pending_flag.rollback.sql

BEGIN;

-- ─── fn_selfcheckin_rrn_match (REPLACE — rrn_match_pending 플래그 추가) ─────────────
-- 변경점:
--   1. 매칭 실패 시: UPDATE check_ins SET notes = jsonb_set(...) → rrn_match_pending = true
--   2. 매칭 성공 시: UPDATE check_ins SET notes = notes - 'rrn_match_pending' (플래그 해제)
--   3. 반환 JSONB에 rrn_pending 필드 추가 (FE 확인용)

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
  -- ① check_in 조회 + 보안 검증
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

  -- birth_date 미입력 → 매칭 불가 (pending 플래그도 세우지 않음 — 입력 자체가 없음)
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

  -- ④-A 매칭 없음 → rrn_match_pending 플래그 세우고 반환
  IF v_target_cust_id IS NULL THEN
    UPDATE check_ins
    SET    notes = COALESCE(notes, '{}'::jsonb) || '{"rrn_match_pending": true}'::jsonb
    WHERE  id = p_check_in_id;

    RETURN jsonb_build_object(
      'success',      true,
      'matched',      false,
      'rrn_pending',  true
    );
  END IF;

  -- ④-B 매칭 성공 → customer_id 교체 + pending 플래그 제거
  UPDATE check_ins
  SET    customer_id = v_target_cust_id,
         notes       = COALESCE(notes, '{}'::jsonb) - 'rrn_match_pending'
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 최신 데이터 병합
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
  WHERE dest.id = v_target_cust_id
    AND src.id  = v_self_cust_id;

  -- ⑥ selfcheckin 임시 고객 레코드 정리
  IF NOT EXISTS (
    SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id
  ) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'success',               true,
    'matched',               true,
    'merged_to_customer_id', v_target_cust_id,
    'rrn_pending',           false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_rrn_match IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-8(v2): 셀프접수 주민번호 자동 매칭.'
  ' birth_date(앞6자리) + 당일 check_in 조건. 매칭 실패 시 notes.rrn_match_pending=true 세팅'
  ' → 칸반 카드에 "주번확인" 배지로 데스크 알림. 성공 시 플래그 제거.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.';

COMMIT;
