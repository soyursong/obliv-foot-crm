-- T-20260529-foot-SELFCHECKIN-FLOW-REVAMP
-- 셀프체크인 개인정보 입력 + 발건강질문지 QR 토큰 발급 함수 (anon SECURITY DEFINER)
--
-- 신규 함수 2개:
--   fn_selfcheckin_update_personal_info  — 초진 고객 생년월일·주소·개인정보동의 저장
--   fn_selfcheckin_create_health_q_token — 접수 완료 후 발건강질문지 QR 토큰 발급
--
-- 보안 조건 (두 함수 공통):
--   - check_in 생성 30분 이내에만 허용
--   - clinic_id 일치 필수
--   - SECURITY DEFINER → anon RLS 우회 (최소 권한 원칙: 30분 창 + clinic_id 이중 검증)
--
-- 롤백: 20260529001000_selfcheckin_personal_info_fn.rollback.sql

BEGIN;

-- ─── 1. fn_selfcheckin_update_personal_info ───────────────────────────────────
-- 초진 셀프접수에서 고객 생년월일(앞6자리) + 주소 + 개인정보동의 업데이트
-- FE 호출: anonClient.rpc('fn_selfcheckin_update_personal_info', { p_check_in_id, p_clinic_id, p_birth_date, p_address, p_address_detail, p_privacy_consent })
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id    UUID,
  p_clinic_id      UUID,
  p_birth_date     TEXT     DEFAULT NULL,
  p_address        TEXT     DEFAULT NULL,
  p_address_detail TEXT     DEFAULT NULL,
  p_privacy_consent BOOLEAN DEFAULT NULL
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

  -- 30분 이내 생성된 체크인만 허용 (오래된 ID 재사용 방지)
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
    birth_date      = COALESCE(p_birth_date,      birth_date),
    address         = COALESCE(p_address,         address),
    address_detail  = COALESCE(p_address_detail,  address_detail),
    privacy_consent = COALESCE(p_privacy_consent, privacy_consent),
    updated_at      = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 초진 셀프접수 개인정보(생년월일·주소·동의) 저장.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증. 전체 RRN 비저장 (birth_date 앞6자리만).';

-- ─── 2. fn_selfcheckin_create_health_q_token ─────────────────────────────────
-- 셀프체크인 완료 후 발건강질문지 QR 토큰 발급
-- FE 호출: anonClient.rpc('fn_selfcheckin_create_health_q_token', { p_check_in_id, p_clinic_id })
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_create_health_q_token(
  p_check_in_id UUID,
  p_clinic_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci     check_ins%ROWTYPE;
  v_token  TEXT;
  v_tok_id UUID;
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

  -- 동일 고객의 미사용 기존 토큰 만료 (1인 1활성토큰 원칙)
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_ci.customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- 새 토큰 발급 (24시간 유효)
  v_token := encode(gen_random_bytes(24), 'base64url');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_token,
    v_ci.customer_id,
    p_clinic_id,
    p_check_in_id,
    'general',
    now() + INTERVAL '24 hours',
    NULL
  )
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object(
    'success', true,
    'token',   v_token,
    'id',      v_tok_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_create_health_q_token(UUID, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_create_health_q_token IS
  'T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 초진 셀프접수 완료 후 발건강질문지 QR 토큰 발급.'
  ' anon SECURITY DEFINER — 30분 이내 check_in + clinic_id 이중 검증.'
  ' 기존 미사용 토큰 만료 후 신규 발급 (24h 유효). 1인 1활성토큰.';

COMMIT;
