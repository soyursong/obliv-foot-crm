-- Rollback: T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS save_room_assignments RPC 제거
-- 함수만 제거. room_assignments 테이블/데이터/기존 RLS 정책은 영향 없음.
-- 롤백 후 FE 는 직전 DELETE+INSERT 경로로 회귀해야 함(코드 revert 동반).

BEGIN;

DROP FUNCTION IF EXISTS public.save_room_assignments(uuid, date, jsonb);

COMMIT;
