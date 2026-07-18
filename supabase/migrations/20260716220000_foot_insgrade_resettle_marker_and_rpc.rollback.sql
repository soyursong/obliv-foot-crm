-- ROLLBACK: T-20260714-foot-INSGRADE-VERIFY-RESETTLE Phase1
-- ADDITIVE 역전 — 신규 함수 DROP + 신규 마커 컬럼/제약/인덱스 DROP.
-- 기존 payments 데이터/컬럼 무변경(마커는 신규 nullable 뿐).
-- ⚠ 재정산 payments 행(resettle_reason='insurance_grade_resettle')이 이미 생성됐다면
--   컬럼 DROP 전 원장 정합 확인 필수(그 행 자체는 payment_type='refund'/'payment' 로 잔존).

DROP FUNCTION IF EXISTS resettle_insurance_grade(UUID, TEXT, BOOLEAN, TEXT);

DROP INDEX IF EXISTS idx_payments_resettle_reason;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_resettle_reason_allowlist;

ALTER TABLE payments
  DROP COLUMN IF EXISTS resettle_reason,
  DROP COLUMN IF EXISTS resettle_confirmed_grade;
