-- ROLLBACK — T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK
-- 역순 additive drop. 데이터 파괴는 closing_edit_log(감사 로그) 뿐 — 순수 신규 테이블이라
-- drop 시 기존 도메인 데이터 무영향. herald port(daily_closings/confirm_guard/outbox)는 미접촉(재사용만).
BEGIN;

-- B) RPC
DROP FUNCTION IF EXISTS public.closing_edit_manual_payment_reconfirm(UUID, UUID, JSONB);

-- A) 감사 로그 테이블(정책·인덱스 CASCADE)
DROP TABLE IF EXISTS public.closing_edit_log;

COMMIT;
