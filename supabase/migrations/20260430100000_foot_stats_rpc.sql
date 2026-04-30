-- T-20260430-foot-STATS-DASHBOARD — F12 통계 대시보드 RPC 4종
-- 신규 RPC만 추가 (테이블 변경 0건). 기존 v_daily_revenue / v_monthly_consultant_perf
-- 등 통계 뷰의 핵심 패턴을 따르되, 4 섹션이 요구하는 형태로 캡슐화한다.
--
-- 보안: SECURITY INVOKER 기본값. 호출자는 RLS(`is_approved_user()`)를 거친다.
-- 권한: authenticated 만. anon/public 차단.
-- 파라미터: clinic_id 필수, 기간(p_from~p_to) 필수.
-- 통화: 환불은 음수 합산(net). 회차 단가 = unit_price + surcharge.

-- ─── 1) foot_stats_revenue ──────────────────────────────────────────────────
-- 일별 매출 추이 (단건 / 패키지 / 환불 분리). 4 KPI 카드 + 라인차트 데이터 소스.
CREATE OR REPLACE FUNCTION foot_stats_revenue(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  package_amount  BIGINT,  -- 패키지 정상 결제 (refund 제외)
  single_amount   BIGINT,  -- 단건 정상 결제 (refund 제외)
  refund_amount   BIGINT   -- 환불 합 (양수로 반환)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
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

-- ─── 2) foot_stats_by_category ──────────────────────────────────────────────
-- 시술 종류별 매출 (회차 소진 + 단건 결제 합산).
-- 회차 소진 단가 = unit_price + surcharge. status = 'used' 만.
-- 단건은 check_in_services -> services.category 그룹.
CREATE OR REPLACE FUNCTION foot_stats_by_category(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  category  TEXT,
  sessions  BIGINT,    -- 회차/건수 합
  amount    BIGINT     -- 매출 합 (net)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pkg_used AS (
    -- 패키지 회차 소진: session_type 별 그룹
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
    -- 단건: payments + check_in_services -> services.category
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

-- ─── 3) foot_stats_consultant ───────────────────────────────────────────────
-- 상담실장 티켓팅 실적.
-- ticketing_count = 본인이 consultant_id 로 잡힌 check_in 중 status가 consultation 이후로 진행된 건
--                   (status_transitions 에 to_status='consultation' 기록이 있는 check_in)
-- package_count   = 그 check_in_id에 package_payments(payment) 가 존재하는 카운트
-- avg_amount      = (해당 check_in의 payments + package_payments net 합) / ticketing_count
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
    -- check_ins -> payments 직접 연결 (단건)
    -- check_ins.package_id -> package_payments (패키지)
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

-- ─── 4) foot_stats_noshow_returning ─────────────────────────────────────────
-- 일별 노쇼율 / 재방문율.
-- noshow_rate    = count(reservations.status='noshow') / count(reservations.status IN ('checked_in','noshow'))
-- returning_rate = count(check_ins.visit_type='returning') / count(check_ins) (cancelled 제외)
CREATE OR REPLACE FUNCTION foot_stats_noshow_returning(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  noshow_rate     NUMERIC,   -- 0.0 ~ 100.0
  returning_rate  NUMERIC    -- 0.0 ~ 100.0
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT
      reservation_date AS dt,
      COUNT(*) FILTER (WHERE status = 'noshow')                              AS noshow_cnt,
      COUNT(*) FILTER (WHERE status IN ('checked_in','noshow'))              AS denom_cnt
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

-- 권한 부여: authenticated 만. anon은 차단.
REVOKE ALL ON FUNCTION foot_stats_revenue(UUID, DATE, DATE)         FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)     FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)      FROM PUBLIC;
REVOKE ALL ON FUNCTION foot_stats_noshow_returning(UUID, DATE, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION foot_stats_revenue(UUID, DATE, DATE)         TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)      TO authenticated;
GRANT EXECUTE ON FUNCTION foot_stats_noshow_returning(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_revenue(UUID, DATE, DATE)
  IS 'foot-stats: 일별 매출 (패키지/단건/환불 분리). T-20260430-foot-STATS-DASHBOARD';
COMMENT ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출 (회차 소진 + 단건). T-20260430-foot-STATS-DASHBOARD';
COMMENT ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 티켓팅 실적. T-20260430-foot-STATS-DASHBOARD';
COMMENT ON FUNCTION foot_stats_noshow_returning(UUID, DATE, DATE)
  IS 'foot-stats: 노쇼율/재방문율 추이. T-20260430-foot-STATS-DASHBOARD';
