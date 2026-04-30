-- T-STATS-FOLLOWUP #1: foot_stats_consultant 이중 카운트 수정
--
-- 문제: rev_per_ci CTE에서 check_ins.package_id → package_payments.package_id 조인 시
--       동일 패키지에 N개 check_in이 연결되면 패키지 결제액이 N번 합산됨.
-- 수정: pkg_once CTE로 패키지당 최초 ticketed check_in에만 패키지 결제 귀속.
--       이후 check_in은 단건 결제(payments)만 rev에 포함.
-- ref: MQ-20260430-FOOT-STATS-FOLLOWUP-IMPL / STATS-FOLLOWUP #1
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
  -- 패키지당 가장 이른 ticketed check_in 하나에만 패키지 결제 귀속 (이중 카운트 방지)
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
    -- 단건 결제(payments)는 check_in_id 직접 조인, 패키지는 pkg_rev(1건당 1회)
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
    -- 해당 check_in 의 package_id 에 정상 패키지 결제가 있으면 패키지 전환 1
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
  LEFT JOIN ticketed t     ON t.consultant_id = s.id
  LEFT JOIN rev_per_ci rpc ON rpc.check_in_id = t.check_in_id
  LEFT JOIN pkg_flag pf    ON pf.check_in_id = t.check_in_id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

-- 권한 재부여
REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 티켓팅 실적 (이중카운트 수정). MQ-20260430-FOOT-STATS-FOLLOWUP-IMPL #1';
