-- ROLLBACK: T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM
-- 20260611220000_room_assignments_staff_write_scoped.sql 원복.
--   (C)(D) 신규 INSERT/UPDATE 정책 제거 + (B) RPC 가드를 is_admin_or_manager() 로 환원.
--   (A) 헬퍼 can_assign_rooms() 는 DROP (다른 의존 없음 — 본 마이그가 유일 도입).
-- 원복 후 직원 공간배정 write 는 다시 차단(admin/manager/director 전용)되고
-- 기존 room_assignments_staff_update(is_floor_staff)·admin_all 은 그대로 유지된다.

BEGIN;

-- (C)(D) 신규 직원 write 정책 제거
DROP POLICY IF EXISTS room_assignments_assign_insert ON room_assignments;
DROP POLICY IF EXISTS room_assignments_assign_update ON room_assignments;

-- (B) RPC 가드 원복 (can_assign_rooms → is_admin_or_manager). 본문/clinic 가드 동일.
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
         AS x(room_name text, room_type text, staff_id text, staff_name text)
   WHERE NULLIF(x.staff_id, '') IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.save_room_assignments(uuid, date, jsonb) IS
  'T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS: 공간배정 당일 스냅샷 원자적 저장(DELETE+INSERT 1트랜잭션). is_admin_or_manager()+동일 clinic 가드. 부분 실패 시 today 보존.';

GRANT EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) FROM anon, public;

-- (A) 헬퍼 제거 (위 RPC 가 더 이상 참조 안 함 → 안전)
DROP FUNCTION IF EXISTS can_assign_rooms();

COMMIT;
