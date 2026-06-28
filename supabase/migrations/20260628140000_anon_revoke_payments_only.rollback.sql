-- ROLLBACK for 20260628140000_anon_revoke_payments_only.sql
-- T-20260627-foot-ANON-RLS-PHASE2B — payments-portion 단독 차단 역연산.
-- ★ 자동 적용 안 됨(*.rollback.sql = 마이그 러너 제외). supervisor 게이트 후 수동 실행.
-- 비고: RLS canonical 이 anon row 0건을 유지하므로 본 GRANT 복원으로 row 노출 없음.
--   알려진-정상(pre-revoke) 상태 복원용.

BEGIN;

GRANT SELECT ON public.payments TO anon;

COMMIT;
