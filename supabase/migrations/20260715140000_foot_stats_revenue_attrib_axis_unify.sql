-- ============================================================
-- T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY  (AC2)
-- /admin/stats RPC 매출 귀속축 통일: created_at → accounting_date
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-15
-- 롤백: 20260715140000_foot_stats_revenue_attrib_axis_unify.rollback.sql
-- 게이트: DA-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY (GO, 대표게이트 불요/현데이터)
-- 표준: Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 매출-원 집계의 귀속축) ───────────────────────
--   accounting_date = sales_common_db(2026-05-15)가 선언한 회계 집계 SSOT(소급차단).
--   RPC 두 함수의 "결제(payments/package_payments) 기반 매출-원 집계"만
--   (created_at AT TIME ZONE 'Asia/Seoul')::date → accounting_date 로 정렬한다.
--     1) foot_stats_revenue.single(payments)          : dt·필터 축 전환
--     2) foot_stats_revenue.pkg(package_payments)      : dt·필터 축 전환
--     3) foot_stats_by_category.single_paid(payments)  : 필터 축 전환
--   → /admin/stats 가 CRM 자체 Sales 탭(이미 accounting_date)과 동축 수렴(DA §3 부수이득).
--
-- ─── 무엇을 안 바꾸나 (DA §3 전환금지 / 사건일 유지) ──────────────────────────
--   · foot_stats_by_category.pkg_used : package_sessions.session_date 유지.
--       package_sessions 에는 accounting_date 컬럼이 없다(결제행 아님=회차 소진 사건).
--       회계 귀속이 아니라 소진 사건일 → 전환 대상 아님(DA: 이벤트 지표 손대지 말 것).
--   · foot_stats_consultant(티켓팅 count) / foot_stats_therapist_summary(시술·지정 count)
--       = 이벤트-카운트 지표. 본 마이그 미접촉.
--   · P0 확정 산식(payments+package_payments payment − 양테이블 refund) 그대로. 귀속축만 전환.
--
-- ─── 정본 = prod 실재 (원장/파일선언 divergence 정직 수렴) ─────────────────────
--   base = prod prosrc 덤프(Management API /database/query, read-only, 2026-07-15).
--   ★ 주의: repo 의 20260706120000_foot_stats_reconcile_iv... (by_category iv-exclude)는
--     prod ledger(schema_migrations) 미등재 + prod live prosrc 에 iv 필터 부재로
--     "prod 미적용" 상태다. 따라서 본 마이그는 iv-exclude 를 채택하지 않고(별도 티켓
--     T-20260608 AC1 소관), 현행 prod live base(iv 필터 없음) 위에 귀속축만 전환한다.
--     이 ledger divergence 는 planner FOLLOWUP 으로 별도 보고(본 티켓 범위 밖).
--
-- ─── 소급 영향 (착수시점 T1 재측정, DA §2) ────────────────────────────────────
--   payments 33행·package_payments 15행 전수 accounting_date = created_at KST → divergent 0/NULL 0.
--   월 총매출순 두 축 비트동일(05:3,353,730 / 06:-2,942,720 / 07:8,439,230, 이동 0원/0%).
--   → T1 트리거 미발동 = 대표 게이트 불요. 현 데이터에서 출력 무변동 no-op(SSOT 정합 정정).
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   시그니처 불변(반환형 동일) → CREATE OR REPLACE(DROP 불요) → 42P13 불가·즉시 역전.
--   STABLE / SET search_path=public / anon 차단(authenticated only). 테이블/데이터 변경 0.
-- ============================================================

BEGIN;

-- ─── 1) foot_stats_revenue — payments·package_payments 귀속축 → accounting_date ──
CREATE OR REPLACE FUNCTION public.foot_stats_revenue(
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
SET search_path = public
AS $$
  WITH single AS (
    SELECT
      accounting_date AS dt,                             -- 귀속축: created_at → accounting_date
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to        -- 귀속축 전환
    GROUP BY 1
  ),
  pkg AS (
    SELECT
      accounting_date AS dt,                             -- 귀속축: created_at → accounting_date
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM package_payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to        -- 귀속축 전환
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

-- ─── 2) foot_stats_by_category — single_paid(payments) 귀속축 → accounting_date ──
--   pkg_used(package_sessions.session_date)는 소진 사건일이라 미변경(accounting_date 부재).
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

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)
  IS 'foot-stats: 매출 systemTotal(single/package payment − refund). 귀속축=accounting_date(회계 SSOT, 소급차단). T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY';
COMMENT ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출(회차 소진 pkg_used[session_date] + 단건 single_paid[accounting_date]). 결제 귀속축=accounting_date. T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY';

COMMIT;
