-- T-20260720-foot-AICC-ANON-PII-LEAK · AC3 (베이스 봉합 1/2) · ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- 롤백 = 신규 함수 제거. prod 에 본 시그니처 함수 사전 부재 확인(실측: pg_proc 0건) → DROP 안전.
-- ⚠ 3/3(customers lockdown) 이 먼저 적용된 상태에서 본 롤백만 적용하면 FE fallback 이 함수 부재로 실패.
--   롤백은 반드시 역순(3/3 롤백 → 본 롤백)으로 수행할 것.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_resolve_customer_id_by_phone(uuid, text[]);

COMMIT;
