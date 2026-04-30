-- 롤백: foot_stats_consultant 이중 카운트 수정 전 버전으로 복원
-- 원본: supabase/migrations/20260430100000_foot_stats_rpc.sql (118~197줄)
CREATE OR REPLACE FUNCTION foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id   UUID,
  name            TEXT,
  ticketing_count INT,
  package_count   INT,
  avg_amount      BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ticketed AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  rev_per_ci AS (
    SELECT
      t.check_in_id,
      t.consultant_id,
      COALESCE((
        SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)
        FROM payments WHERE check_in_id = t.check_in_id
      ), 0)
      + COALESCE((
        SELECT SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)
        FROM package_payments pp
        WHERE pp.package_id = (SELECT package_id FROM check_ins WHERE id = t.check_in_id)
      ), 0) AS rev
    FROM ticketed t
  ),
  pkg_flag AS (
    SELECT DISTINCT ci.id AS check_in_id
    FROM check_ins ci
    JOIN package_payments pp ON pp.package_id = ci.package_id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.package_id IS NOT NULL
      AND pp.payment_type = 'payment'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COUNT(DISTINCT t.check_in_id)::int                                  AS ticketing_count,
    COUNT(DISTINCT t.check_in_id) FILTER (WHERE pf.check_in_id IS NOT NULL)::int AS package_count,
    CASE
      WHEN COUNT(DISTINCT t.check_in_id) > 0
      THEN ROUND(SUM(rpc.rev)::numeric / COUNT(DISTINCT t.check_in_id))::bigint
      ELSE 0
    END AS avg_amount
  FROM staff s
  LEFT JOIN ticketed t   ON t.consultant_id = s.id
  LEFT JOIN rev_per_ci rpc ON rpc.check_in_id = t.check_in_id
  LEFT JOIN pkg_flag pf  ON pf.check_in_id = t.check_in_id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) TO authenticated;
