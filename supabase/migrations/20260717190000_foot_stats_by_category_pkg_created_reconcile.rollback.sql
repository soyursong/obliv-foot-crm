-- ============================================================
-- ROLLBACK — T-20260619-foot-CATSTAT-PKGITEM-SOURCE (reconcile / FIX batch2 재이식)
-- 20260717190000 역전: foot_stats_by_category 를 **직전 현행 prod live prosrc**
--   (= 20260715140000_foot_stats_revenue_attrib_axis_unify 상태:
--      pkg_used(session_date, iv-exclude 없음) + single_paid(accounting_date)) 로 복원.
--   ★ 이 rollback 은 R5(iv-exclude) 로 되돌리지 않는다 — R5 는 prod 미적용이었고
--     20260717190000 직전의 실제 prod live 는 20260715140000 이므로 그 정본으로 복원한다.
-- 시그니처 불변(3컬럼) → CREATE OR REPLACE, 42P13 불가·비파괴.
-- ★ foot_stats_therapist_summary / foot_stats_revenue / foot_stats_consultant = 무접점(rollback 범위 밖).
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 실측 base md5(2026-07-17) = 623999a0e12998f2080b976d3c938731
-- ============================================================

BEGIN;

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

REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMIT;
