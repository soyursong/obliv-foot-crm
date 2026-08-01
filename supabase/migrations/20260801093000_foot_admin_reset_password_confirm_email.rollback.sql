-- ROLLBACK: T-20260801 스펙4 — admin_reset_user_password 를 email_confirmed_at 보강 이전
--   정의(20260517000020_admin_reset_password_search_path_fix)로 CREATE OR REPLACE 복원.
--   ⚠ 이미 세팅된 email_confirmed_at 값은 되돌리지 않음(활성 계정 보존).
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  target_user_id UUID,
  new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;
  RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

COMMIT;
