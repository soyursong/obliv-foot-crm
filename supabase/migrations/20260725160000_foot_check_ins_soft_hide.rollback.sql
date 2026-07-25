-- ROLLBACK — T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B
--   soft-hide 컬럼/인덱스 제거 + 두 집계함수를 deleted_at 미참조 이전 정의로 복원.
--   순서: (1) 함수 복원(컬럼 참조 제거) → (2) 인덱스 DROP → (3) 컬럼 DROP.
--   ⚠ 복원 전 deleted_at IS NOT NULL 행이 있으면 그 행들이 다시 노출됨(soft-hide 무효화) — 의도된 되돌림.
BEGIN;

-- (1a) foot_stats_consultant — 20260724130000 정의로 복원(deleted_at 미참조).
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
  payment_base AS (
    SELECT
      pay.id                                    AS payment_id,
      pay.check_in_id                           AS check_in_id,
      COALESCE(pay.customer_id, ci.customer_id) AS customer_id,
      pay.created_at                            AS created_at,
      (CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay
    LEFT JOIN check_ins ci ON ci.id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
  ),
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.check_in_id = pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  single_cust AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.customer_id = pb.customer_id
    WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_direct)
    ORDER BY
      pb.payment_id,
      (ta.checked_in_at <= pb.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (pb.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  single_attr AS (
    SELECT payment_id, consultant_id FROM single_direct
    UNION ALL
    SELECT payment_id, consultant_id FROM single_cust
  ),
  single_rev AS (
    SELECT
      sa.consultant_id,
      SUM(pb.net)::bigint AS rev
    FROM single_attr sa
    JOIN payment_base pb ON pb.payment_id = sa.payment_id
    GROUP BY sa.consultant_id
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

-- (1b) foot_stats_noshow_returning — 20260629150000 정의로 복원(deleted_at 미참조).
CREATE OR REPLACE FUNCTION public.foot_stats_noshow_returning(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  noshow_rate     NUMERIC,
  returning_rate  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT
      reservation_date AS dt,
      COUNT(*) FILTER (WHERE status = 'no_show')                             AS noshow_cnt,
      COUNT(*) FILTER (WHERE status IN ('checked_in','no_show'))             AS denom_cnt
    FROM reservations
    WHERE clinic_id = p_clinic_id
      AND reservation_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  ck AS (
    SELECT
      (checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
      COUNT(*) FILTER (WHERE visit_type = 'returning')  AS returning_cnt,
      COUNT(*)                                          AS total_cnt
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND checked_in_at IS NOT NULL
      AND status NOT IN ('cancelled')
      AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  )
  SELECT
    COALESCE(r.dt, c.dt) AS dt,
    CASE
      WHEN COALESCE(r.denom_cnt, 0) > 0
      THEN ROUND((r.noshow_cnt::numeric / r.denom_cnt) * 100, 1)
      ELSE 0
    END AS noshow_rate,
    CASE
      WHEN COALESCE(c.total_cnt, 0) > 0
      THEN ROUND((c.returning_cnt::numeric / c.total_cnt) * 100, 1)
      ELSE 0
    END AS returning_rate
  FROM res r
  FULL OUTER JOIN ck c ON c.dt = r.dt
  ORDER BY 1;
$$;

-- (2) 인덱스 DROP
DROP INDEX IF EXISTS public.idx_check_ins_live_clinic_checkedin;

-- (3) 컬럼 DROP
ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by;

COMMIT;
