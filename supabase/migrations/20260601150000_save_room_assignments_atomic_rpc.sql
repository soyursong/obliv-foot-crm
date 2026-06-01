-- T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN): 공간배정 저장 원자화 RPC
--
-- 근본 원인 (DB 실측 기반, 2026-06-01):
--   FE handleSave 가 room_assignments 에 대해 비원자적 DELETE → INSERT 를 수행한다.
--     1) DELETE today  → 성공
--     2) INSERT 전체    → 네트워크/일시 오류로 실패
--   이 경우 today 행이 통째로 비워진 채 INSERT 만 실패하여, 재진입 시 읽기 머지가
--   직전날(baseline) carry-over 만 표시 → 현장 체감 "저장 눌러도 리셋".
--   (마지막 저장이 완전 성공하면 멀쩡하지만, 부분 실패 1회로 today 소실 → 리셋 회귀.)
--
--   추가로 INSERT/DELETE RLS 는 is_admin_or_manager() (admin/manager/director) 만 허용한다.
--   admin/manager 가 아닌 역할이 화면을 조작하면 DELETE 는 RLS 필터로 0-row silent(error null),
--   INSERT 는 RLS 위반 에러 → 저장이 반만 적용/실패. (별도 권한 정책 검토 필요 — planner 보고)
--
-- 수정:
--   save_room_assignments(p_clinic_id, p_date, p_assignments jsonb) RPC 도입.
--   - 함수 = 단일 트랜잭션 → DELETE + INSERT 원자적. INSERT 실패 시 DELETE 롤백 → today 보존.
--   - SECURITY DEFINER 로 실행하되, 내부에서 is_admin_or_manager() + 동일 clinic 가드.
--     → 현행 쓰기 인증 정책(admin/manager/director)을 그대로 보존 (권한 확대 아님).
--   - 권한/오류 시 RAISE EXCEPTION → supabase 가 error 반환 → FE 가 실패 토스트 노출 (silent 금지).
--
-- 데이터 무손실: DELETE+INSERT 를 한 트랜잭션으로 묶어 부분 실패 시 today 가 살아남는다(현행보다 안전).
--                 스키마(테이블/컬럼/제약) 변경 없음. 함수만 추가(additive).
--
-- Rollback: 20260601150000_save_room_assignments_atomic_rpc.down.sql
-- Ticket:   T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS

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

COMMIT;
