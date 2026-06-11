-- T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM (P2, approved, GO_WARN)
-- 김주연 총괄(U0ATDB587PV): "공간 배정건도 직원 계정은 권한 막혀있음 관리자만 수정 반영 가능함"
-- → 공간배정(상담실/치료실/레이저실) write 권한을 직원(staff 운영 role)에 scoped 부여.
--
-- ── Phase 1 차단 원인 판별 (AC-1, read-only 진단 결과) ──
--   차단은 FE 메뉴/버튼 게이트가 아니라 **백엔드 2지점**이다:
--     (1) RPC save_room_assignments (Staff.tsx handleSave 일간 저장 경로, SECURITY DEFINER)
--         내부 가드 `IF NOT is_admin_or_manager()` → admin/manager/director 외 전원 RAISE EXCEPTION.
--     (2) room_assignments 직접 write RLS (Staff.tsx handleWeekAssign 주간 / Dashboard.handleStaffAssign):
--         - INSERT: room_assignments_admin_all(is_admin_or_manager) 단독 → 직원 INSERT 전원 차단.
--         - UPDATE: room_assignments_staff_update(is_floor_staff = admin/manager/director/staff/part_lead/tm)
--                   → consultant/coordinator/therapist(공간 탭 접근 가능 운영 role)는 UPDATE 도 누락.
--   FE 저장 버튼은 role 게이트 없음(disabled={saving} 뿐) → FE 변경 불요. 백엔드 최소 변경만.
--
-- ── 수정 (공간배정 테이블 한정 · scoped write 개방) ──
--   (A) 헬퍼 can_assign_rooms(): approved 직원 중 운영 8 role(=FE ALL_STAFF_ROLES SSOT) 판정.
--       ★tm 제외★(STAFF-ROLE-TM-ADD 최소권한: tm=4메뉴 고정, 공간배정 화면 미접근).
--   (B) RPC save_room_assignments 인증 가드: is_admin_or_manager() → can_assign_rooms().
--       원자적 DELETE+INSERT 본문/clinic 가드/RECUR5 carry-over 패턴은 그대로(권한 술어만 교체).
--   (C) room_assignments_assign_insert (신규 INSERT): can_assign_rooms() AND clinic 스코프.
--       → handleWeekAssign / Dashboard.handleStaffAssign 의 신규 셀 INSERT 직원 허용.
--   (D) room_assignments_assign_update (신규 UPDATE): can_assign_rooms() AND clinic 스코프.
--       → consultant/coordinator/therapist UPDATE 갭 충전. 기존 staff_update(is_floor_staff,tm 포함)는
--         미접촉 보존 → tm/floor staff UPDATE 회귀 0 (permissive OR 결합).
--
-- ── 범위 한정 / 회귀가드 (절대 준수) ──
--   AC-2(직원 write 가능): 일간(RPC)·주간(INSERT/UPDATE)·대시보드 배정/재배정/unassign 직원 반영.
--   AC-3(blanket 금지): room_assignments **단일 테이블만** 접촉. 급여/정산/감사로그 등 민감 write 미개방.
--   AC-4(clinic 스코프): 신규 INSERT/UPDATE WITH CHECK 에 clinic_id = current_user_clinic_id() 강제.
--                        RPC 도 동일 clinic 가드 유지 → 타 clinic 방배정 write 불가.
--   AC-5(DELETE 미부여): 직원 DELETE 정책 **추가 안 함**. 행 삭제는 admin_all(관리자) 단독 유지.
--                        unassign 은 staff_id=NULL "명시적 미배정" UPDATE/INSERT 로 처리(행 보존).
--                        ※RPC 내부 DELETE 는 SECURITY DEFINER(소유자 권한)로 실행 — 직원에게
--                          테이블 DELETE 권한을 주는 것이 아니라 RPC 가드(can_assign_rooms+clinic)로만 게이트.
--   AC-6(RECUR5 정합): RPC 의 원자 DELETE+INSERT + FE live-merge(미터치 방 보존·null-row 보존·
--                      room별 prior-latest carry-over) 로직 미변경. 권한만 확대 → staff 저장이
--                      다른 방 blind-overwrite/reset 유발 안 함(RECUR6 방지).
--   AC-7(admin 회귀): admin_all / approved_read / staff_update / RPC 본문 미변경 → 관리자 동작 회귀 0.
--
-- 멱등(idempotent): 헬퍼 CREATE OR REPLACE / 정책 DROP IF EXISTS 후 재생성.
-- data-architect consult: not-required (RLS + 기존 RPC 본문 술어 교체만, 신규 컬럼/테이블/enum 0).
-- Rollback: 20260611220000_room_assignments_staff_write_scoped.rollback.sql
-- 운영 적용: ★supervisor DB 게이트 (room_assignments 단일 테이블 + RPC 가드. blanket ALTER 금지).

BEGIN;

