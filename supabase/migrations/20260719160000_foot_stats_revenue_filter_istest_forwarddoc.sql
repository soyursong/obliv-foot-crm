-- ============================================================
-- T-20260822-foot-FOOTSTATSREV-ISTEST-STAFFREV-ALIGN-LEDGERDOC  (축2 = orphan ledger forward-doc)
-- foot_stats_revenue RPC — prod 실재 정본 forward-documentation (repo 역커밋)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-08-22
-- 롤백: 20260719160000_foot_stats_revenue_filter_istest_forwarddoc.rollback.sql
--
-- ─── 왜 이 파일인가 (orphan ledger row 정합) ──────────────────────────────────────
--   supabase_migrations.schema_migrations 원장에는 version='20260719160000' 이 등재돼
--   있으나(prod applied), 대응 repo 마이그 파일이 없었다(orphan). prod live RPC 는 이미
--   non-real(is_simulation IS TRUE OR is_test IS TRUE) 제외 술어를 body 에 갖고 있으나,
--   repo 의 마지막 파일선언(20260719140000)은 is_simulation 단독만 담아 repo↔prod body-drift.
--   부모 DIAG(T-20260822-foot-CLOSING-FOOTSTATSREV-RPC-PKGLEG-DRIFT-DIAG, commit 82eac831)
--   에서 확정. 본 파일은 그 orphan ledger row 를 **prod 실재 body 그대로** repo 에 forward-doc 한다.
--
-- ─── DA 판정 (da_decision_foot_footstatsrev_istest_exclusion_orphanledger_20260822) ──
--   축2 orphan 20260719160000 = (F) forward-doc(prod 실재 정본·repo 역커밋).
--     (ii) 반영구 divergence REJECT. db repair 불요(row 이미 applied).
--   축1 canonical = (a) is_test 제외 REAFFIRM → body = 현 prod 그대로(is_test 제외 유지).
--
-- ─── ★ 배포 안전 = content-parity(md5) + DDL-diff empty (신규 DDL 아님) ★ ───────────
--   본 body 는 prod introspection(pg_get_functiondef) verbatim 이다.
--     · prod pg_get_functiondef md5 = 8ad6dc645163221890a7e27360e9d723 (2026-08-22 실측)
--     · CREATE OR REPLACE 이므로 시그니처 불변(반환 4컬럼 동일) → 42P13 불가·즉시 역전.
--   prod 는 이미 이 body 를 갖고 있으므로 배포 apply 시 **DDL-diff 는 반드시 empty** 여야 한다.
--   DDL-diff 가 empty 가 아니면(≠0) = body-drift → NO-GO(supervisor content-parity 게이트 소관).
--   신규 DDL/데이터/enum/컬럼 0 (순수 forward-doc). db_change = false 관점(prod 무변).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_revenue(p_clinic_id uuid, p_from date, p_to date)
 RETURNS TABLE(dt date, package_amount bigint, single_amount bigint, refund_amount bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH single AS (
    SELECT
      accounting_date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND status NOT IN ('cancelled', 'deleted')
      AND NOT EXISTS (                                    -- 시뮬·테스트 고객 결제 제외 (워크인 customer_id=NULL 보존)
        SELECT 1 FROM customers c
        WHERE c.id = payments.customer_id
          AND (c.is_simulation IS TRUE OR c.is_test IS TRUE)
      )
    GROUP BY 1
  ),
  pkg AS (
    SELECT
      accounting_date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM package_payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND NOT EXISTS (                                    -- 시뮬·테스트 고객 결제 제외 (package_payments.customer_id 직결)
        SELECT 1 FROM customers c
        WHERE c.id = package_payments.customer_id
          AND (c.is_simulation IS TRUE OR c.is_test IS TRUE)
      )
    GROUP BY 1
  )
  SELECT
    COALESCE(s.dt, p.dt)                              AS dt,
    COALESCE(p.pay_amt, 0)                            AS package_amount,
    COALESCE(s.pay_amt, 0)                            AS single_amount,
    COALESCE(s.ref_amt, 0) + COALESCE(p.ref_amt, 0)   AS refund_amount
  FROM single s
  FULL OUTER JOIN pkg p ON p.dt = s.dt
  ORDER BY 1;
$function$;

-- 권한 멱등 보강 (prod grant 상태와 동형: PUBLIC 무권한, authenticated EXECUTE). CREATE OR REPLACE 는 기존 GRANT 유지.
REVOKE ALL ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) TO authenticated;

COMMIT;
