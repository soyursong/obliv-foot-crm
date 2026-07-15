-- ============================================================
-- ROLLBACK: T-20260715-foot-BYCAT-IVEXCLUDE-PROD-RECONCILE
-- foot_stats_by_category 를 post-AXIS body(iv-exclude 없음)로 복원.
--   = T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY(20260715140000) 산출물과 동일
--     (live md5 623999a0e12998f2080b976d3c938731 base 그대로 재이식, iv predicate만 제거).
-- 즉시 역전(시그니처 불변 CREATE OR REPLACE). 테이블/데이터 무접촉.
-- DB: rxlomoozakkjesdqjtvd / dev-foot / 2026-07-15
-- ============================================================

BEGIN;

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
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pkg_used AS (
    -- 패키지 회차 소진: session_type 별 그룹 (소진 사건일 = session_date 유지, 귀속축 전환 대상 아님)
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
      AND pay.accounting_date BETWEEN p_from AND p_to    -- 귀속축: created_at → accounting_date
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

REVOKE ALL ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출(회차 소진 pkg_used[session_date] + 단건 single_paid[accounting_date]). 결제 귀속축=accounting_date. T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY';

COMMIT;
