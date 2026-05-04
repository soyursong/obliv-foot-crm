-- T-20260504-foot-MEMO-RESTRUCTURE
-- 예약메모(booking_memo) + 고객메모(customer_memo) 분리
-- 기존 reservations.memo → booking_memo (예약 경로 확인용)
-- 기존 customers.memo → customer_memo (고객 성향·주차 등)

BEGIN;

-- 1. 새 컬럼 추가
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS booking_memo TEXT;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_memo TEXT;

-- 2. 기존 데이터 마이그레이션
UPDATE reservations
  SET booking_memo = memo
  WHERE memo IS NOT NULL AND booking_memo IS NULL;

UPDATE customers
  SET customer_memo = memo
  WHERE memo IS NOT NULL AND customer_memo IS NULL;

-- 3. 기존 memo 필드 초기화 (티켓 스펙: "기존 내용 삭제 후 구조 분리")
UPDATE reservations SET memo = NULL;
UPDATE customers SET memo = NULL;

COMMIT;
