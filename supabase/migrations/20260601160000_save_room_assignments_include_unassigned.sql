-- T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN-3): 미배정 방도 명시적으로 기록
--
-- 근본 원인 (코드 확인 완료, 2026-06-01):
--   save_room_assignments RPC 가 INSERT 시 `WHERE NULLIF(x.staff_id,'') IS NOT NULL` 로
--   미배정(staff_id 빈/null) 방 행을 통째로 생략했다. 그 결과 저장 후 today 스냅샷에
--   해당 방 row 가 존재하지 않아 → 읽기 머지(baseline + today)가 baseline(전날) carry-over 로
--   되살려 "저장해도 리셋"처럼 보였다. (배정→배정은 staff_id 값이 있어 정상 → 부분적으로만 맞던 이유.)
--
-- 수정:
--   INSERT 의 `WHERE NULLIF(x.staff_id,'') IS NOT NULL` 조건을 제거 → null staff_id 행도 INSERT.
--   → today 에 "명시적 미배정" row 존재 → 읽기 머지에서 baseline carry-over 차단.
--   staff_id 는 NULLIF(x.staff_id,'')::uuid 로 변환(빈값 → NULL) 유지.
--
-- 변경 성격: additive (null staff_id 행 INSERT 추가). 기존 행 변경/삭제 없음.
--            스키마(테이블/컬럼/제약) 변경 없음. 함수 본문만 CREATE OR REPLACE.
--            인증/지점 가드(is_admin_or_manager + 동일 clinic) 현행 유지 (권한 확대 아님).
--
-- Rollback: 20260601160000_save_room_assignments_include_unassigned.down.sql
-- Ticket:   T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN-3)

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

  -- 3) 원자적 교체 (단일 트랜잭션 — INSERT 실패 시 DELETE 롤백 → today 보존)
  DELETE FROM room_assignments
   WHERE clinic_id = p_clinic_id
     AND date = p_date;

  -- REOPEN-3: WHERE NULLIF(x.staff_id,'') IS NOT NULL 제거 → 미배정(null) 방도 명시 INSERT.
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
  'T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN-3): 공간배정 당일 스냅샷 원자적 저장(DELETE+INSERT 1트랜잭션). 미배정(null staff) 방도 명시 INSERT → baseline carry-over 차단. is_admin_or_manager()+동일 clinic 가드.';

GRANT EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) FROM anon, public;

COMMIT;
