-- T-20260529-foot-HEALTH-Q-MOBILE REOPEN2 — PostgREST schema cache hotfix
--
-- 원인: REOPEN1(b7d9856) 에서 supabase db query --linked 로 직접 SQL 적용 시
--       PostgreSQL DDL 트리거가 PostgREST NOTIFY를 발송하지 않아 schema cache stale.
--       결과: "Could not find the function public.fn_health_q_create_token(...) in the schema cache"
--
-- 수정: fn_health_q_create_token CREATE OR REPLACE (idempotent) + NOTIFY pgrst 명시 포함
--       이 migration이 적용되면 PostgREST schema cache 가 반드시 reload됨.
--
-- 롤백: 이 migration은 기존 함수를 동일 시그니처로 재정의하므로 별도 롤백 불필요.
--       함수 자체를 제거하려면 20260529000000_health_q_mobile.rollback.sql 사용.
--
-- AC-R2-2: FE 호출 파라미터 ↔ DB 함수 시그니처 정확 일치 보장
--   FE(HealthQResultsPanel.tsx) sends:
--     { p_customer_id, p_clinic_id, p_form_type, p_check_in_id, p_expires_days }
--   DB 함수 (아래 정의):
--     fn_health_q_create_token(p_customer_id uuid, p_clinic_id uuid, p_form_type text, p_check_in_id uuid, p_expires_days int)
--   → 100% 일치

-- ─── fn_health_q_create_token (idempotent re-create) ─────────────────────────
CREATE OR REPLACE FUNCTION fn_health_q_create_token(
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_form_type    TEXT    DEFAULT 'general',
  p_check_in_id  UUID    DEFAULT NULL,
  p_expires_days INT     DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id  UUID;
  v_new_token TEXT;
  v_new_id    UUID;
BEGIN
  -- 직원 권한 확인
  SELECT id INTO v_staff_id
  FROM   staff
  WHERE  user_id    = auth.uid()
    AND  clinic_id  = p_clinic_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- 기존 미사용 토큰 만료 (1인 1활성토큰)
  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = p_customer_id
    AND  clinic_id   = p_clinic_id
    AND  form_type   = p_form_type
    AND  used_at     IS NULL
    AND  expires_at  > now();

  -- 새 토큰 발급
  v_new_token := encode(gen_random_bytes(24), 'base64url');

  INSERT INTO health_q_tokens (
    token, customer_id, clinic_id, check_in_id,
    form_type, expires_at, created_by
  )
  VALUES (
    v_new_token,
    p_customer_id,
    p_clinic_id,
    p_check_in_id,
    p_form_type,
    now() + (p_expires_days || ' days')::INTERVAL,
    v_staff_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'token',   v_new_token,
    'id',      v_new_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT) TO authenticated;

-- ─── PostgREST schema cache 강제 reload ──────────────────────────────────────
-- CREATE OR REPLACE 후 PostgREST 가 schema cache를 갱신하도록 NOTIFY 명시 발송.
-- Supabase DDL 트리거가 작동하지 않는 환경(직접 SQL 적용 등)에서의 안전망.
SELECT pg_notify('pgrst', 'reload schema');
