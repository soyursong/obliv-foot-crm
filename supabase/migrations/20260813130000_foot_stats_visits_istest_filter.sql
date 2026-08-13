-- ============================================================
-- T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL — STEP2 (ADDITIVE·통계뷰 is_test 필터)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase / prod)
-- 작성: dev-foot / 2026-08-13
-- 롤백: 20260813130000_foot_stats_visits_istest_filter.rollback.sql
-- 게이트: ★supervisor DDL-diff + DB-GATE GO-token 선행 필수. GO-token 前 prod apply 금지(apply_before_go).
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 통계뷰 2종에 테스트고객 제외 필터 추가) ─────────────
--   v_daily_visits / v_daily_visit_rate 는 현재 customers 미조인 → is_test 미필터(LIVE prod 실측).
--   백필로 pre-0713 215명이 customers.is_test=true 가 되어도 이 두 통계뷰에는 계속 노출됨.
--   → 두 뷰에 customers LEFT JOIN + `NOT COALESCE(c.is_test, false)` 를 추가해 테스트고객 활동을 제외.
--
-- ─── canonical 패턴 (LIVE prod v_daily_revenue 미러) ───────────────────────────────
--   v_daily_revenue(LIVE) = payments/package_payments LEFT JOIN customers c ON c.id=customer_id
--     WHERE ... AND NOT COALESCE(c.is_test,false) AND NOT COALESCE(c.is_simulation,false)
--   본 마이그는 그 중 **is_test 축만** 통계뷰 2종에 이식(planner RESUME §Step2 권한범위 = is_test).
--   ※ is_simulation 축 통계뷰 이식은 별 axis(DA GO 범위 밖) → planner 별건 surface 로 보고(FOLLOWUP).
--
-- ─── 워크인(customer_id=NULL) 보존 (fail-safe) ────────────────────────────────────
--   LEFT JOIN + NOT COALESCE(c.is_test,false): customer_id=NULL → c.* NULL → COALESCE(NULL,false)=false
--     → NOT false = true → 행 보존. INNER JOIN 은 워크인을 조용히 드롭하므로 채택 안 함.
--   LIVE 실측: v_daily_visits 워크인 check_ins 13행 / v_daily_visit_rate 워크인 reservations 132행 보존 대상.
--
-- ─── 델타 (READ-ONLY 시뮬, 2026-08-13 prod) ──────────────────────────────────────
--   [뷰개정 즉시효] 현재 is_test=true 고객 활동 제외: check_ins 11 / reservations 11.
--   [백필 후 추가효] pre-0713 215명 제외: check_ins 204(/1092 in-view) / reservations 233.
--   → 하향 정정(집계대상 축소, 순증0). 매출뷰 무접촉(v_daily_revenue 이미 필터).
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   출력 컬럼 시그니처 불변(6컬럼/5컬럼 동일) → CREATE OR REPLACE(DROP 불요)·즉시 역전 가능.
--   reloptions 미변경(security_invoker=off 현행 유지 = 보안모델 무변경, 최소 diff). GRANT 무변경.
--   테이블/데이터 변경 0(뷰 정의만). change-class = ADDITIVE-grade(집계대상 축소, 신규컬럼0·mutation0).
-- ============================================================

BEGIN;

-- ─── 1) v_daily_visits : 일자별 체크인 수 (is_test 고객 제외) ──────────────────────
CREATE OR REPLACE VIEW public.v_daily_visits AS
SELECT
  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
  ci.clinic_id,
  COUNT(*)::int AS visit_count,
  SUM(CASE WHEN ci.visit_type = 'new'        THEN 1 ELSE 0 END)::int AS new_count,
  SUM(CASE WHEN ci.visit_type = 'returning'  THEN 1 ELSE 0 END)::int AS returning_count,
  SUM(CASE WHEN ci.visit_type = 'experience' THEN 1 ELSE 0 END)::int AS experience_count
FROM check_ins ci
LEFT JOIN customers cu ON cu.id = ci.customer_id
WHERE ci.status NOT IN ('cancelled')
  AND ci.checked_in_at IS NOT NULL
  AND NOT COALESCE(cu.is_test, false)      -- ★ 테스트고객 제외 (워크인 NULL 보존)
GROUP BY 1, 2;

-- ─── 2) v_daily_visit_rate : 내원율 (분자·분모 양측 is_test 고객 제외) ────────────
CREATE OR REPLACE VIEW public.v_daily_visit_rate AS
WITH res AS (
  SELECT
    r.reservation_date AS dt,
    r.clinic_id,
    COUNT(*)::int AS total_reservations
  FROM reservations r
  LEFT JOIN customers cu ON cu.id = r.customer_id
  WHERE r.status NOT IN ('cancelled')
    AND NOT COALESCE(cu.is_test, false)    -- ★ 분모(예약)에서 테스트고객 제외 (워크인 NULL 보존)
  GROUP BY 1, 2
),
ck AS (
  SELECT
    (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    ci.clinic_id,
    COUNT(*)::int AS checkin_count
  FROM check_ins ci
  LEFT JOIN customers cu ON cu.id = ci.customer_id
  WHERE ci.status NOT IN ('cancelled')
    AND ci.checked_in_at IS NOT NULL
    AND NOT COALESCE(cu.is_test, false)    -- ★ 분자(체크인)에서 테스트고객 제외 (워크인 NULL 보존)
  GROUP BY 1, 2
)
SELECT
  COALESCE(r.dt, c.dt) AS dt,
  COALESCE(r.clinic_id, c.clinic_id) AS clinic_id,
  COALESCE(r.total_reservations, 0) AS total_reservations,
  COALESCE(c.checkin_count, 0) AS checkin_count,
  CASE
    WHEN COALESCE(r.total_reservations, 0) > 0
    THEN ROUND( (COALESCE(c.checkin_count, 0)::numeric / r.total_reservations) * 100, 1)
    ELSE 0
  END AS visit_rate_pct
FROM res r
FULL OUTER JOIN ck c ON c.dt = r.dt AND c.clinic_id = r.clinic_id;

COMMENT ON VIEW public.v_daily_visits     IS 'foot-047 + T-20260812-ISTEST-BACKFILL: 일자별 체크인 수 (cancelled 제외 · is_test 고객 제외 · 워크인 NULL 보존)';
COMMENT ON VIEW public.v_daily_visit_rate IS 'foot-047 + T-20260812-ISTEST-BACKFILL: 내원율 % (checkin/reservation · 양측 is_test 고객 제외 · 워크인 NULL 보존)';

COMMIT;

NOTIFY pgrst, 'reload schema';
