-- ROLLBACK: T-20260715-foot-SELFCHECKIN-CONFIRM-FULLPII-CUSTMATCH
-- 신규 phone-gated scoped-raw RPC 제거. 신 오브젝트라 DROP 만으로 완전 가역(旣존 오브젝트 무접촉).
-- 데이터 무변경(RPC 는 read-only SELECT). fn_selfcheckin_today_reservations(masked) 는 본 티켓 무변경 → 롤백 대상 아님.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_verify_reservation(UUID, TEXT, UUID);

COMMIT;
