-- T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (REOPEN): save_room_assignments blanket-DELETE → payload-scoped DELETE
--
-- 근본 원인 (prod DB 실측, 2026-06-08):
--   save_room_assignments RPC 가 `DELETE FROM room_assignments WHERE clinic_id AND date` 로
--   당일 모든 행을 지운 뒤, Staff 페이지가 보낸 payload(= active rooms.map) 만 재 INSERT 한다.
--   그 결과 active rooms 테이블에 없는 room_name/type 행이 매 저장마다 영구 삭제된다:
--     - 'heated_laser' / '가열성레이저' (Dashboard 가열성레이저 슬롯 전용, Staff 페이지엔 없음)
--     - orphan 행(room_name '1','2','3' 등 레거시)
--   가열성레이저 원장 배정이 Staff 저장 시 소실 → Dashboard 에서 "저장해도 리셋"으로 보임.
--   (실측: 가열성레이저 배정 이력 2026-05-22 이후 끊김 = 후속 저장으로 wipe 된 정황.)
--
-- 수정:
--   DELETE 를 payload 에 포함된 room_name 으로 한정한다. payload 에 없는 방(가열성레이저 등)은
--   Staff 페이지가 관리하지 않으므로 건드리지 않고 보존 → 데이터 무손실.
--   payload 에 있는 방은 종전과 동일하게 DELETE→INSERT(미배정 null 포함) 원자 교체.
--
-- 변경 성격: 함수 본문만 CREATE OR REPLACE. 스키마/데이터 변경 없음. 기존 active-room 저장 동작은
--   완전 동일(이들은 항상 payload 에 포함). 비-payload 방을 '덜 지우는' 방향 → strictly safer.
--   인증/지점 가드 현행 유지.
--
-- Rollback: 20260608140000_save_room_assignments_scoped_delete.down.sql
-- Ticket:   T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (REOPEN)

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
  -- 1) 인증 가드 (현행 INSERT/DELETE RLS 와 동일: admin/manager/director)
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION '권한 없음: 공간 배정 저장 권한이 없습니다 (role=%).', current_user_role()
      USING ERRCODE = '42501';
  END IF;

  -- 2) 지점 가드 (자기 clinic 만)
  IF p_clinic_id IS DISTINCT FROM current_user_clinic_id() THEN
    RAISE EXCEPTION '권한 없음: 다른 지점의 공간 배정은 저장할 수 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  -- 3) payload-scoped 원자 교체:
  --    payload 에 포함된 room_name 만 삭제 후 재 INSERT. payload 에 없는 방(가열성레이저 등
  --    Dashboard 전용 슬롯)은 보존 → 데이터 무손실.
  DELETE FROM room_assignments
   WHERE clinic_id = p_clinic_id
     AND date = p_date
     AND room_name IN (
       SELECT x.room_name
         FROM jsonb_to_recordset(p_assignments)
              AS x(room_name text, room_type text, staff_id text, staff_name text)
     );

  -- 미배정(null staff) 방도 명시 INSERT → baseline carry-over 차단 (REOPEN-3 유지).
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

COMMENT ON FUNCTION public.save_room_assignments(uuid, date, jsonb) IS
  'T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (REOPEN): 공간배정 당일 스냅샷 원자 저장. DELETE 를 payload room_name 으로 한정 → 가열성레이저 등 비-payload 슬롯 보존(데이터 무손실). 미배정(null) 방도 명시 INSERT(carry-over 차단). is_admin_or_manager()+동일 clinic 가드.';

GRANT EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) FROM anon, public;

COMMIT;
