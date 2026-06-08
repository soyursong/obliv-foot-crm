-- ROLLBACK: T-20260607-foot-THERAPIST-STATS-V2
-- v2 RPC 2종을 v1(20260607210000_foot_therapist_stats_rpc.sql) 정의로 되돌림.
-- 인덱스(idx_package_sessions_performed_status)는 비파괴 additive 라 유지(원하면 수동 DROP).

BEGIN;

-- v1 복원: foot_stats_therapist_summary (시작=preconditioning|laser, 종료=done)
CREATE OR REPLACE FUNCTION foot_stats_therapist_summary(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id          UUID,
  name                  TEXT,
  treatment_count       INT,
  avg_treatment_minutes NUMERIC,
  experience_total      INT,
  experience_converted  INT,
  conversion_rate       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT ci.id, ci.therapist_id, ci.visit_type, ci.package_id
    FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.therapist_id IS NOT NULL
      AND ci.status <> 'cancelled'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  ),
  therapists AS (
    SELECT DISTINCT therapist_id FROM base
  ),
  durations AS (
    SELECT
      b.id, b.therapist_id,
      EXTRACT(EPOCH FROM (
        MAX(st.transitioned_at) FILTER (WHERE st.to_status = 'done')
        - MIN(st.transitioned_at) FILTER (WHERE st.to_status IN ('preconditioning','laser'))
      )) / 60.0 AS minutes
    FROM base b
    JOIN status_transitions st ON st.check_in_id = b.id
    GROUP BY b.id, b.therapist_id
    HAVING MAX(st.transitioned_at) FILTER (WHERE st.to_status = 'done') IS NOT NULL
       AND MIN(st.transitioned_at) FILTER (WHERE st.to_status IN ('preconditioning','laser')) IS NOT NULL
  ),
  dur_agg AS (
    SELECT therapist_id,
           COUNT(*) FILTER (WHERE minutes > 0)::int AS tcount,
           AVG(minutes) FILTER (WHERE minutes > 0)  AS avg_min
    FROM durations
    GROUP BY therapist_id
  ),
  exp_agg AS (
    SELECT b.therapist_id,
           COUNT(*)::int AS exp_total,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM package_payments pp
             WHERE pp.package_id = b.package_id AND pp.payment_type = 'payment'
           ))::int AS exp_conv
    FROM base b
    WHERE b.visit_type = 'experience'
    GROUP BY b.therapist_id
  )
  SELECT
    s.id, s.name,
    COALESCE(d.tcount, 0),
    CASE WHEN d.avg_min IS NOT NULL THEN ROUND(d.avg_min, 1) END,
    COALESCE(e.exp_total, 0),
    COALESCE(e.exp_conv, 0),
    CASE WHEN COALESCE(e.exp_total, 0) > 0
      THEN ROUND(e.exp_conv::numeric / e.exp_total * 100, 1) END
  FROM therapists t
  JOIN staff s        ON s.id = t.therapist_id
  LEFT JOIN dur_agg d ON d.therapist_id = t.therapist_id
  LEFT JOIN exp_agg e ON e.therapist_id = t.therapist_id
  WHERE s.clinic_id = p_clinic_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, s.name;
$$;

-- v1 복원: foot_stats_therapist_services (자유텍스트 service_name 별 건수)
DROP FUNCTION IF EXISTS foot_stats_therapist_services(UUID, DATE, DATE);
CREATE OR REPLACE FUNCTION foot_stats_therapist_services(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  therapist_id UUID,
  name         TEXT,
  service_name TEXT,
  cnt          INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ci.therapist_id, s.name, cis.service_name, COUNT(*)::int
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  JOIN staff s      ON s.id = ci.therapist_id
  WHERE ci.clinic_id = p_clinic_id
    AND ci.therapist_id IS NOT NULL
    AND ci.status <> 'cancelled'
    AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  GROUP BY ci.therapist_id, s.name, cis.service_name
  ORDER BY s.name, cnt DESC;
$$;

REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_services(UUID, DATE, DATE) TO authenticated;

COMMIT;
