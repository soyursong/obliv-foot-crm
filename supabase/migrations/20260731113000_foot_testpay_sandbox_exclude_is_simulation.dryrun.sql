-- DRY-RUN (No-Persistence Protocol) — T-20260731-foot-TESTPAY-SANDBOX-EXCLUDE is_simulation physlink ARMING
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록(= 단일 statement, 단일 서브트랜잭션)으로 실행. 블록 내에서 up.sql 의 DDL/함수를
--   EXECUTE 로 적용·검증한 뒤, 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 것도 영속되지 않음.
--   단일 statement 이므로 Management API /database/query 의 autocommit-between-statements 불가.
--   up.sql 의 BEGIN/COMMIT(txn-control)은 여기서 제외(strip) — DO 블록이 트랜잭션 경계 제공.
--   ⚠ up.sql 은 순수 ALTER ADD COLUMN + CREATE FUNCTION/TRIGGER + CREATE OR REPLACE(전부 txn-safe/가역) →
--     무영속 dry-run 적격(CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) 3-grain is_simulation 컬럼 생성(boolean NOT NULL DEFAULT false)          → PASS
--   2) stamp 함수 prosecdef=true + search_path 고정                              → PASS
--   3) 3-grain BEFORE INSERT sim-stamp 트리거 생성                              → PASS
--   4) closing_source_split / closing_insurance_split 정의에 'is_simulation IS NOT TRUE' 실재 → PASS
--   ⚠ behavioral(테스트고객 stamp / 무회귀 산출 동일)은 실 apply 후 별 probe 에서 검증(dryrun 스코프 아님).
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT count(*) FROM information_schema.columns
--     WHERE table_name IN ('payments','service_charges','package_payments') AND column_name='is_simulation'; -- 기대 0
--   SELECT position('is_simulation IS NOT TRUE' IN pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure)); -- 기대 0
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 4종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_ok boolean := true;
  v_cnt      int;
  v_secdef   boolean;
  v_config   text[];
  v_srcdef   text;
  v_insdef   text;
