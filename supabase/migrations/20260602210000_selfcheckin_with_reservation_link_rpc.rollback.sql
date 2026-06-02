-- ROLLBACK: T-20260602-foot-SELFCHECKIN-RESV-LINK
-- self_checkin_with_reservation_link RPC 제거.
--
-- 영향: 데이터 변경 없음(함수 정의만 제거). 롤백 후 FE 는 linkErr 분기로
--       레거시 분산 경로(next_queue_number + check_ins INSERT + reservations UPDATE)로
--       graceful fallback → 셀프체크인 자체는 계속 동작. (단, status_transitions 미기록 +
--       reservations 전이 anon RLS silent-fail 회귀 — 즉 본 티켓 이전 동작으로 복귀.)

BEGIN;

DROP FUNCTION IF EXISTS public.self_checkin_with_reservation_link(UUID, JSONB, DATE);

COMMIT;
