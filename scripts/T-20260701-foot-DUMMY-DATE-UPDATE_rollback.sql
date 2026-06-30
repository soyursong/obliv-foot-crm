-- T-20260701-foot-DUMMY-DATE-UPDATE — ROLLBACK (7/1 → 6/30 원복)
-- _apply.mjs --apply 로 6/30→7/1 이동을 실행했을 때만 사용.
-- 대상: SELECT-first(_inspect.mjs)로 확정한 PROGRESSPUB 더미 4건(6회/12회/18회/24회 경과분석).
-- 가드: rid IN + reservation_date=7/1 + progress_check_required + is_simulation 더미만 → 실환자/기존7-1시드 무접촉.
--   (주의: 기존부터 7/1에 있던 '오늘 대상자' 더미 4건(rid 51d8c16c/02605b1a/4a6c8f72/78046207)은 본 롤백 대상 아님 — 아래 4개 rid에 미포함.)

UPDATE reservations
SET reservation_date = '2026-06-30'
WHERE id IN (
  '89dd247d-1bed-4f5e-a4cd-9bb9a33669b0', -- 테스트경과01 14:00 6회 경과분석
  '8d9ee9ad-b8ef-495f-aa6b-799dcfd79a74', -- 테스트경과02 14:30 12회 경과분석
  'd063cba1-90ad-49f1-9a69-113a791f7a78', -- 테스트경과03 15:00 18회 경과분석
  '78f64a7c-a0c5-4cd2-b94a-d8a0c5bb76bc'  -- 테스트경과분석 15:30 24회 경과분석
)
  AND reservation_date = '2026-07-01'
  AND progress_check_required = true;

-- 검증:
-- SELECT id, customer_name, reservation_date, reservation_time, progress_check_label
-- FROM reservations
-- WHERE id IN ('89dd247d-1bed-4f5e-a4cd-9bb9a33669b0','8d9ee9ad-b8ef-495f-aa6b-799dcfd79a74',
--              'd063cba1-90ad-49f1-9a69-113a791f7a78','78f64a7c-a0c5-4cd2-b94a-d8a0c5bb76bc');
