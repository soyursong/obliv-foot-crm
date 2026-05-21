-- Rollback: T-20260521-foot-TRIAL-DROP-ADD trial constraint revert
-- 주의: 기존 trial 데이터가 있으면 constraint violation 발생 가능. 확인 후 실행.

-- [1] session_type constraint 원복 (trial 제거)
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN ('heated_laser','unheated_laser','iv','preconditioning','podologue'));