-- ============================================================
-- (A) 헬퍼: 공간배정 write 가능 운영 직원 판정 (tm 제외, FE ALL_STAFF_ROLES SSOT 동기)
-- ============================================================
CREATE OR REPLACE FUNCTION can_assign_rooms()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN (
       'admin','manager','director','consultant','coordinator','therapist','part_lead','staff'
     );
$$;

COMMENT ON FUNCTION can_assign_rooms() IS
  'T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM: 공간배정 write 가능 운영 직원(approved + 8 role, tm 제외). FE src/lib/permissions.ts ALL_STAFF_ROLES 와 동일 집합. clinic 스코프는 호출 정책/RPC 에서 별도 강제.';

GRANT EXECUTE ON FUNCTION can_assign_rooms() TO authenticated;
REVOKE EXECUTE ON FUNCTION can_assign_rooms() FROM anon, public;

-- ============================================================
-- (B) RPC save_room_assignments 인증 가드 교체 (is_admin_or_manager → can_assign_rooms)
--     ※ 원자 DELETE+INSERT 본문 / clinic 가드 / NULLIF unassign 처리 전부 동일 (RECUR5 보존).
-- ============================================================
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
  -- 1) 인증 가드 — 공간배정 운영 직원(can_assign_rooms, tm 제외)로 확대
  --    (T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM: 기존 is_admin_or_manager 에서 교체)
  IF NOT can_assign_rooms() THEN
    RAISE EXCEPTION '권한 없음: 공간 배정 저장 권한이 없습니다 (role=%).', current_user_role()
      USING ERRCODE = '42501';
  END IF;

  -- 2) 지점 가드 (자기 clinic 만 — AC-4)
  IF p_clinic_id IS DISTINCT FROM current_user_clinic_id() THEN
    RAISE EXCEPTION '권한 없음: 다른 지점의 공간 배정은 저장할 수 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  -- 3) 원자적 교체 (단일 트랜잭션 — INSERT 실패 시 DELETE 롤백 → today 보존. RECUR5 패턴 불변)
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
  'T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM: 공간배정 당일 스냅샷 원자적 저장(DELETE+INSERT 1트랜잭션). can_assign_rooms()(운영 직원, tm 제외)+동일 clinic 가드. 부분 실패 시 today 보존(RECUR5).';

GRANT EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_room_assignments(uuid, date, jsonb) FROM anon, public;

-- ============================================================
-- (C) room_assignments INSERT — 직원 운영 role 허용 (clinic 스코프, AC-2/AC-4)
--     기존 room_assignments_admin_all(ALL, mgmt)과 permissive OR 결합. DELETE 미부여(AC-5).
-- ============================================================
DROP POLICY IF EXISTS room_assignments_assign_insert ON room_assignments;
CREATE POLICY room_assignments_assign_insert ON room_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    can_assign_rooms()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY room_assignments_assign_insert ON room_assignments IS
  'T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM: 운영 직원(can_assign_rooms, tm 제외)이 본인 clinic 공간배정 INSERT. 주간뷰/대시보드 신규 셀 배정. clinic 스코프 강제, DELETE 미부여.';

-- ============================================================
-- (D) room_assignments UPDATE — consultant/coordinator/therapist 갭 충전 (clinic 스코프)
--     기존 room_assignments_staff_update(is_floor_staff, tm 포함)는 미접촉 → tm/floor staff 회귀 0.
-- ============================================================
DROP POLICY IF EXISTS room_assignments_assign_update ON room_assignments;
CREATE POLICY room_assignments_assign_update ON room_assignments
  FOR UPDATE TO authenticated
  USING (
    can_assign_rooms()
    AND clinic_id = current_user_clinic_id()
  )
  WITH CHECK (
    can_assign_rooms()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY room_assignments_assign_update ON room_assignments IS
  'T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM: 운영 직원(can_assign_rooms, tm 제외)이 본인 clinic 공간배정 UPDATE/unassign(staff_id=NULL). is_floor_staff 가 누락한 consultant/coordinator/therapist 충전. WITH CHECK 로 clinic 이전 차단.';

COMMIT;

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- 1) room_assignments write 정책 (DELETE 직원 미부여 확인):
--    SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='room_assignments' ORDER BY cmd, policyname;
--    기대:
--      room_assignments_admin_all      | ALL    (is_admin_or_manager)        ← 미변경
--      room_assignments_approved_read  | SELECT (is_approved_user)           ← 미변경
--      room_assignments_assign_insert  | INSERT (can_assign_rooms + clinic)  ← 신규
--      room_assignments_assign_update  | UPDATE (can_assign_rooms + clinic)  ← 신규
--      room_assignments_staff_update   | UPDATE (is_floor_staff)             ← 미변경(tm 보존)
--    ★ DELETE cmd 의 직원 정책 0건 (admin_all ALL 만) — AC-5
-- 2) RPC 가드 교체 확인:
--    SELECT prosrc FROM pg_proc WHERE proname='save_room_assignments';  → can_assign_rooms() 포함
-- 3) 다른 민감 테이블 미접촉(AC-3): 본 마이그는 room_assignments + 2 함수만 ALTER.