BEGIN
  -- ── (1) DDL: 3-grain 컬럼 ──
  EXECUTE 'ALTER TABLE public.payments          ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false';
  EXECUTE 'ALTER TABLE public.service_charges   ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false';
  EXECUTE 'ALTER TABLE public.package_payments  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false';
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND column_name='is_simulation'
     AND table_name IN ('payments','service_charges','package_payments')
     AND data_type='boolean' AND is_nullable='NO' AND column_default='false';
  IF v_cnt = 3 THEN v_result := v_result || '(1) 3-grain 컬럼(boolean NOT NULL DEFAULT false): PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(1) 컬럼 FAIL (n='||v_cnt||'/3)' || E'\n'; END IF;

  -- ── (2) stamp 함수 ──
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.stamp_is_simulation_from_customer()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $body$
    BEGIN
      IF NEW.is_simulation IS NOT TRUE AND NEW.customer_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.is_simulation = true) THEN
          NEW.is_simulation := true;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $body$;
  $fn$;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config
    FROM pg_proc p WHERE p.proname='stamp_is_simulation_from_customer';
  IF v_secdef IS TRUE AND array_to_string(v_config,',') LIKE '%search_path=public%' THEN
    v_result := v_result || '(2) stamp 함수 SECDEF+search_path: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(2) stamp 함수 FAIL (secdef='||coalesce(v_secdef::text,'null')||')' || E'\n'; END IF;

  -- ── (3) 3-grain BEFORE INSERT sim-stamp 트리거 ──
  EXECUTE 'DROP TRIGGER IF EXISTS trg_payments_sim_stamp_insert ON public.payments';
  EXECUTE 'CREATE TRIGGER trg_payments_sim_stamp_insert BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.stamp_is_simulation_from_customer()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_service_charges_sim_stamp_insert ON public.service_charges';
  EXECUTE 'CREATE TRIGGER trg_service_charges_sim_stamp_insert BEFORE INSERT ON public.service_charges FOR EACH ROW EXECUTE FUNCTION public.stamp_is_simulation_from_customer()';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_package_payments_sim_stamp_insert ON public.package_payments';
  EXECUTE 'CREATE TRIGGER trg_package_payments_sim_stamp_insert BEFORE INSERT ON public.package_payments FOR EACH ROW EXECUTE FUNCTION public.stamp_is_simulation_from_customer()';
  SELECT count(*) INTO v_cnt FROM information_schema.triggers
   WHERE event_object_schema='public' AND action_timing='BEFORE' AND event_manipulation='INSERT'
     AND trigger_name IN ('trg_payments_sim_stamp_insert','trg_service_charges_sim_stamp_insert','trg_package_payments_sim_stamp_insert');
  IF v_cnt = 3 THEN v_result := v_result || '(3) 3-grain sim-stamp 트리거: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(3) 트리거 FAIL (n='||v_cnt||'/3)' || E'\n'; END IF;

  -- ── (4) 제외필터 배선 (split 함수) ──
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
    RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $body$
      WITH net AS (
        SELECT (CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END) AS net_amt, r.source_system AS src
        FROM public.payments p
        LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
        LEFT JOIN public.reservations r ON r.id=ci.reservation_id
        WHERE COALESCE(p.clinic_id,ci.clinic_id)=p_clinic
          AND p.is_simulation IS NOT TRUE
          AND p.method IN ('card','cash','transfer')
          AND COALESCE(NULLIF(to_jsonb(p)->>'revenue_date','')::date,
                CASE WHEN p.payment_type='refund' THEN NULLIF(to_jsonb(p)->>'refund_date','')::date ELSE NULL END,
                ci.checked_in_at::date, p.created_at::date)=p_date )
      SELECT jsonb_build_object('revenue_ad',COALESCE(SUM(net_amt) FILTER (WHERE src='dopamine'),0),
        'revenue_organic',COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'),0),
        'total',COALESCE(SUM(net_amt),0)) FROM net;
    $body$;
  $fn$;
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
    RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $body$
      WITH net AS (
        SELECT (CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END) AS net_amt,
          EXISTS (SELECT 1 FROM public.service_charges sc WHERE sc.check_in_id=p.check_in_id
                    AND sc.is_insurance_covered=true AND sc.is_simulation IS NOT TRUE) AS is_ins
        FROM public.payments p LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
        WHERE COALESCE(p.clinic_id,ci.clinic_id)=p_clinic
          AND p.is_simulation IS NOT TRUE
          AND p.method IN ('card','cash','transfer')
          AND COALESCE(NULLIF(to_jsonb(p)->>'revenue_date','')::date,
                CASE WHEN p.payment_type='refund' THEN NULLIF(to_jsonb(p)->>'refund_date','')::date ELSE NULL END,
                ci.checked_in_at::date, p.created_at::date)=p_date ),
      covered AS (
        SELECT COALESCE(SUM(sc.insurance_covered_amount),0) AS ins_covered
        FROM public.service_charges sc LEFT JOIN public.check_ins ci ON ci.id=sc.check_in_id
        WHERE COALESCE(sc.clinic_id,ci.clinic_id)=p_clinic AND sc.is_simulation IS NOT TRUE
          AND sc.is_insurance_covered=true
          AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date)=p_date )
      SELECT jsonb_build_object('rev_copay_self',COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins) FROM net),0),
        'rev_noninsurance',COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net),0),
        'rev_insurance_covered',(SELECT ins_covered FROM covered),
        'total',COALESCE((SELECT SUM(net_amt) FROM net),0));
    $body$;
  $fn$;
  v_srcdef := pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure);
  v_insdef := pg_get_functiondef('public.closing_insurance_split(uuid,date)'::regprocedure);
  IF position('is_simulation IS NOT TRUE' IN v_srcdef) > 0
     AND (length(v_insdef) - length(replace(v_insdef,'is_simulation IS NOT TRUE',''))) / length('is_simulation IS NOT TRUE') = 3 THEN
    v_result := v_result || '(4) 제외필터(source 1conj + insurance 3conj): PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(4) 제외필터 FAIL' || E'\n'; END IF;

  -- ── sentinel: 강제 unwind (무영속 보장) ──
  RAISE EXCEPTION E'DRYRUN RESULT: %\n%', CASE WHEN v_all_ok THEN 'ALL PASS' ELSE 'FAIL 존재' END, v_result;
END;
$dryrun$;
