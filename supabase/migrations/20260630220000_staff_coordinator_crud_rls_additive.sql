-- T-20260630-foot-STAFFCRUD-CODY-PERM — 근무자(staff 로스터) write RLS coordinator ADDITIVE 확장
-- 요청: 김주연 총괄 (U0ATDB587PV, #project-doai-crm-풋확장, 2026-06-30 16:50 KST)
--   직원·공간 > 직원 탭의 근무자 '추가/삭제'를 coordinator 에게도 ADDITIVE 허용.
--   (T-20260620-foot-STAFF-PERM-UNLOCK-6MENU line172 [DEFERRED] §④ 보류분의 실티켓.)
--
-- ★★ DA_CONSULT_HOLD ★★ — 이 파일은 data-architect CONSULT GO + supervisor DDL-diff 수신 전까지 실행 금지.
--   GO 수신 후 suffix(.DA_CONSULT_HOLD) 제거 → dev-foot 직접 실행(learned: 'dev-foot DB 마이그레이션 직접 실행')
--   + FE(permissions.ts canManageStaff / Staff.tsx) 와 ★동반 landing★ 의무. FE 단독 merge = lock-out-in-disguise 금지.
-- rollback: see 20260630220000_staff_coordinator_crud_rls_additive.rollback.sql
--
-- ── RC (dev-foot 2026-06-30) ─────────────────────────────────────────────────
--   RC-first 분기 판정 = (b) RLS-backed.
--   surface = staff 로스터 테이블(StaffPage>StaffTab, supabase.from('staff').insert / .update{active}).
--     ※ user_profiles(로그인 계정) 아님 — staff.role enum = director/consultant/coordinator/therapist/technician
--       (admin/manager 부재). staff 로스터 생성 ≠ 계정 생성 → 권한상승 경로 아님. user_profiles 는 본건 미포함(admin-only 불변).
--   현 prod write-RLS:  staff_admin_all (20260426000000_rls_role_separation.sql:209)
--     = FOR ALL USING/CHECK is_admin_or_manager() = current_user_role() IN ('admin','manager','director').
--     → coordinator INSERT/UPDATE 거부. FE 만 풀면 lock-out-in-disguise → 본 마이그로 정합.
--
-- 원칙: ADDITIVE only. DROP 0, 기존 staff_admin_all/staff_approved_read 제거·변경 0. coordinator용 정책만 신규 추가.
--   helper: current_user_role() / current_user_clinic_id() (STABLE SECURITY DEFINER, 기존 정책 동일 패턴 미러).
--
-- ★guard1(권한상승 차단, 서버측 강제): coordinator 는 role='director'(원장) 행 INSERT/UPDATE 불가.
--   WITH CHECK + USING 양쪽에 role <> 'director' 부여 → 코디가 원장 로스터 생성/승격/비활성 불가. FE(assignableStaffRolesFor)와 이중 가드.
-- ★guard2(무회귀): 기존 admin/manager/director 동선 = staff_admin_all 그대로(무변경). 본 정책은 coordinator 전용 신규.
-- ★최소권한: FOR DELETE(하드삭제) 미부여 — FE 삭제동선 = soft-delete(UPDATE active=false) → INSERT/UPDATE 만 부여.
--   clinic-scoped: clinic_id = current_user_clinic_id() (cross-clinic write 차단).

BEGIN;

-- ── coordinator 근무자 추가(INSERT): role<>'director', 자기 clinic 한정 ──
DROP POLICY IF EXISTS staff_coordinator_insert_staffcrud ON public.staff;
CREATE POLICY staff_coordinator_insert_staffcrud ON public.staff
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = 'coordinator'
    AND clinic_id = current_user_clinic_id()
    AND role <> 'director'
  );
COMMENT ON POLICY staff_coordinator_insert_staffcrud ON public.staff IS
  'T-20260630-foot-STAFFCRUD-CODY-PERM: 근무자 추가 — coordinator ADDITIVE(role<>director 권한상승 가드, clinic-scoped). admin/mgr/dir 기존 유지.';

-- ── coordinator 근무자 수정/비활성(UPDATE): 기존행·신규값 모두 role<>'director' ──
DROP POLICY IF EXISTS staff_coordinator_update_staffcrud ON public.staff;
CREATE POLICY staff_coordinator_update_staffcrud ON public.staff
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'coordinator'
    AND clinic_id = current_user_clinic_id()
    AND role <> 'director'
  )
  WITH CHECK (
    current_user_role() = 'coordinator'
    AND clinic_id = current_user_clinic_id()
    AND role <> 'director'
  );
COMMENT ON POLICY staff_coordinator_update_staffcrud ON public.staff IS
  'T-20260630-foot-STAFFCRUD-CODY-PERM: 근무자 수정/삭제(soft=active=false) — coordinator ADDITIVE(원장행 수정 차단, clinic-scoped). 하드 DELETE 미부여(최소권한).';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- [본 파일 미포함 — 6MENU §④ DEFERRED 와 동일하게 user_profiles 는 별 건]
--   user_profiles(로그인 계정 생성/승인/role 변경) = 권한상승 → 본건 무관(admin-only 불변). 근무자 로스터(staff)만 확장.
-- ════════════════════════════════════════════════════════════════════════════
