-- T-20260521-foot-TRIAL-DROP-ADD: package_sessions.session_type에 trial 추가
-- 체험권 회차 차감 지원 — 금일치료 드롭다운 [체험권] 항목 연동
-- Rollback: 20260521080000_pkg_sessions_trial.down.sql
--
-- 설계 메모:
--   trial은 packages 테이블에 별도 컬럼 없음.
--   total_remaining (= total_sessions - COUNT(used sessions)) 에서 자동 차감.
--   get_package_remaining RPC 수정 불필요.

-- [1] session_type CHECK constraint에 trial 추가
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning','podologue','trial'));
