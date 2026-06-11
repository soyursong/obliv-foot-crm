-- T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN  (RLS-MENU-ROLE-PARITY 우산 WS-2 집행 child)
-- planner MSG-20260611-135000-b4sj #2: D-7 daily_closings/closing_manual = EXCL 확정 + LOCK(회수) 우선.
--   "역방향 누수=보안" → Phase2-A(C그룹)보다 우선. closing route coordinator/therapist 노출분도 회수.
--
-- ── 정책 판정 ──
--   daily_closings / closing_manual_payments = 매출집계(일마감 settlement) = EXCL(파리티 제외, 민감).
--   "권한 풀린 메뉴=데이터도 parity" 정책의 역 — 매출은 mgmt/finance/desk 한정이어야 하는데
--   현재 over-open(USING true) + coordinator + therapist 까지 read 가능 = 역방향 과다노출(누수).
--
-- ── 현재 daily_closings SELECT readers (Phase 1 raw dump) ──
--   daily_closings_admin_all     [ALL]    is_admin_or_manager()                              ← 유지(admin/manager/director)
--   daily_closings_write         [ALL]    current_user_is_admin_or_manager()                 ← 유지(쓰기)
--   daily_closings_finance_read  [SELECT] (is_consultant_or_above() OR is_coordinator_or_above())  ← coordinator 회수 → consultant_or_above 단독
--   daily_closings_read          [SELECT] true                                              ← ★삭제(over-open 누수)
--   daily_closings_staff_read    [SELECT] is_floor_staff()                                  ← 유지(데스크 운영직: 일마감 수행 주체)
--   daily_closings_therapist_read[SELECT] is_therapist_or_technician()                       ← ★삭제(시술자 매출열람 불요)
--
-- ── closing_manual_payments (수기 결제내역, 매출집계 동일) ──
--   closing_manual_read [SELECT] true  ← ★over-open → daily_closings 잠금 후 reader set 과 동일 게이트로 교체
--
-- ── 회수 후 최종 reader set (daily_closings = closing_manual 동일) ──
--   admin/manager/director (admin_all) ∪ consultant (finance_read) ∪ staff/part_lead/tm (is_floor_staff)
--   = is_consultant_or_above() OR is_floor_staff()
--   제거됨: coordinator, therapist, technician, 미승인 authenticated(over-open).
--
-- ── 회귀가드 ──
--   AC-4: 쓰기 정책(admin_all/write ALL, closing_manual insert/update/delete) 미접촉.
--   AC-5: clinic 스코프 — daily_closings 는 admin_all/write 가 clinic 경계 담당(미접촉),
--         closing_manual insert/update/delete 가 clinic 경계 담당(미접촉). 본 마이그는 SELECT readers 축소만.
--   AC-6: blanket-open 제거(누수 해소). 신규 blanket-open 미발생.
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611180000_closing_revenue_read_lock.rollback.sql
-- 운영 적용: supervisor DB 게이트 (테이블별 단계 적용, blanket ALTER 금지).

BEGIN;

-- ── daily_closings ──
-- 1) over-open 삭제 (미승인 authenticated 포함 전원 read = 누수)
DROP POLICY IF EXISTS daily_closings_read ON daily_closings;

-- 2) therapist/technician 매출열람 회수
DROP POLICY IF EXISTS daily_closings_therapist_read ON daily_closings;

-- 3) finance_read 에서 coordinator 회수 (consultant_or_above 단독 유지)
DROP POLICY IF EXISTS daily_closings_finance_read ON daily_closings;
CREATE POLICY daily_closings_finance_read ON daily_closings
  FOR SELECT
  USING ( is_consultant_or_above() );

COMMENT ON POLICY daily_closings_finance_read ON daily_closings IS
  'T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN: coordinator 회수. consultant_or_above(admin/manager/director/consultant) 한정 read. (staff_read=is_floor_staff 별도 유지)';

-- ── closing_manual_payments (매출집계 동일 처리) ──
-- over-open(true) → daily_closings 잠금 후 reader set 동일 게이트
DROP POLICY IF EXISTS closing_manual_read ON closing_manual_payments;
CREATE POLICY closing_manual_read ON closing_manual_payments
  FOR SELECT
  USING ( is_consultant_or_above() OR is_floor_staff() );

COMMENT ON POLICY closing_manual_read ON closing_manual_payments IS
  'T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN: over-open(true) 회수 → daily_closings 잠금 후 reader set 동일(consultant_or_above ∪ floor_staff). coordinator/therapist/technician/미승인 제거. INSERT/UPDATE/DELETE 미접촉.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) daily_closings over-open 제거 확인 (qual='true' SELECT 정책 0건):
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='daily_closings' AND cmd='SELECT' ORDER BY policyname;
--    → daily_closings_read 부재 / daily_closings_therapist_read 부재 / finance_read=is_consultant_or_above() / staff_read=is_floor_staff()
-- 2) closing_manual_payments over-open 제거 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='closing_manual_payments' AND cmd='SELECT';
--    → closing_manual_read USING (is_consultant_or_above() OR is_floor_staff())
-- 3) 쓰기 정책 불변 확인(미접촉):
--    SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname='public' AND tablename IN ('daily_closings','closing_manual_payments') AND cmd <> 'SELECT' ORDER BY tablename, cmd;
