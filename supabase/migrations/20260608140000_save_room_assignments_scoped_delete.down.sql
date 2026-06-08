-- Rollback: T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (REOPEN) scoped-delete
-- 20260601160000 (REOPEN-3) 의 blanket-DELETE 버전으로 되돌린다.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_room_assignments(
  p_clinic_id uuid,
  p_date date,
  p_assignments jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION '권한 없음: 공간 배정 저장 권한이 없습니다 (role=%).', current_user_role()
      USING ERRCODE = '42501';
  END IF;

  IF p_clinic_id IS DISTINCT FROM current_user_clinic_id() THEN
    RAISE EXCEPTION '권한 없음: 다른 지점의 공간 배정은 저장할 수 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM room_assignments
   WHERE clinic_id = p_clinic_id
     AND date = p_date;

  INSERT INTO room_assignments (clinic_id, date, room_name, room_type, staff_id, staff_name)
  SELECT p_clinic_id,
         p_date,
         x.room_name,
         x.room_type,
         NULLIF(x.staff_id, '')::uuid,
         x.staff_name
    FROM jsonb_to_recordset(p_assignments)
         AS x(room_name text, room_type text, staff_id text, staff_name text);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) FROM anon, public;

COMMIT;
