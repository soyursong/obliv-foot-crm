-- ============================================================
-- ROLLBACK — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK customers Tier-0 FOR DELETE grant REVOKE
-- ============================================================
-- 본 마이그 직전 상태 복원: authenticated 는 DELETE grant 보유(기본), anon 은 이미 REVOKE(20260629140000 phase1).
-- ⚠ anon 은 **재부여하지 않는다**(PII phase1 보안 결정 유지). authenticated 만 원복.
-- ⚠ FE soft-delete 라우팅(deleted_at UPDATE) 이 배포된 뒤라면 FE 롤백을 동시/선행할 것.
-- ============================================================

BEGIN;

GRANT DELETE ON public.customers TO authenticated;

COMMIT;
