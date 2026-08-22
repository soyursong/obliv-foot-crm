-- ============================================================
-- ROLLBACK — T-20260822-foot-FOOTSTATSREV-ISTEST-STAFFREV-ALIGN-LEDGERDOC (축2 forward-doc)
-- foot_stats_revenue 를 직전 정본(20260719140000, is_simulation 단독 제외)으로 되돌림.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
--
-- ⚠ 주의: 본 forward-doc(20260719160000)은 prod 실재 body 를 repo 에 문서화한 것으로,
--   prod 는 이미 non-real(sim∪test) 제외 body 를 갖고 있다(파일 apply 로 신규 변경 0).
--   따라서 이 롤백은 "prod 를 is_test 제외 이전(sim 단독)으로 downgrade" 하는 실변경이며,
--   전체 ledger rewind 등 예외 상황에서만 사용한다. 운영 롤백 의도로 실행 금지
--   (is_test 고객 매출이 총매출 KPI 에 재유입 = 부풀림 방향 회귀).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_revenue(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  package_amount  BIGINT,
  single_amount   BIGINT,
  refund_amount   BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH single AS (
    SELECT
      accounting_date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND status NOT IN ('cancelled', 'deleted')
      AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = payments.customer_id
          AND c.is_simulation IS TRUE
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
      AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = package_payments.customer_id
          AND c.is_simulation IS TRUE
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
$$;

REVOKE ALL ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) TO authenticated;

COMMIT;
