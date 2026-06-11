-- T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN  (REVISE — policy_correction_jnz7)
-- ★ 정책 정정 (김주연 총괄 직접, MSG-...185107-jnz7 / §13.1.A reporter-authorized) ★
--   기존 20260611180000_closing_revenue_read_lock = '일마감'을 '매출집계'로 오분류 → WITHDRAWN.
--   본 마이그가 그 revise 본(교체). 기존 180000 운영 적용 금지.
--
-- ── 분류 실측 (FE 라우트·쿼리·스키마 근거) ──
--   • daily_closings / closing_manual_payments = ★일마감 workflow★ (daily closing workflow)
--       - 사용처: src/pages/Closing.tsx (/admin/closing, 화면 제목 "일마감"). 직원이 일일 마감 수행·열람.
--       - daily_closings 는 Closing.tsx 가 직접 insert/update(일마감 저장). 매출집계 '뷰'가 아님.
--   • 매출집계(실장별·치료사별 성과 집계) = ★별도★ src/pages/Sales.tsx (/admin/sales)
--       - payments / package_payments / package_sessions 직접 쿼리. daily_closings/closing_manual 미사용.
--       - route + nav = admin/manager 한정(EXCL) — 이미 직원 숨김. 본 마이그 무관(미접촉).
--   → 일마감 workflow 테이블에 '매출집계' 명목 LOCK 은 오적용. 일마감 수행 직원을 막아 NAV-BOUNCE 악화.
--
-- ── 일마감 수행 role (현장 기준) ──
--   전직원(8역할, tm 제외). 근거: 총괄 "일마감=직원 업무=staff OPEN" + 기존 daily_closings_staff_read
--   = is_floor_staff()(staff/part_lead 접수·안내용 열람, T-20260520-foot-STAFF-DAILY-READ) + finance(consultant/coordinator).
--   tm 은 최소권한(STAFF-ROLE-TM-ADD: 4메뉴 한정) → 메뉴 제외(RLS read 는 무해하게 허용되나 FE 미노출).
--
-- ── 이 마이그가 하는 일 (보안 하드닝만, role 잠금 아님) ──
--   유지(KEEP): clinic_id 스코프 도입 = 타 clinic 누수 차단 + 미승인(unapproved) authenticated 차단.
--   정정(FIX) : over-open `USING (true)` 를 canonical `is_approved_user() AND clinic_id = current_user_clinic_id()` 로 교체.
--              → 본인 clinic 의 approved 전직원이 read(일마감 parity 유지). 일마감 수행 role 잠금 0(닫지 않음).
--   미접촉    : finance_read(coordinator 포함)·staff_read·therapist_read·admin_all·write 정책 = 그대로(축소·삭제 안 함).
--              ★이전 LOCK 의 therapist_read DROP / coordinator 회수 = 취소(일마감 OPEN).★
--
-- ── 현재(prod) SELECT 정책 (180000 미적용 = 원본 상태) ──
--   daily_closings_admin_all      [ALL]    is_admin_or_manager()                              ← 유지
--   daily_closings_write          [ALL]    current_user_is_admin_or_manager()                 ← 유지(쓰기)
--   daily_closings_finance_read   [SELECT] (is_consultant_or_above() OR is_coordinator_or_above())  ← 유지(coordinator 포함, 회수 안 함)
--   daily_closings_read           [SELECT] true                                              ← ★canonical 로 교체(over-open만 제거)★
--   daily_closings_staff_read     [SELECT] is_floor_staff()                                  ← 유지(일마감 수행 직원)
--   daily_closings_therapist_read [SELECT] is_therapist_or_technician()                       ← 유지(삭제 안 함 — 일마감 OPEN)
--   closing_manual_payments.closing_manual_read [SELECT] true                                ← ★canonical 로 교체(over-open만 제거)★
--
-- ── 회귀가드 ──
--   AC-3(정정): 일마감 수행 role 잠금 0 — finance/staff/therapist read 미축소, over-open 만 clinic 스코프화.
--   AC-4: 쓰기 정책(daily_closings admin_all/write [ALL], closing_manual insert/update/delete) 미접촉.
--   AC-5: clinic_id = current_user_clinic_id() 단일 clinic 고정 → 타 clinic row 차단(기존 IN(true) 대비 더 엄격, PHI 비확장).
--   AC-6: blanket-open(true) 제거 = over-exposure(미승인 authenticated) 해소. 신규 blanket-open 미발생.
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611200000_closing_workflow_read_canonical.rollback.sql
-- 운영 적용: supervisor DB 게이트 (테이블별 단계 적용, blanket ALTER 금지).

BEGIN;

-- ── daily_closings : over-open(true) → canonical clinic-scoped parity ──
-- (일마감 workflow = 본인 clinic approved 전직원 read. 미승인/타 clinic 차단.)
DROP POLICY IF EXISTS daily_closings_read ON daily_closings;
CREATE POLICY daily_closings_read ON daily_closings
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY daily_closings_read ON daily_closings IS
  'T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN(policy_correction_jnz7): 일마감 workflow read parity. over-open(true) → approved+본인 clinic 전직원. 미승인 authenticated + 타 clinic 누수 차단. finance_read/staff_read/therapist_read(일마감 수행 role) 미축소.';

-- ── closing_manual_payments : over-open(true) → canonical clinic-scoped parity ──
-- (수기 결제내역 = 일마감 화면 구성요소. 동일 게이트.)
DROP POLICY IF EXISTS closing_manual_read ON closing_manual_payments;
CREATE POLICY closing_manual_read ON closing_manual_payments
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY closing_manual_read ON closing_manual_payments IS
  'T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN(policy_correction_jnz7): over-open(true) → approved+본인 clinic 전직원. 일마감 workflow read parity. INSERT/UPDATE/DELETE(clinic-scoped) 미접촉.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) daily_closings over-open 제거 + 일마감 수행 role read 유지 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='daily_closings' AND cmd='SELECT' ORDER BY policyname;
--    기대:
--      daily_closings_finance_read   USING (is_consultant_or_above() OR is_coordinator_or_above())   ← 유지(coordinator 포함)
--      daily_closings_read           USING (is_approved_user() AND clinic_id = current_user_clinic_id())  ← canonical(true 제거)
--      daily_closings_staff_read     USING is_floor_staff()                                          ← 유지
--      daily_closings_therapist_read USING is_therapist_or_technician()                              ← 유지(삭제 안 함)
--    → qual='true' 인 SELECT 정책 0건(over-open 제거).
-- 2) closing_manual_payments over-open 제거 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='closing_manual_payments' AND cmd='SELECT';
--    → closing_manual_read USING (is_approved_user() AND clinic_id = current_user_clinic_id())
-- 3) 쓰기 정책 불변(미접촉) 확인:
--    SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname='public' AND tablename IN ('daily_closings','closing_manual_payments') AND cmd <> 'SELECT' ORDER BY tablename, cmd;
-- 4) staff 계정 일마감 read 회귀 테스트(NAV-BOUNCE 해소 근거):
--    SELECT count(*) FROM daily_closings WHERE clinic_id = current_user_clinic_id();  -- staff 계정 실행 시 본인 clinic row 반환 기대(0 deny 아님).
