-- T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G1 (check_in_room_logs)
-- planner 재게이트 MSG-20260611-135000-b4sj: C그룹(clinic_events + check_in_room_logs) = GO Phase2-A.
--   canonical is_approved_user()+clinic parity-fix. ★blanket ALTER 금지·단계 적용·staff READ-only·clinic 스코프 불변(AC-5/6).
--
-- ── 전제 정정 (dev-foot DECISION-REQUEST MSG-20260611-143552-2sqv 의 해소) ──
--   G1 은 G2(clinic_events)와 RC 가 다르다. Phase 1 raw dump 실측:
--     room_logs_clinic_rw [ALL] roles="{public}"
--       USING : (clinic_id IN (SELECT user_profiles.clinic_id FROM user_profiles WHERE user_profiles.id = auth.uid()))
--       CHECK : (동일)
--   → SELECT 신원 소스가 user_profiles 기반(= current_user_clinic_id() 와 기능적 동일)이라
--     read parity 는 이미 충족(manager=staff 동일 clinic read, 전원 deny 아님).
--   ∴ 본 변경은 "parity gap 수정"이 아니라 **canonical 신원 정렬 + approved/active 게이트 하드닝**.
--   단일 [ALL] 정책이라 SELECT 만 정규화하려면 정책을 분리해야 한다(아래 ④ 분리 패턴).
--   planner 가 위 정정을 검토(matrix v2 / commit 422d1af)한 뒤에도 GO(canonical 전환) 재확정.
--
-- ── 수정 방식 (단일 [ALL] → SELECT canonical + 쓰기 보존 분리) ──
--   1) DROP  room_logs_clinic_rw [ALL]                      (단일 정책 해체)
--   2) SELECT 정책 신설 = canonical:
--        is_approved_user() AND clinic_id = current_user_clinic_id()
--   3) INSERT/UPDATE/DELETE 정책 신설 = **원 [ALL] 술어 그대로 보존**
--        (clinic_id IN (SELECT user_profiles.clinic_id FROM user_profiles WHERE id = auth.uid()))
--      → 쓰기 동작 byte-identical. AC-4(staff READ-only / 쓰기 불변) 충족.
--
-- ── 회귀가드 ──
--   AC-4: 쓰기(INSERT/UPDATE/DELETE) 술어는 원본과 동일(구조만 [ALL]→3분리, 의미 불변).
--   AC-5: SELECT 는 clinic_id = current_user_clinic_id() 단일 clinic 고정(타 clinic 차단, PHI 비확장).
--   AC-6: blanket-open 미발생. SELECT 는 approved + clinic 게이트(오히려 기존 [ALL] read 보다 엄격).
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611170000_check_in_room_logs_select_rls_canonical.rollback.sql
-- 운영 적용: supervisor DB 게이트 (테이블별 단계 적용, blanket ALTER 금지).

BEGIN;

-- 1) 단일 [ALL] 정책 해체
DROP POLICY IF EXISTS room_logs_clinic_rw ON check_in_room_logs;

-- 2) SELECT = canonical (정규 신원 + clinic 스코프, approved/active 게이트)
DROP POLICY IF EXISTS room_logs_clinic_select ON check_in_room_logs;
CREATE POLICY room_logs_clinic_select ON check_in_room_logs
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

-- 3) 쓰기 3정책 = 원 [ALL] 술어 보존 (의미 불변 / AC-4)
DROP POLICY IF EXISTS room_logs_clinic_insert ON check_in_room_logs;
CREATE POLICY room_logs_clinic_insert ON check_in_room_logs
  FOR INSERT
  WITH CHECK (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS room_logs_clinic_update ON check_in_room_logs;
CREATE POLICY room_logs_clinic_update ON check_in_room_logs
  FOR UPDATE
  USING (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS room_logs_clinic_delete ON check_in_room_logs;
CREATE POLICY room_logs_clinic_delete ON check_in_room_logs
  FOR DELETE
  USING (
    clinic_id IN (
      SELECT user_profiles.clinic_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

COMMENT ON POLICY room_logs_clinic_select ON check_in_room_logs IS
  'T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY G1: 단일 [ALL] 해체 후 SELECT canonical 전환(is_approved_user()+clinic). 쓰기 3정책은 원 user_profiles 술어 보존(AC-4). 대시보드 CheckInDetailSheet 공유 메뉴 read parity.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) SELECT canonical 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename='check_in_room_logs' AND cmd='SELECT';
--    → USING: (is_approved_user() AND (clinic_id = current_user_clinic_id()))
-- 2) 쓰기 3정책 술어 보존 확인(원 [ALL] 과 동일 user_profiles 술어):
--    SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='check_in_room_logs' AND cmd <> 'SELECT' ORDER BY cmd;
