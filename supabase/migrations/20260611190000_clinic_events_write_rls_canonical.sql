-- T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL (P1, approved)
-- 부모: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY (우산) 의 부수발견 → 별도 write 트랙 분리.
-- planner MSG-20260611-144018-eih9: clinic_events insert/update/delete 3정책 전부 staff.id=auth.uid()
--   비정규 → write 전원 차단(파손). G2 read 와 동일 RC. 우산 AC-5(write 불변) 위반이라
--   우산 Phase2-A 에 fold 금지 → 별도 write 트랙. canonical is_approved_user()+clinic 으로 정렬.
--
-- ── 확정 RC (Phase 1 전수감사 raw dump, READ-only) ──
--   clinic_events 의 쓰기 3정책(insert/update/delete)이 SELECT(G2) 와 동일하게 비정규 신원 소스
--   (staff.id = auth.uid()) 사용. 로그인 신원은 user_profiles 기준인데 staff.id 는 staff PK 라
--   auth.uid() 와 사실상 매칭 안 됨 → 직원·관리자 거의 전원 일정 이벤트 생성/수정/삭제 0건(파손).
--   대시보드 사이드바 ClinicCalendar 가 전 role 공유 메뉴인데 일정 추가/편집이 안 되는 상태.
--   raw dump (scripts/audit_out/T-20260611-RLS-PARITY_phase1_dump.txt):
--     clinic_events_insert [INSERT] CHECK: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))
--     clinic_events_update [UPDATE] USING: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))
--     clinic_events_delete [DELETE] USING: (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.id=auth.uid()))
--
-- ── 수정 (쓰기 3정책 정규 패턴 전환 — 본인 clinic 내 approved 직원 write 허용) ──
--     is_approved_user()                        → user_profiles 기반(approved+active 전 role)
--     AND clinic_id = current_user_clinic_id()   → clinic 스코프 명시 유지(타 clinic write 차단)
--   = G2 SELECT(20260611160000) 및 health_q(20260611150000) 와 동일 canonical 술어.
--   원래 의도(staff 의 본인 clinic 일정 write)를 신원 소스만 정규화해 복원.
--
-- ── 회귀가드 ──
--   AC-1(write 복원): 3정책 USING/WITH CHECK 가 canonical 술어로 전환되어 approved 직원이
--           본인 clinic 일정 INSERT/UPDATE/DELETE 가능.
--   AC-2(clinic 스코프): clinic_id = current_user_clinic_id() 단일 clinic 고정 →
--           타 clinic row 생성/수정/삭제 차단(PHI·교차 clinic 변조 비확장).
--           기존 IN(staff subquery) 대비 동등 이하 권한(더 엄격).
--   AC-3(UPDATE 이전 방지): UPDATE 에 USING + WITH CHECK 양쪽 적용 → 수정 후 row 를
--           타 clinic_id 로 이전(escape) 불가. (원본은 USING 만 → canonical 하드닝.)
--   AC-4(SELECT 불변): clinic_events_select(G2, 20260611160000) 미접촉. 본 마이그는 write 3정책만.
--   AC-5(blanket-open 미발생): clinic 스코프 + approved 게이트 유지. true/authenticated 미사용.
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611190000_clinic_events_write_rls_canonical.rollback.sql
-- 운영 적용: supervisor DB 게이트 (clinic_events 단일 테이블, write delta 명확 분리. blanket ALTER 금지).
-- ★ G2 read fix(20260611160000) 와 같은 배치 적용 가능하나 supervisor 검수에서 write delta 분리 표기 요망.

BEGIN;

-- INSERT: 비정규(staff.id=auth.uid) → 정규(user_profiles + clinic 스코프)
DROP POLICY IF EXISTS clinic_events_insert ON clinic_events;
CREATE POLICY clinic_events_insert ON clinic_events
  FOR INSERT
  WITH CHECK (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

-- UPDATE: USING(수정 대상 row) + WITH CHECK(수정 후 row) 양쪽 canonical → clinic 이전 차단
DROP POLICY IF EXISTS clinic_events_update ON clinic_events;
CREATE POLICY clinic_events_update ON clinic_events
  FOR UPDATE
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  )
  WITH CHECK (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

-- DELETE: 비정규 → 정규
DROP POLICY IF EXISTS clinic_events_delete ON clinic_events;
CREATE POLICY clinic_events_delete ON clinic_events
  FOR DELETE
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY clinic_events_insert ON clinic_events IS
  'T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL: 정규 신원 소스(user_profiles) 전환. approved+active 직원이 본인 clinic 일정 이벤트 INSERT. clinic 스코프 유지.';
COMMENT ON POLICY clinic_events_update ON clinic_events IS
  'T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL: 정규 신원 소스 전환 + WITH CHECK 로 clinic 이전 차단. approved+active 직원이 본인 clinic 일정 UPDATE.';
COMMENT ON POLICY clinic_events_delete ON clinic_events IS
  'T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL: 정규 신원 소스 전환. approved+active 직원이 본인 clinic 일정 DELETE. clinic 스코프 유지.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) 쓰기 3정책 정규화 확인:
--    SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='clinic_events' AND cmd<>'SELECT' ORDER BY cmd;
--    → INSERT WITH CHECK / UPDATE USING+WITH CHECK / DELETE USING 모두
--      (is_approved_user() AND (clinic_id = current_user_clinic_id()))
-- 2) SELECT 정책 불변 확인 (G2 canonical 그대로 — 본 마이그 미접촉):
--    SELECT policyname, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='clinic_events' AND cmd='SELECT';
