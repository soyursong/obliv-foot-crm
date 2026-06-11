-- T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G2 (clinic_events)
-- planner 게이트 판정 MSG-20260611-134442-gsgf: G2 = OPEN 확정 → canonical parity-fix.
--
-- ── 확정 RC (Phase 1 전수감사 raw dump, READ-only) ──
--   clinic_events 의 SELECT 정책(clinic_events_select)이 유일하게 "비정규" 신원 소스
--   (staff.id = auth.uid()) 를 사용. 로그인 신원은 user_profiles 기준인데 staff.id 는
--   staff 테이블의 PK 라서 auth.uid() 와 사실상 매칭되지 않음 → 직원·관리자 거의 전원
--   clinic_events SELECT 0건. 대시보드 사이드바 ClinicCalendar 가 전 role 공유 메뉴인데도
--   일정 이벤트가 비어 보이는 망가진 정책. health_q outlier 와 동일 RC 패밀리.
--
--   raw dump (scripts/audit_out/T-20260611-RLS-PARITY_phase1_dump.txt):
--     clinic_events_select [SELECT] USING:
--       (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id = auth.uid()))
--
-- ── 수정 (SELECT 정책만 정규 패턴 전환) ──
--     is_approved_user()                       → user_profiles 기반(approved+active 전 role)
--     AND clinic_id = current_user_clinic_id()  → clinic 스코프 명시 유지(PHI 비확장)
--   = health_q_results/tokens(20260611150000) 와 동일한 canonical 술어.
--
-- ── 범위 한정 (회귀가드) ──
--   AC-4: SELECT 정책만 교체. INSERT/UPDATE/DELETE(clinic_events_insert/update/delete) 미접촉
--         (쓰기 권한 불변, READ parity 범위). 주의: 쓰기 3정책도 staff.id=auth.uid() 비정규라
--         이벤트 생성/수정/삭제가 깨질 소지 있음 → READ parity 범위 밖. planner 에 별도 발견 보고
--         (WS-1/form_templates write OUTLIER 와 동류). 본 마이그에서는 의도적으로 미접촉.
--   AC-5: clinic_id = current_user_clinic_id() 단일 clinic 고정 → 타 clinic row 차단(PHI 비확장).
--         (기존 IN(staff subquery) 대비 오히려 더 엄격.)
--   AC-6: blanket-open 미발생. clinic 스코프 + approved 게이트 유지.
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611160000_clinic_events_select_rls_canonical.rollback.sql
-- 운영 적용: supervisor DB 게이트 (테이블별 단계 적용, blanket ALTER 금지).

BEGIN;

-- clinic_events SELECT: 비정규(staff.id=auth.uid) → 정규(user_profiles + clinic 스코프)
DROP POLICY IF EXISTS clinic_events_select ON clinic_events;
CREATE POLICY clinic_events_select ON clinic_events
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY clinic_events_select ON clinic_events IS
  'T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY G2: 정규 신원 소스(user_profiles) 전환. approved+active 직원이 본인 clinic 일정 이벤트 SELECT (대시보드 ClinicCalendar 공유 메뉴 parity). READ-only. clinic 스코프 유지. INSERT/UPDATE/DELETE 미접촉.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) SELECT 정책 정규화 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='clinic_events' AND cmd='SELECT';
--    → USING: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
-- 2) 쓰기 3정책 불변 확인 (staff 패턴 그대로 — 본 마이그 미접촉):
--    SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname='public' AND tablename='clinic_events' ORDER BY cmd;
