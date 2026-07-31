-- T-20260731-foot-TESTPAY-SANDBOX-EXCLUDE — '테스트-수납' 매출·감사 제외 (is_simulation physlink ARMING)
-- DA CONSULT: DA-20260731-FOOT-TESTPAY-SANDBOX-EXCLUDE = GO (ADDITIVE). 정본 forward-doc =
--   1_Projects/201_메디빌더_AI도입/da_consult_reply_foot_testpay_sandbox_exclude_20260731.md
--
-- 무엇: foot dormant `is_simulation` physlink 에 돈-grain sim 쓰기경로를 최초 도입(cross-CRM 최초 실사례).
--   직원이 시스템 점검용으로 넣는 '테스트-수납'(가짜 결제)이 실 매출·감사 집계에 섞이지 않도록,
--   money-grain(payments/service_charges/package_payments)에 self-state 제외축 컬럼을 신설하고,
--   테스트 고객 수납행 INSERT 시 각인(stamp)하며, 매출 split 유니버스에서 행 전체를 드롭한다.
--
-- DA semantics (CONSULT-REPLY 계승):
--   • canonical 축 = is_simulation(money-grain self-state, 매출/감사 제외축). ★필수.
--   • is_test(customers-grain view-hide, 고객목록 숨김·매출무관)와 grain/write-path 상이 → co-set 위반 아님.
--     foot 의 customers-grain 테스트 플래그 등가물 = 기존 customers.is_simulation(존재·DEFAULT false).
--     → stamp 는 이 기존 customers.is_simulation 을 driver 로 읽어 money-grain is_simulation 을 채운다.
--       (customers 신규 is_test 추가는 별 grain·본 티켓 DDL 범위 밖 = 3-grain money 한정.)
--   • ADDITIVE: 매출 산식 무변경. 세 split SSOT 가 이미 is_simulation IS NOT TRUE 를 유니버스로 잠금(현 no-op).
--
-- lockstep 순서(본 파일 내): DDL(3-grain 컬럼) → write-path stamp(트리거) → 제외필터(split 함수 복원).
--
-- 무회귀(AC4): 신규 컬럼 전원 DEFAULT false + 소급 backfill 없음 → WHERE is_simulation IS NOT TRUE 가
--   0행 드롭 → closing_source_split/closing_insurance_split 산출값 무변화. stamp 후 테스트 수납행만 드롭.
--
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
--   재실행 안전. 3-grain 동시 arming(부분 arming 금지).
-- rollback: 20260731113000_foot_testpay_sandbox_exclude_is_simulation.rollback.sql
-- dryrun : 20260731113000_foot_testpay_sandbox_exclude_is_simulation.dryrun.sql (No-Persistence sentinel)
-- 작성: dev-foot / 2026-07-31

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) DDL — 3-grain is_simulation 컬럼 신설 (부재 grain 한정, ADDITIVE, PG11+ 메타op)
--    payments.customer_id 는 nullable(워크인) — 컬럼은 NOT NULL DEFAULT false 이므로 행 자체는 안전.
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_charges
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payments.is_simulation IS
  'T-TESTPAY-SANDBOX-EXCLUDE: money-grain 시뮬(테스트-수납) 제외 self-state. true=매출/감사 유니버스에서 행 전체 드롭. '
  '테스트고객(customers.is_simulation=true) 수납 INSERT 시 trg_payments_sim_stamp_insert 가 각인. 정상경로 DEFAULT false.';
COMMENT ON COLUMN public.service_charges.is_simulation IS
  'T-TESTPAY-SANDBOX-EXCLUDE: money-grain 시뮬 제외 self-state(명세 grain). true=공단부담/급여 split 유니버스 드롭.';
COMMENT ON COLUMN public.package_payments.is_simulation IS
  'T-TESTPAY-SANDBOX-EXCLUDE: money-grain 시뮬 제외 self-state(패키지결제 grain). grain-완전 arming.';

-- 제외필터(WHERE is_simulation IS NOT TRUE) 최적화용 부분 인덱스 — sim=true 소량만 색인(customers 패턴 준용).
CREATE INDEX IF NOT EXISTS idx_payments_simulation
  ON public.payments(is_simulation) WHERE is_simulation = true;
CREATE INDEX IF NOT EXISTS idx_service_charges_simulation
  ON public.service_charges(is_simulation) WHERE is_simulation = true;
CREATE INDEX IF NOT EXISTS idx_package_payments_simulation
  ON public.package_payments(is_simulation) WHERE is_simulation = true;

-- ══════════════════════════════════════════════════════════════════
-- 2) write-path stamp — 테스트고객 수납/명세/패키지결제 INSERT 시 is_simulation=true 각인
--    driver = customers.is_simulation(기존 customers-grain 테스트 플래그).
--    fail-open: 명시적으로 이미 true 로 들어온 값은 보존(E2E 픽스처 self-id 등), 테스트고객이면 강제 true.
--    SECURITY DEFINER: 호출자 RLS 무관하게 customers 조회. search_path 고정.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.stamp_is_simulation_from_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 이미 true(명시 각인) 이거나 워크인(customer_id NULL) 이면 조회 생략 → DEFAULT/명시값 보존.
  IF NEW.is_simulation IS NOT TRUE AND NEW.customer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = NEW.customer_id
        AND c.is_simulation = true
    ) THEN
      NEW.is_simulation := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_is_simulation_from_customer() IS
  'T-TESTPAY-SANDBOX-EXCLUDE: BEFORE INSERT — 연결 고객이 테스트(customers.is_simulation=true)면 money-grain '
  'is_simulation=true 각인. 명시 true 보존(fail-open), 워크인/정상경로는 DEFAULT false. payments/service_charges/package_payments 공용.';

