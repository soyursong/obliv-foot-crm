-- T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD
-- 2번차트(고객차트) 1구역 [고객메모] 칸 신설용 컬럼.
-- 직접수정·non-history (예약메모처럼 한 칸에 현재값 유지·수정). customers.customer_memo(MEMO-HISTORY가 history 전환 예정)와 별개·무간섭.
-- RECONCILE(T-... §3): customer_memo는 3구역 history 전환 대상이므로, 1구역 직접수정 메모는 신규 단일 컬럼으로 분리.
-- 안전: NULL 허용 컬럼 추가(ADDITIVE) → 기존 데이터 무영향. 선례: 20260623160000_clinics_email
-- 롤백: 20260623170000_customers_customer_note.rollback.sql

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_note TEXT;

COMMENT ON COLUMN customers.customer_note IS '2번차트 1구역 고객메모 — 직접수정·non-history(현재값 단일 유지). customer_memo(3구역 history 전환 대상)와 별개. T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD';

-- 검증
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'customers' AND column_name = 'customer_note'
  ) THEN
    RAISE EXCEPTION 'customers.customer_note 컬럼 추가 실패';
  END IF;
END $$;

COMMIT;
