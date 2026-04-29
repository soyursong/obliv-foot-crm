-- T-20260430-foot-SEARCH-DOB-CHART: customers 테이블 생년월일 + 차트번호 컬럼 추가
-- 생년월일: YYMMDD 텍스트 형식 (예: 900515)
-- 차트번호: 외부 차트 식별자

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS birth_date   TEXT,
  ADD COLUMN IF NOT EXISTS chart_number TEXT;

COMMENT ON COLUMN customers.birth_date   IS '생년월일 (YYMMDD 텍스트, 예: 900515)';
COMMENT ON COLUMN customers.chart_number IS '차트번호 (외부 시스템 연계용 식별자)';

CREATE INDEX IF NOT EXISTS idx_customers_birth_date   ON customers (birth_date);
CREATE INDEX IF NOT EXISTS idx_customers_chart_number ON customers (chart_number);

-- rollback:
-- DROP INDEX IF EXISTS idx_customers_birth_date;
-- DROP INDEX IF EXISTS idx_customers_chart_number;
-- ALTER TABLE customers DROP COLUMN IF EXISTS birth_date;
-- ALTER TABLE customers DROP COLUMN IF EXISTS chart_number;
