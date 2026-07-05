-- ============================================================
-- ROLLBACK: 20260608160000_foot_stats_iv_exclude_trial_conversion.sql
-- T-20260608-foot-TICKET-DEDUCT-SLOT-DATA (AC1 + AC3) 역연산.
-- foot_stats_by_category / foot_stats_therapist_summary 를 변경 직전(원본)으로 복원.
--   - foot_stats_by_category       : 20260430100000_foot_stats_rpc.sql 원본
--   - foot_stats_therapist_summary : 20260607210000_foot_therapist_stats_rpc.sql 원본
-- 테이블·행 무변경이므로 함수 본문 복원만으로 완전 역전.
-- ============================================================

BEGIN;

-- ─── 복원 1) foot_stats_by_category (iv 제외 줄 제거) ─────────────────────────
CREATE OR REPLACE FUNCTION foot_stats_by_category(
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
SECURITY INVOKER
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

-- ─── 복원 2) foot_stats_therapist_summary (당일 전환 조건 제거) ───────────────
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
      b.id,
      b.therapist_id,
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
    SELECT
      therapist_id,
      COUNT(*) FILTER (WHERE minutes > 0)::int AS tcount,
      AVG(minutes) FILTER (WHERE minutes > 0)  AS avg_min
    FROM durations
    GROUP BY therapist_id
  ),
  exp_agg AS (
    SELECT
      b.therapist_id,
      COUNT(*)::int AS exp_total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM package_payments pp
        WHERE pp.package_id = b.package_id
          AND pp.payment_type = 'payment'
      ))::int AS exp_conv
    FROM base b
    WHERE b.visit_type = 'experience'
    GROUP BY b.therapist_id
  )
  SELECT
    s.id                                                   AS therapist_id,
    s.name                                                 AS name,
    COALESCE(d.tcount, 0)                                  AS treatment_count,
    CASE WHEN d.avg_min IS NOT NULL THEN ROUND(d.avg_min, 1) END AS avg_treatment_minutes,
    COALESCE(e.exp_total, 0)                               AS experience_total,
    COALESCE(e.exp_conv, 0)                                AS experience_converted,
    CASE WHEN COALESCE(e.exp_total, 0) > 0
      THEN ROUND(e.exp_conv::numeric / e.exp_total * 100, 1)
    END                                                    AS conversion_rate
  FROM therapists t
  JOIN staff s        ON s.id = t.therapist_id
  LEFT JOIN dur_agg d ON d.therapist_id = t.therapist_id
  LEFT JOIN exp_agg e ON e.therapist_id = t.therapist_id
  WHERE s.clinic_id = p_clinic_id
  ORDER BY avg_treatment_minutes DESC NULLS LAST, s.name;
$$;

REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_therapist_summary(UUID, DATE, DATE)  TO authenticated;

COMMIT;
