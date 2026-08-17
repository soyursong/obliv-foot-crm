-- ROLLBACK T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST
-- 게이트를 확대 전(is_admin_or_manager = admin/manager/director)으로 원복.
-- (원본 = 20260612140000_pkg_session_soft_delete_restore.sql §3/§4 와 동일 게이트.)

BEGIN;

CREATE OR REPLACE FUNCTION soft_delete_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only';
  END IF;
  UPDATE package_sessions
     SET status = 'deleted', deleted_at = now(), deleted_by = current_staff_id()
   WHERE id = p_session_id AND status = 'used';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in used state';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION restore_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only';
  END IF;
  UPDATE package_sessions
     SET status = 'used', deleted_at = NULL, deleted_by = NULL
   WHERE id = p_session_id AND status = 'deleted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in deleted state';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_package_session(UUID) FROM public;
REVOKE ALL ON FUNCTION restore_package_session(UUID) FROM public;
GRANT EXECUTE ON FUNCTION soft_delete_package_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_package_session(UUID) TO authenticated;

COMMIT;
