-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260811020000_foot_testacct8_legB_istest_flag_vdailyrev
-- Ticket:  T-20260810-foot-TESTACCT-CLEANUP-8ACCT  (Leg B — is_test 컬럼 구현)
-- DA SSOT: agents/docs/da_replies/da_decision_foot_testacct_istest_additive_parity_20260810.md
--          da_consult_ref = DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY (조건부 GO)
-- change-class: ADDITIVE (§3.1 CEO 파괴게이트 면제 YES) · DDL-0 carve 아님(ADD COLUMN + view DDL 2종)
--   → supervisor DDL-diff(up/down) + DB-GATE(flag UPDATE freeze-set/rows-affected) + 물리 GO-token 선행 REQUIRED.
--   ★ apply = supervisor DB-GATE GO-token 후 db_apply_guard.sh lane 만. apply_before_go 절대금지.
--
-- 선례(byte-동형): body is_test canonical(DA-20260616-LEADS-ISTEST → 20260730_body_518_customers_is_test_additive
--   + 20260803_body_555_vdailyrev_istest_issim_filter) + 08-10 LANDED derm 인스턴스(T-20260810-derm-ISTEST-ADDITIVE).
--
-- ⚠⚠ SEMANTIC FIREWALL (DA H1 — BINDING) ⚠⚠
--   is_test ⊥ is_simulation. 절대 co-set/overload 금지.
--   - is_test        = 판정 test/연습 고객 표식 → view-hide + 매출집계 제외. 원장(진료기록부/매출) 보존.
--   - is_simulation  = phantom/시뮬 결제 마커(별 semantic·payments 유니버스 필터). 기존 컬럼 UNCHANGED.
--
-- ★ foot DA H2 (body 518 과의 shape 차이 — 주의): NOT NULL 미부여 = nullable-with-default false.
--   body 518 은 NOT NULL 이었으나 foot DA 는 NOT NULL 부여를 HARD REJECT 로 명시(§1-2/H2).
--
-- flag 대상 (DA H3 — 명시 id whitelist per-row, single-criterion blanket UPDATE 금지):
--   census(legB_istest_census.mjs, 2026-08-10 foot prod, NFC exact·유일성 확인):
--     서류테스트   F-4990 = 78975d00-9d31-4ac3-848c-0f77c6f0d735  (payments net 0 = self-상쇄 phantom)
--     총괄테스트중 F-4574 = 351d34c5-2dd9-4583-bfb3-8e27025777a6
--     서류테스트2  F-5113 = 80df7a6b-077d-46db-b9db-31591f3977a4  (payments net 0)
--   ★ 풋테스트1 F-4427 (e72022d0-…) = 이번 flip 제외(HOLD, 총괄 확대 confirm 대기). 본 마이그 미포함.
--
-- landmine guard (DA H4): 본 티켓 = flag-only(is_test). 어떤 행도 삭제하지 않음.
--   후속 물리삭제(Leg A) = 별 게이트(RRN+실결제 census 선결). flag↔delete collapse 금지.
--
-- 멱등: ADD COLUMN IF NOT EXISTS · flag UPDATE 재실행 시 동일 3행(no drift) · CREATE OR REPLACE VIEW.
-- dry-run: 20260811020000_..._flag_vdailyrev.dryrun.mjs (dryrun_lib 3요소 무영속).
-- rollback: 20260811020000_..._flag_vdailyrev.rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. customers.is_test 신규 (ADDITIVE, foot canonical shape = nullable DEFAULT false)
--    ★ NOT NULL 미부여 (DA H2). IF NOT EXISTS = 멱등.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_test boolean DEFAULT false;

COMMENT ON COLUMN public.customers.is_test IS
  '테스트/연습 고객 플래그 (T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg B). cross-CRM canonical(DA-20260616-LEADS-ISTEST, foot fork). 조회 숨김 + v_daily_revenue 매출집계 제외 = WHERE NOT COALESCE(is_test,false). ⊥ is_simulation(semantic firewall, 절대 co-set 금지).';

-- ═══════════════════════════════════════════════════════════════════════════
-- B. flag backfill — 명시 id whitelist per-row (DA H3). blanket UPDATE 금지.
--    freeze-set = 아래 3 uuid 고정(census 확정). rows-affected = 3 검증(DA H6).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.customers
   SET is_test = true
 WHERE id IN (
   '78975d00-9d31-4ac3-848c-0f77c6f0d735'::uuid,  -- F-4990 서류테스트
   '351d34c5-2dd9-4583-bfb3-8e27025777a6'::uuid,  -- F-4574 총괄테스트중
   '80df7a6b-077d-46db-b9db-31591f3977a4'::uuid   -- F-5113 서류테스트2
 );

-- ═══════════════════════════════════════════════════════════════════════════
-- C. v_daily_revenue is_test/is_simulation 이중 제외 (DA Q2 · body 555 준용 parity)
--    foot LOCAL 뷰만 대상(datalake fct_revenue_daily = foot 무접점 no-op, DA H5).
--    ★ foot 기존 술어 보존: single CTE status='active' / pkg CTE status 컬럼 부재(필터 불요).
--      security_invoker=on · anon REVOKE (20260718 base 그대로) + customers 조인 필터 ADDITIVE.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_daily_revenue
  WITH (security_invoker = on) AS
