-- ============================================================
-- T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS
-- foot_stats_revenue RPC 무필터 → §R1 진성건으로 집계대상 축소 (정정)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-19
-- 롤백: 20260719140000_foot_stats_revenue_filter_sim_status.rollback.sql
-- 발원: dev-scalp2 T-20260718-scalp2-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS(deploy-ready) AC5 관찰
--        — foot_stats_revenue 는 foot 하드포크 공유 RPC(foot/women/body/scalp2 전부 보유). semantics 균일.
-- 게이트: DA §R1 semantics 계승(MSG-svqb §Q5/§Q4) → semantics 재CONSULT 불요.
--         change-class=정정/ADDITIVE-grade(순증0=집계대상 축소만) → 대표게이트 면제(autonomy §3.1)·CONVENE 불요.
-- 표준: Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 매출 집계대상 축소, 순증0) ───────────────────────
--   현행 prod RPC 는 payments·package_payments 를 clinic_id + accounting_date 로만
--   필터해 (1) is_simulation=true 고객 결제, (2) status='cancelled'/'deleted' 결제까지
--   매출에 합산한다 → /admin/stats(Stats.tsx→RevenueSection) 매출 부풀림(active inflation).
--   두 술어를 각 grain 의 customer 링크 경로로 추가해 진성건(§R1)으로만 축소한다.
--     single(payments)      : + status NOT IN ('cancelled','deleted')  + 시뮬 제외
--     pkg(package_payments) : + 시뮬 제외 (※ package_payments 엔 status 컬럼 부재 → status 술어 미적용)
--
-- ─── enum 실재 토큰 (AC2, 추정 금지 — prod CHECK 실조회 2026-07-19 PREFLIGHT) ────────
--   payments_status_check       = status IN ('active','cancelled','deleted') → 진성 = NOT IN ('cancelled','deleted')
--   payments_payment_type_check = payment_type IN ('payment','refund')       → 기존 CASE 분기 유지
--   package_payments : status 컬럼 부재(CHECK 없음) → status 술어 미적용 (scalp2 정합)
--   customers.is_simulation     = boolean (nullable, DEFAULT FALSE). is_simulation-grain = customers
--   payments.customer_id        = uuid nullable(YES) → 워크인 NULL 존재 가능 → NOT EXISTS 보존 필수
--   package_payments.customer_id= uuid NOT NULL → 항상 링크, 그래도 NOT EXISTS 로 fail-safe 통일
--   prod payments.status 실분포: active 118 / deleted 4 (cancelled 0) — deleted 4행이 필터 대상.
--
-- ─── 워크인 NULL 보존 (DA-REPLY-T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE) ──────
--   FE 방어필터(simulationFilter.ts)의 서버측 미러. ※ 단, 이 stats RPC 경로(stats.ts fetchRevenue)
--   에는 simulationFilter 가 적용되지 않는다(AC1 실측: sales 탭 전용). → 실 노출 확정, DB단 방어가 유일.
--   시뮬 제외는 INNER JOIN 이 아니라 NOT EXISTS 로 구현 → customer_id=NULL(워크인) 및 실고객
--   (is_simulation false/NULL) 행은 항상 보존하고, "positively is_simulation=true 고객 링크 행"만 제거.
--   INNER JOIN 은 워크인 매출을 조용히 드롭하므로 채택하지 않는다(fail-safe).
--
-- ─── 델타 (AC4, PREFLIGHT 2026-07-19) ────────────────────────────────────────────
--   clinic 74967aea: single 8,124,540 → 8,079,740 (하향 44,800 = 시뮬·삭제 제외분)
--                    pkg 48,730,110 → 48,730,110 (Δ0, 시뮬 pkg 결제 없음). refund 무변동.
--   → 하향 정정(버그수정). 순증0 = 집계대상 축소만.
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   시그니처 불변(반환형 4컬럼 동일) → CREATE OR REPLACE(DROP 불요) → 42P13 불가·즉시 역전.
--   STABLE / SET search_path=public / anon 차단(authenticated only). 테이블/데이터 변경 0(DDL만).
--   집계대상 축소만(순증0) → 매출 델타는 하향(버그수정).
-- ============================================================

BEGIN;

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
      accounting_date AS dt,                             -- 귀속축: accounting_date(회계 SSOT)
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND status NOT IN ('cancelled', 'deleted')         -- §R1: 진성 수납만 (취소·삭제 제외)
      AND NOT EXISTS (                                    -- §R1: 시뮬 고객 결제 제외 (워크인 customer_id=NULL 보존)
        SELECT 1 FROM customers c
        WHERE c.id = payments.customer_id
          AND c.is_simulation IS TRUE
      )
    GROUP BY 1
  ),
  pkg AS (
    SELECT
      accounting_date AS dt,                             -- 귀속축: accounting_date(회계 SSOT)
      SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END)::bigint AS pay_amt,
      SUM(CASE WHEN payment_type = 'refund'  THEN amount ELSE 0 END)::bigint AS ref_amt
    FROM package_payments
    WHERE clinic_id = p_clinic_id
      AND accounting_date BETWEEN p_from AND p_to
      AND NOT EXISTS (                                    -- §R1: 시뮬 고객 결제 제외 (package_payments.customer_id 직결)
        SELECT 1 FROM customers c
        WHERE c.id = package_payments.customer_id
          AND c.is_simulation IS TRUE
      )
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

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_revenue(UUID, DATE, DATE)
  IS 'foot-stats 매출: single/package payment−refund. 진성건만 집계(status NOT IN cancelled/deleted · is_simulation=true 고객 제외 · 워크인 customer_id=NULL 보존). 귀속축=accounting_date. T-20260719-foot-FOOTSTATS-REVENUE-UNFILTERED-SIMSTATUS';

COMMIT;
