-- ============================================================
-- ROLLBACK: T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY
-- accounting_date → created_at 로 두 함수 복원 (현행 prod live base 그대로 재이식).
-- 즉시 역전 가능(시그니처 불변 CREATE OR REPLACE). 테이블/데이터 무접촉.
-- DB: rxlomoozakkjesdqjtvd / dev-foot / 2026-07-15
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
      (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  pkg AS (
    SELECT
      (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM package_payments
    WHERE clinic_id = p_clinic_id
      AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
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

CREATE OR REPLACE FUNCTION public.foot_stats_by_category(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  category  TEXT,
  sessions  BIGINT,
  amount    BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH pkg_used AS (
    SELECT
      ps.session_type AS category,
      COUNT(*)::bigint AS cnt,
      SUM(COALESCE(ps.unit_price, 0) + COALESCE(ps.surcharge, 0))::bigint AS amt
    FROM package_sessions ps
    JOIN packages p ON p.id = ps.package_id
    WHERE p.clinic_id = p_clinic_id
      AND ps.status = 'used'
      AND ps.session_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  single_paid AS (
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = p_clinic_id
      AND (pay.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  unioned AS (
    SELECT category, cnt, amt FROM pkg_used
    UNION ALL
    SELECT category, cnt, amt FROM single_paid
  )
  SELECT
    category,
    SUM(cnt)::bigint AS sessions,
    SUM(amt)::bigint AS amount
  FROM unioned
  GROUP BY 1
  HAVING SUM(amt) <> 0 OR SUM(cnt) > 0
  ORDER BY amount DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMIT;
