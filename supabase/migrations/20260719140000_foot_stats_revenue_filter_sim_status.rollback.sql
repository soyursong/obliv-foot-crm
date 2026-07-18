-- ROLLBACK — T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS
--   foot_stats_revenue 를 필터 적용 직전 prod 정본 정의(무필터: clinic_id + accounting_date 만)로 복원.
--   base = prod pg_get_functiondef 덤프(2026-07-19 PREFLIGHT, rxlomoozakkjesdqjtvd).
--   시그니처 불변 → CREATE OR REPLACE. 원 정의 = T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY.
--   ⚠ 복원 시 시뮬/취소·삭제 결제가 다시 매출에 합산됨(부풀림 재현) — 회귀 대비 참조용.
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

COMMENT ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)
  IS 'foot-stats: 매출 systemTotal(single/package payment − refund). 귀속축=accounting_date(회계 SSOT, 소급차단). T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY';

COMMIT;
