-- T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-2
-- fn_health_q_submit: 발건강질문지 "저장" 시 연결된 체크인을
--   [접수중](receiving) → [상담대기](consult_waiting) 자동 전이.
--
-- 설계:
--   설문 저장 이벤트는 anon 클라이언트가 fn_health_q_submit RPC 호출로만 발생.
--   상태 전이를 이 SECURITY DEFINER 함수 안에서 처리 → 신규 anon 쓰기 경로 신설 없음
--   (planner DECISION ⓐ: 기존 경로 재사용).
--   가드: check_in_id 존재 + 현재 status='receiving' 인 경우만 전이.
--         → 직원이 이미 다른 슬롯으로 수동 이동(AC-6)했거나 다른 상태이면 건드리지 않음(AC-4 회귀 금지).
--
-- 기준: 20260529000000_health_q_mobile.sql 의 fn_health_q_submit 본문 + 전이 블록 추가.
-- Rollback: 20260602240020_health_q_submit_receiving_transition.rollback.sql
-- 운영 적용: supervisor 게이트.

CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token        TEXT,
  p_form_data    JSONB,
  p_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok      health_q_tokens%ROWTYPE;
  v_result_id UUID;
BEGIN
  -- FOR UPDATE: 동시 제출 race condition 방지
  SELECT * INTO v_tok
  FROM   health_q_tokens
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_submitted');
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  INSERT INTO health_q_results (
    token_id, customer_id, clinic_id, check_in_id,
    form_type, form_data, storage_path, submitted_at
  )
  VALUES (
    v_tok.id, v_tok.customer_id, v_tok.clinic_id, v_tok.check_in_id,
    v_tok.form_type, p_form_data, p_storage_path, now()
  )
  RETURNING id INTO v_result_id;

  UPDATE health_q_tokens
  SET    used_at = now()
  WHERE  id = v_tok.id;

  -- T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-2: receiving → consult_waiting 전이
  IF v_tok.check_in_id IS NOT NULL THEN
    UPDATE check_ins
    SET    status = 'consult_waiting'
    WHERE  id = v_tok.check_in_id
      AND  status = 'receiving';

    -- 실제 전이가 발생한 경우만 감사 로그
    IF FOUND THEN
      INSERT INTO status_transitions (check_in_id, clinic_id, from_status, to_status)
      VALUES (v_tok.check_in_id, v_tok.clinic_id, 'receiving', 'consult_waiting');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'result_id',  v_result_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT) TO anon, authenticated;
