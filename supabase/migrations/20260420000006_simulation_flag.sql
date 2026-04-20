-- C-14: 시뮬레이션 더미 데이터 마킹 + 일괄 삭제 지원
-- 원칙: customers.is_simulation=TRUE면 해당 고객 + 연관 레코드(check_ins/reservations/packages/...) 일괄 삭제 대상.
-- 시뮬레이션 모드 ON 상태에서 신규 생성된 고객은 자동으로 is_simulation=TRUE.
-- 4/27 시뮬레이션 종료 후: scripts/cleanup_simulation.sql 실행.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_customers_simulation ON customers(is_simulation) WHERE is_simulation = TRUE;
