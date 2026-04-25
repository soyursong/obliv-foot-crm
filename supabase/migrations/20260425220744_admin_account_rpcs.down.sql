-- T-20260420-foot-048 rollback: drop admin account RPCs
-- 데이터 변경 없음 (CREATE FUNCTION 만 ROLLBACK). user_profiles/staff/auth.users는 유지.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_register_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.admin_reset_user_password(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_toggle_user_active(UUID, BOOLEAN);

COMMIT;
