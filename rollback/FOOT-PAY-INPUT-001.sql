-- ROLLBACK: T-20260522-foot-PAY-INPUT-001
-- external_approval_no, external_tid 컬럼 제거
-- 사전 확인: 두 컬럼에 실데이터 있으면 백업 후 실행
--
-- 적용 전 체크:
--   SELECT COUNT(*) FROM payments WHERE external_approval_no IS NOT NULL OR external_tid IS NOT NULL;
--   SELECT COUNT(*) FROM package_payments WHERE external_approval_no IS NOT NULL OR external_tid IS NOT NULL;

ALTER TABLE payments
  DROP COLUMN IF EXISTS external_approval_no,
  DROP COLUMN IF EXISTS external_tid;

ALTER TABLE package_payments
  DROP COLUMN IF EXISTS external_approval_no,
  DROP COLUMN IF EXISTS external_tid;
