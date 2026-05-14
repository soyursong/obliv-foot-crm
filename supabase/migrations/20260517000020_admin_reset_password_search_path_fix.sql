-- T-20260514-foot-PW-GENSALT-FIX: admin_reset_user_password search_path 수정
-- 문제: pgcrypto(gen_salt)가 extensions 스키마에 있으나 기존 함수 search_path에 extensions 미포함
--       → function gen_salt(unknown) does not exist 에러 발생 (계정관리 비밀번호 변경 불가)
-- 수정: SET search_path = public, auth, extensions (extensions 추가)
-- 선례: 20260510000020_rrn_functions_fix.sql (동일 패턴)
-- 롤백: 20260517000020_admin_reset_password_search_path_fix.down.sql

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
  -- 가드
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only' USING ERRCODE = '42501';
  END IF;

  -- 비번 정책
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'password too short (min 6)' USING ERRCODE = '22023';
  END IF;

  -- target 존재 확인
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'auth.users(%) not found', target_user_id USING ERRCODE = '23503';
  END IF;

  -- bcrypt 해시로 직접 업데이트 (gen_salt는 pgcrypto → extensions 스키마)
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN jsonb_build_object('user_id', target_user_id, 'reset_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID, TEXT) TO authenticated;

COMMIT;
