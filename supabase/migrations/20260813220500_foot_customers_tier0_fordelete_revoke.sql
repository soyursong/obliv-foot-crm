-- ============================================================
-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — customers Tier-0 FOR DELETE grant REVOKE
-- ============================================================
-- 상위 지시: planner MSG-20260814-003808-jc5c (DA REPLY MSG-20260814-002921-lb8f)
--   Leg2 scope fold: "customers Tier-0 GAP: deleted_at view-hide + FOR DELETE grant REVOKE."
--   RLS FOR DELETE grant REVOKE sub-doctrine: **Tier-0/1 = REVOKE co-atomic**(CLASS C junction = KEEP).
-- census (per-table 선결): db-gate/T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK_census.md (CLASS A customers Tier-0)
--
-- ⚠️⚠️ APPLY 게이트 (apply_before_go 금지) ⚠️⚠️
--   본 파일은 **staged RESTRICTIVE 권한 변경** 이다. prod 적용은 supervisor DDL-diff + 물리 GO-token 선행 후에만.
--   **co-atomic**: envelope(20260813220000, deleted_at view-hide) 와 동일 GO-token 윈도에서 함께 apply.
--   FOR DELETE grant REVOKE 는 per-table census 선결(완료) + supervisor 게이트 대상.
--
-- ── census 근거 (mechanism 선택 = grant-layer REVOKE) ──
--   • customers 의 DELETE 도달 경로 = **FOR ALL RLS 정책**(auth_all[20260419000001] · customers_admin_all[20260426000000/
--     20260615160000 clinic-isolation]) — 별도 FOR DELETE 전용 정책은 부재. 즉 DELETE 는 FOR ALL 정책의 곁가지.
--   • anon 의 table-level DELETE grant 는 이미 REVOKE 됨(20260629140000 PII phase1). 본 파일은 그 축을 멱등 재확인.
--   • Tier-0 집행 = **table-level `REVOKE DELETE`** (privilege 층). FOR ALL 정책은 남기되(SELECT/INSERT/UPDATE 유지)
--     DELETE 는 privilege 부재로 무력화(fail-closed). 정책 재작성 회피 = 최소 diff·SELECT/UPD 회귀 리스크 0.
--   • 앱 층 물리삭제는 이미 fail-closed(Customers.tsx:491 empty-only + PHI FK RESTRICT). 본 REVOKE = grant-층 2차 봉인.
--
-- rollback: 20260813220500_foot_customers_tier0_fordelete_revoke.rollback.sql
-- dryrun  : 20260813220500_foot_customers_tier0_fordelete_revoke.dryrun.sql
-- ============================================================

BEGIN;

-- Tier-0 customers: DELETE privilege 회수 (authenticated) — FOR ALL 정책의 DELETE 곁가지를 privilege 층에서 봉인.
REVOKE DELETE ON public.customers FROM authenticated;

-- anon: 이미 phase1(20260629140000) 에서 REVOKE 됨 — 멱등 재확인(방어).
REVOKE DELETE ON public.customers FROM anon;

COMMIT;
