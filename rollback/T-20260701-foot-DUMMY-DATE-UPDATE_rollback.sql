-- T-20260701-foot-DUMMY-DATE-UPDATE — ROLLBACK (7/1 → 6/30 원복)
-- 더미 경과분석 예약 4건 reservation_date 를 2026-07-01 → 2026-06-30 으로 되돌림.
-- 대상은 명시 id 4건 + reservation_date=2026-07-01 가드(이중 적용분 외 미변경).
UPDATE reservations
SET reservation_date = '2026-06-30'
WHERE id IN (
  '89dd247d-1bed-4f5e-a4cd-9bb9a33669b0',  -- 테스트경과01
  '8d9ee9ad-b8ef-495f-aa6b-799dcfd79a74',  -- 테스트경과02
  'd063cba1-90ad-49f1-9a69-113a791f7a78',  -- 테스트경과03
  '78f64a7c-a0c5-4cd2-b94a-d8a0c5bb76bc'   -- 테스트경과분석
)
AND reservation_date = '2026-07-01'
AND progress_check_required = true;
-- 검증: SELECT id, customer_name, reservation_date FROM reservations WHERE id IN (...);
