-- ============================================================
-- ROLLBACK: T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
-- foot_stats_consultant 를 직전 정의(20260619020000)로 복원.
--   = total_amount 반환 컬럼 제거 (RETURNS TABLE 5컬럼 시그니처 복귀).
-- 주의: FE(ConsultantSection)가 total_amount 를 옵셔널로 소비(fallback=avg×count)
--   하므로 본 롤백 후에도 FE는 graceful(역산 표시). 단, 정합 정밀도는 ROUND 오차 회귀.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS foot_stats_consultant(UUID, DATE, DATE);

CREATE FUNCTION foot_stats_consultant(
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
  pkg_once AS (
    SELECT DISTINCT ON (ci.package_id)
      ci.id          AS check_in_id,
      ci.package_id
    FROM check_ins ci
    JOIN ticketed t ON t.check_in_id = ci.id
    WHERE ci.package_id IS NOT NULL
    ORDER BY ci.package_id, ci.checked_in_at ASC
  ),
  pkg_rev AS (
    SELECT
      po.check_in_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS pkg_rev
    FROM pkg_once po
    JOIN package_payments pp ON pp.package_id = po.package_id
    GROUP BY po.check_in_id
  ),
  rev_per_ci AS (
    SELECT
      t.check_in_id,
      t.consultant_id,
      COALESCE((
        SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)
        FROM payments WHERE check_in_id = t.check_in_id
      ), 0)
      + COALESCE(pr.pkg_rev, 0) AS rev
    FROM ticketed t
    LEFT JOIN pkg_rev pr ON pr.check_in_id = t.check_in_id
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
    COUNT(DISTINCT t.check_in_id)::int                                               AS ticketing_count,
    COUNT(DISTINCT t.check_in_id) FILTER (WHERE pf.check_in_id IS NOT NULL)::int     AS package_count,
    CASE
      WHEN COUNT(DISTINCT t.check_in_id) > 0
      THEN ROUND(SUM(rpc.rev)::numeric / COUNT(DISTINCT t.check_in_id))::bigint
      ELSE 0
    END AS avg_amount
  FROM staff s
  JOIN ticketed t          ON t.consultant_id = s.id
  LEFT JOIN rev_per_ci rpc ON rpc.check_in_id = t.check_in_id
  LEFT JOIN pkg_flag pf    ON pf.check_in_id = t.check_in_id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 티켓팅 실적 (이중카운트 수정 + 데이터-유무 필터). T-20260619 AC3=1-B.';

COMMIT;
