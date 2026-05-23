-- ROLLBACK: T-20260522-foot-PAY-INPUT-001
-- external_approval_no, external_tid 컬럼 제거
-- 사전 확인: 두 컬럼에 실데이터 있으면 백업 후 실행

ALTER TABLE payments
  DROP COLUMN IF EXISTS external_approval_no,
  DROP COLUMN IF EXISTS external_tid;

ALTER TABLE package_payments
  DROP COLUMN IF EXISTS external_approval_no,
  DROP COLUMN IF EXISTS external_tid;