-- 기존 BEFORE INSERT 트리거(accounting_date 계열)와 독립 — is_simulation 은 accounting_date 와 무관, 순서 무영향.
DROP TRIGGER IF EXISTS trg_payments_sim_stamp_insert ON public.payments;
CREATE TRIGGER trg_payments_sim_stamp_insert
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_is_simulation_from_customer();

DROP TRIGGER IF EXISTS trg_service_charges_sim_stamp_insert ON public.service_charges;
CREATE TRIGGER trg_service_charges_sim_stamp_insert
  BEFORE INSERT ON public.service_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_is_simulation_from_customer();

DROP TRIGGER IF EXISTS trg_package_payments_sim_stamp_insert ON public.package_payments;
CREATE TRIGGER trg_package_payments_sim_stamp_insert
  BEFORE INSERT ON public.package_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_is_simulation_from_customer();

-- ══════════════════════════════════════════════════════════════════
-- 3) 제외필터 배선 — source-split·insurance-split 상류 공유입력 universe 에
--    WHERE is_simulation IS NOT TRUE 행 전체 드롭. ⛔ ad/organic 버킷 선택적용 금지
--    (net CTE 상류에서 드롭 → FILTER 이전 = ad+organic==total 항등 불변, §4 INV1 회귀검증).
--    ※ 나머지 본문은 20260718140000_foot_closing_herald_pilot.sql 정본과 동일(필터 conjunct 만 추가).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      r.source_system AS src
    FROM public.payments p
    LEFT JOIN public.check_ins ci   ON ci.id = p.check_in_id
    LEFT JOIN public.reservations r ON r.id = ci.reservation_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE                 -- ★TESTPAY-SANDBOX: 테스트-수납 행 전체 드롭(U1 첫 conjunct)
      AND p.method IN ('card','cash','transfer')      -- ★Q5: membership(선불 use) S밖
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  )
  SELECT jsonb_build_object(
    'revenue_ad',      COALESCE(SUM(net_amt) FILTER (WHERE src = 'dopamine'), 0),
    'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'), 0),
    'total',           COALESCE(SUM(net_amt), 0)
  )
  FROM net;
$$;

COMMENT ON FUNCTION public.closing_source_split(UUID, DATE) IS
  'T-CLOSING-HERALD: 마감 시점 유입경로축(오가닉/광고) 즉시 산출. dopamine=광고. '
  'revenue_ad+revenue_organic=total 항등(INV1). Q5 membership 제외. Silver 미경유(AXIS-DATAPATH-GUARD). '
  '★T-TESTPAY-SANDBOX-EXCLUDE: is_simulation IS NOT TRUE 상류 드롭(버킷 선택적용 금지·항등 불변).';

CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH net AS (
    SELECT
      (CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END) AS net_amt,
      EXISTS (
        SELECT 1 FROM public.service_charges sc
        WHERE sc.check_in_id = p.check_in_id
          AND sc.is_insurance_covered = true
          AND sc.is_simulation IS NOT TRUE          -- ★TESTPAY-SANDBOX: 테스트 명세는 급여분류에 미기여
      ) AS is_ins
    FROM public.payments p
    LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
    WHERE COALESCE(p.clinic_id, ci.clinic_id) = p_clinic
      AND p.is_simulation IS NOT TRUE                 -- ★TESTPAY-SANDBOX: S 동일 유니버스 드롭(INV5 유지)
      AND p.method IN ('card','cash','transfer')      -- S 동일 유니버스(INV5)
      AND COALESCE(
            NULLIF(to_jsonb(p) ->> 'revenue_date', '')::date,
            CASE WHEN p.payment_type = 'refund'
                 THEN NULLIF(to_jsonb(p) ->> 'refund_date', '')::date ELSE NULL END,
            ci.checked_in_at::date,
            p.created_at::date
          ) = p_date
  ),
  covered AS (
    SELECT COALESCE(SUM(sc.insurance_covered_amount), 0) AS ins_covered
    FROM public.service_charges sc
    LEFT JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE COALESCE(sc.clinic_id, ci.clinic_id) = p_clinic
      AND sc.is_simulation IS NOT TRUE                -- ★TESTPAY-SANDBOX: 테스트 명세 공단부담 드롭(감사 제외)
      AND sc.is_insurance_covered = true
      AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date) = p_date
  )
  SELECT jsonb_build_object(
    'rev_copay_self',       COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins)     FROM net), 0),
    'rev_noninsurance',     COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net), 0),
    'rev_insurance_covered',(SELECT ins_covered FROM covered),
    'total',                COALESCE((SELECT SUM(net_amt) FROM net), 0)
  );
$$;

COMMENT ON FUNCTION public.closing_insurance_split(UUID, DATE) IS
  'T-CLOSING-HERALD(foot 신규): 급여구분축. copay_self+noninsurance=total(INV2, S partition). '
  'rev_insurance_covered=공단부담(명세 grain, total 밖·>=0, INV3 독립). Q2 기존 보험축(is_insurance_covered). '
  'tax_type 오버로드 금지. payment-grain 근사(혼합 check_in). Silver 미경유(AXIS-DATAPATH-GUARD). '
  '★T-TESTPAY-SANDBOX-EXCLUDE: payments/service_charges is_simulation IS NOT TRUE 상류 드롭(S·covered 동일).';

COMMIT;
