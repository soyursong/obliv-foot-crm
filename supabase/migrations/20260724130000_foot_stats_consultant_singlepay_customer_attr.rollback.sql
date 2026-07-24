-- ============================================================
-- ROLLBACK: T-20260724-foot-CONSULTANT-TKTREV-SINGLEPAY-ATTR-FIX
-- foot_stats_consultant 를 20260717170000_foot_stats_consultant_arpu_consulted_denom
--   (single_rev = check_in_id 직접조인 단일경로) 본문으로 복원.
-- 반환형 불변(7-col) → CREATE OR REPLACE(DROP 불요). 데이터/스키마 write 0.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id            UUID,
  name                     TEXT,
  ticketing_count          INT,
  package_count            INT,
  avg_amount               BIGINT,
  total_amount             BIGINT,
  consulted_customer_count INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  ticketed AS (
    SELECT DISTINCT
      ci.id          AS check_in_id,
      ci.consultant_id,
      ci.customer_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  ticketed_all AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id)
      p.id             AS package_id,
      ta.consultant_id AS consultant_id
    FROM packages p
    JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = p_clinic_id
    ORDER BY
      p.id,
      (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  pkg_rev AS (
    SELECT
      pa.consultant_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
    GROUP BY pa.consultant_id
  ),
  pkg_conv AS (
    SELECT
      pa.consultant_id,
      COUNT(DISTINCT pp.package_id)::int AS package_count
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
      AND pp.payment_type = 'payment'
    GROUP BY pa.consultant_id
  ),
  single_rev AS (
    SELECT
      ta.consultant_id,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS rev
    FROM payments pay
    JOIN ticketed_all ta ON ta.check_in_id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
    GROUP BY ta.consultant_id
  ),
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  consulted_cust AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  consultant_universe AS (
    SELECT consultant_id FROM tk_count
    UNION
    SELECT consultant_id FROM pkg_rev
    UNION
    SELECT consultant_id FROM single_rev
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COALESCE(tk.ticketing_count, 0)                                     AS ticketing_count,
    COALESCE(pc.package_count, 0)                                       AS package_count,
    ROUND(
      (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
      / NULLIF(COALESCE(cc.consulted_customer_count, 0), 0)
    )::bigint                                                           AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                 AS total_amount,
    COALESCE(cc.consulted_customer_count, 0)                           AS consulted_customer_count
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count       tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev        pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv       pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev     sr ON sr.consultant_id = s.id
  LEFT JOIN consulted_cust cc ON cc.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev, cc.consulted_customer_count
  ORDER BY ticketing_count DESC, avg_amount DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMIT;
