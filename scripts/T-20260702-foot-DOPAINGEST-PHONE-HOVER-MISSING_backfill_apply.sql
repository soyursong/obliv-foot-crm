-- T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING — backfill reservations.customer_phone
-- 원인: reservation-ingest-from-dopamine EF가 phone을 customers.phone에만 적재하고
--       reservations.customer_phone 스냅샷 denormalize 누락 → 캘린더 호버 '번호 없음'.
-- forward fix(EF)는 신규 인입만 해소 → 旣존 dopamine 예약 backfill 필요.
-- 범위: source_system='dopamine' AND customer_phone IS NULL AND customer_id 연결 AND customers.phone E.164.
--   비동행(customer_id NOT NULL)만 대상 — 동행(customer_id NULL)은 무폰 축(§444) 그대로 유지.
-- NO DDL. reservations_customer_phone_e164_chk 정합(E.164만 착지). dry-run: backfillable=2, non_e164=0.
BEGIN;

UPDATE reservations r
SET customer_phone = c.phone,
    updated_at = now()
FROM customers c
WHERE c.id = r.customer_id
  AND r.source_system = 'dopamine'
  AND r.customer_phone IS NULL
  AND r.customer_id IS NOT NULL
  AND c.phone IS NOT NULL
  AND c.phone ~ '^\+82(1[016789][0-9]{7,8})$'
RETURNING r.id, r.customer_name, r.customer_phone;

COMMIT;