WITH single AS (
  SELECT
    (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    p.clinic_id,
    SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END)::bigint AS amt
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  WHERE p.clinic_id IS NOT NULL
    AND p.status = 'active'                       -- foot AC-B (매출분자 active, 20260718 base 보존)
    AND NOT COALESCE(c.is_test, false)            -- ★Leg B: 테스트계정 제외
    AND NOT COALESCE(c.is_simulation, false)      -- ★parity: 시뮬(매출유니버스 밖) 제외
  GROUP BY 1, 2
),
pkg AS (
  SELECT
    (pp.created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    pp.clinic_id,
    SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)::bigint AS amt
  FROM package_payments pp
  LEFT JOIN customers c ON c.id = pp.customer_id
  WHERE pp.clinic_id IS NOT NULL                  -- status 컬럼 부재(foot 실측) → 필터 불요(환불=음수상계)
    AND NOT COALESCE(c.is_test, false)            -- ★Leg B
    AND NOT COALESCE(c.is_simulation, false)      -- ★parity
  GROUP BY 1, 2
)
SELECT
  COALESCE(s.dt, p.dt) AS dt,
  COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
  COALESCE(s.amt, 0) AS single_revenue,
  COALESCE(p.amt, 0) AS package_revenue,
  COALESCE(s.amt, 0) + COALESCE(p.amt, 0) AS net_revenue
FROM single s
FULL OUTER JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

-- 보안 posture 보존(20260718): anon REVOKE (authenticated GRANT 유지).
REVOKE ALL ON public.v_daily_revenue FROM anon;

COMMENT ON VIEW public.v_daily_revenue IS
  'foot-047 + T-20260718(active/security_invoker/anon) + T-20260810-Leg B(is_test/is_simulation 제외): '
  '일 매출(payments status=active + package_payments, 환불차감). is_test/is_simulation 고객 제외'
  '(customer_id 조인, is_test⊥is_simulation firewall). security_invoker=on, anon REVOKE.';

-- ═══════════════════════════════════════════════════════════════════════════
-- D. 자기검증 (self-test — 실패 시 트랜잭션 abort)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_type      TEXT;
  v_null      TEXT;
  v_default   TEXT;
  v_flagged   BIGINT;
  v_expected  UUID[] := ARRAY[
    '78975d00-9d31-4ac3-848c-0f77c6f0d735',
    '351d34c5-2dd9-4583-bfb3-8e27025777a6',
    '80df7a6b-077d-46db-b9db-31591f3977a4']::uuid[];
  v_offlist   BIGINT;
  v_f4427     BOOLEAN;
BEGIN
  -- D1. 컬럼 shape = boolean / nullable(NOT NULL 미부여, foot H2) / default false
  SELECT data_type, is_nullable, column_default
    INTO v_type, v_null, v_default
    FROM information_schema.columns
   WHERE table_name = 'customers' AND column_name = 'is_test';
  IF v_type IS NULL THEN RAISE EXCEPTION 'customers.is_test 컬럼 생성 실패'; END IF;
  IF v_type <> 'boolean' THEN RAISE EXCEPTION 'is_test 타입 위반: % (기대 boolean)', v_type; END IF;
  IF v_null <> 'YES' THEN RAISE EXCEPTION 'foot H2 위반: is_test nullable 이어야 함(NOT NULL 금지). is_nullable=%', v_null; END IF;
  IF v_default IS NULL OR position('false' IN lower(v_default)) = 0 THEN
    RAISE EXCEPTION 'is_test DEFAULT false 위반: default=%', v_default; END IF;

  -- D2. flag rows-affected = 정확히 3(freeze-set), over-flag 0 (DA H6)
  SELECT count(*) INTO v_flagged FROM public.customers WHERE is_test IS TRUE;
  IF v_flagged <> 3 THEN
    RAISE EXCEPTION 'flag 불변식 위반: is_test=true 행 %건 (기대 3 = freeze-set). blanket/over-flag 의심.', v_flagged; END IF;

  -- D3. flag 대상이 정확히 whitelist 3 uuid (off-list flag 0)
  SELECT count(*) INTO v_offlist FROM public.customers
   WHERE is_test IS TRUE AND NOT (id = ANY(v_expected));
  IF v_offlist <> 0 THEN
    RAISE EXCEPTION 'off-list flag 위반: whitelist 밖 %건 flagged.', v_offlist; END IF;

  -- D4. F-4427(풋테스트1, HOLD) 은 flag 되지 않았어야 함
  SELECT COALESCE(is_test, false) INTO v_f4427 FROM public.customers
   WHERE id = 'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid;
  IF v_f4427 IS TRUE THEN
    RAISE EXCEPTION 'F-4427(HOLD) 가 flag 됨 — 총괄 확대 confirm 전 flip 금지.'; END IF;

  RAISE NOTICE 'Leg B self-test PASS: column nullable-default OK · flagged=3(whitelist) · F-4427 unflagged.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 사후 검증 (supervisor prod apply 후):
--   1) SELECT data_type,is_nullable,column_default FROM information_schema.columns
--      WHERE table_name='customers' AND column_name='is_test';  → boolean / YES / false.
--   2) SELECT count(*) FROM customers WHERE is_test IS TRUE;     → 3.
--   3) SELECT chart_number FROM customers WHERE is_test IS TRUE ORDER BY 1; → F-4574,F-4990,F-5113.
--   4) v_daily_revenue 에서 3계정 payments/package_payments 기여 0 (net_revenue 회귀는 net 0 이라 near-flat).
--   5) datalake fct_revenue_daily = foot 무접점 → 회귀 0 (DA H5, 필터 미추가 정상).
-- ────────────────────────────────────────────────────────────────────────────
