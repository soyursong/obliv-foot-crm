-- ROLLBACK — T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE reschedule re-emit executable
-- 신규 함수 1개만 제거. 데이터 무접점(정본/미러/outbox 데이터 미변경). 이미 적재된 outbox 행은 worker
-- (foot-dopamine-callback-worker)가 정상 드레인하므로 함수 제거가 in-flight 재발화에 영향 없음
-- (재실행 방지 목적 롤백).
-- 멱등: DROP FUNCTION IF EXISTS — 부재 시 no-op.

BEGIN;

DROP FUNCTION IF EXISTS public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN);

COMMIT;
