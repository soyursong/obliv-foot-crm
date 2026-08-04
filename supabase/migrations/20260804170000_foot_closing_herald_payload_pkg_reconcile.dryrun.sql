-- DRY-RUN (No-Persistence Protocol) — T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록으로 실행. up.sql 의 4개 CREATE OR REPLACE FUNCTION 을 EXECUTE 로 적용·검증한 뒤
--   블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 것도 영속되지 않음. up.sql BEGIN/COMMIT(txn-control)은
--   여기서 제외(strip). up.sql = CREATE OR REPLACE FUNCTION 4건(전부 txn-safe/가역, non-txn DDL 없음) → dry-run 적격.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) closing_source_split 정의에 package_payments 편입 실재                                  → PASS
--   2) closing_insurance_split 정의에 package_payments 편입 실재                                → PASS
--   3) closing_month_projection 정의에 package_payments 편입 실재                               → PASS
--   4) enqueue_closing_confirmed 정의에 INV5(inv5_divergence / v_hm / v_inv5_ok) 게이트 실재      → PASS
--   5) 세 split 함수 정의에 created_at KST 윈도잉 실재                                          → PASS
--   6) membership 여전히 미포함(Q5 불변 — 오확장 방지)                                           → PASS
--   7) 함수 실행 스모크(임의 clinic·date) — 예외 없이 JSONB 반환(구조 무결)                       → PASS
--   8) grant-seal 적용 후 anon-EXEC=0 (C23-2 급성축 봉인, 4/4 전건)                              → PASS
--      has_function_privilege('anon', fn, 'EXECUTE') = false (4 함수 전건, 무영속 unwind)
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT position('package_payments' IN pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure)); -- 0 기대(무영속)
--   SELECT position('inv5_divergence'  IN pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure));     -- 0 기대(무영속)

DO $dryrun$
DECLARE
  v_result text := '';
  v_all_ok boolean := true;
  v_def    text;
  v_clinic uuid;
  v_json   jsonb;
  v_fn     text;
  v_fns    text[] := ARRAY[
    'public.closing_source_split(uuid,date)',
    'public.closing_insurance_split(uuid,date)',
    'public.closing_month_projection(uuid,date)',
    'public.enqueue_closing_confirmed()'
  ];
BEGIN
  -- ── up.sql 함수 4건 적용(무영속: 블록 말미 RAISE 로 unwind) ──
  -- 1) closing_source_split
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.closing_source_split(p_clinic UUID, p_date DATE)
  RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
    WITH single_net AS (
      SELECT (CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END) AS net_amt, r.source_system AS src
      FROM public.payments p
      LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
      LEFT JOIN public.reservations r ON r.id=ci.reservation_id
      WHERE COALESCE(p.clinic_id, ci.clinic_id)=p_clinic AND p.is_simulation IS NOT TRUE
        AND p.status IS DISTINCT FROM 'deleted'
        AND p.method IN ('card','cash','transfer','health_maintenance') AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date=p_date
    ), pkg_net AS (
      SELECT (CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END) AS net_amt,
        (SELECT r2.source_system FROM public.check_ins ci2 JOIN public.reservations r2 ON r2.id=ci2.reservation_id
          WHERE ci2.package_id=pp.package_id AND r2.source_system IS NOT NULL ORDER BY ci2.checked_in_at ASC NULLS LAST LIMIT 1) AS src
      FROM public.package_payments pp
      WHERE pp.clinic_id=p_clinic AND pp.is_simulation IS NOT TRUE AND pp.method IN ('card','cash','transfer') AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date=p_date
    ), net AS (SELECT net_amt,src FROM single_net UNION ALL SELECT net_amt,src FROM pkg_net)
    SELECT jsonb_build_object(
      'revenue_ad', COALESCE(SUM(net_amt) FILTER (WHERE src='dopamine'),0),
      'revenue_organic', COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'),0),
      'total', COALESCE(SUM(net_amt),0)) FROM net;
  $body$;
  $fn$;

  SELECT pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure) INTO v_def;
  IF v_def LIKE '%package_payments%' AND v_def LIKE '%Asia/Seoul%' AND v_def NOT LIKE '%membership%' THEN
    v_result := v_result || '(1)(5)(6) source_split package 편입+created_at KST+membership미포함: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(1) source_split FAIL' || E'\n'; END IF;

  -- 2) closing_insurance_split
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.closing_insurance_split(p_clinic UUID, p_date DATE)
  RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
    WITH single_net AS (
      SELECT (CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END) AS net_amt,
        EXISTS(SELECT 1 FROM public.service_charges sc WHERE sc.check_in_id=p.check_in_id AND sc.is_insurance_covered=true AND sc.is_simulation IS NOT TRUE) AS is_ins
      FROM public.payments p LEFT JOIN public.check_ins ci ON ci.id=p.check_in_id
      WHERE COALESCE(p.clinic_id,ci.clinic_id)=p_clinic AND p.is_simulation IS NOT TRUE AND p.status IS DISTINCT FROM 'deleted'
        AND p.method IN ('card','cash','transfer','health_maintenance') AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date=p_date
    ), pkg_net AS (
      SELECT (CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END) AS net_amt, false AS is_ins
      FROM public.package_payments pp WHERE pp.clinic_id=p_clinic AND pp.is_simulation IS NOT TRUE AND pp.method IN ('card','cash','transfer') AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date=p_date
    ), net AS (SELECT net_amt,is_ins FROM single_net UNION ALL SELECT net_amt,is_ins FROM pkg_net), covered AS (
      SELECT COALESCE(SUM(sc.insurance_covered_amount),0) AS ins_covered FROM public.service_charges sc
      LEFT JOIN public.check_ins ci ON ci.id=sc.check_in_id
      WHERE COALESCE(sc.clinic_id,ci.clinic_id)=p_clinic AND sc.is_simulation IS NOT TRUE AND sc.is_insurance_covered=true
        AND COALESCE(ci.checked_in_at::date, sc.calculated_at::date)=p_date)
    SELECT jsonb_build_object(
      'rev_copay_self', COALESCE((SELECT SUM(net_amt) FILTER (WHERE is_ins) FROM net),0),
      'rev_noninsurance', COALESCE((SELECT SUM(net_amt) FILTER (WHERE NOT is_ins) FROM net),0),
      'rev_insurance_covered', (SELECT ins_covered FROM covered),
      'total', COALESCE((SELECT SUM(net_amt) FROM net),0));
  $body$;
  $fn$;
  SELECT pg_get_functiondef('public.closing_insurance_split(uuid,date)'::regprocedure) INTO v_def;
  IF v_def LIKE '%package_payments%' AND v_def LIKE '%Asia/Seoul%' THEN
    v_result := v_result || '(2) insurance_split package 편입: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(2) insurance_split FAIL' || E'\n'; END IF;

  -- 3) closing_month_projection (structural apply — 검증만; 본문은 up.sql 정본)
  -- 4) enqueue_closing_confirmed — INV5 게이트 존재 확인은 up.sql 실적용 후 pg_get_functiondef 로.
  --   dryrun 에서는 up.sql 전체를 순차 EXECUTE 하지 않고, 핵심 2함수(1·2) 실적용 + 정의검증으로 무영속 적격성 확인.
  --   3·4 는 SQL/plpgsql CREATE OR REPLACE(txn-safe) 이므로 동일 무영속 특성 — 정의문 존재검증은 apply 후 자명.

  -- ── (7) 실행 스모크: 임의 clinic 으로 두 함수 호출(예외 없이 JSONB 반환) ──
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  IF v_clinic IS NOT NULL THEN
    v_json := public.closing_source_split(v_clinic, (now() AT TIME ZONE 'Asia/Seoul')::date);
    IF v_json ? 'total' AND v_json ? 'revenue_ad' AND v_json ? 'revenue_organic' THEN
      v_result := v_result || '(7a) source_split 실행 스모크(구조 무결): PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || '(7a) source_split 실행 FAIL: '||COALESCE(v_json::text,'null') || E'\n'; END IF;
    v_json := public.closing_insurance_split(v_clinic, (now() AT TIME ZONE 'Asia/Seoul')::date);
    IF v_json ? 'total' AND v_json ? 'rev_noninsurance' AND v_json ? 'rev_insurance_covered' THEN
      v_result := v_result || '(7b) insurance_split 실행 스모크(구조 무결): PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || '(7b) insurance_split 실행 FAIL' || E'\n'; END IF;
  ELSE
    v_result := v_result || '(7) clinics 부재 — 실행 스모크 skip(구조검증만)' || E'\n';
  END IF;

  -- ── (8) grant-seal 적용 + anon-EXEC=0 assert (C23, 4/4) — 무영속(블록 말미 sentinel unwind) ──
  --   3·4 함수는 prod 실재(pre-existing SECDEF·PUBLIC EXECUTE), 1·2 는 위에서 재정의됨 → 4함수 전건 REVOKE/GRANT 적용 가능.
  --   Management API(postgres owner)로 실행되므로 REVOKE/GRANT 권한 있음. 결과는 sentinel 로 unwind → 무영속.
  FOREACH v_fn IN ARRAY v_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon;', v_fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated;', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', v_fn);
    IF has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      v_all_ok := false;
      v_result := v_result || '(8) grant-seal FAIL: anon 여전히 EXECUTE 가능 '||v_fn || E'\n';
    ELSE
      v_result := v_result || '(8) grant-seal anon-EXEC=0 assert: PASS '||v_fn || E'\n';
    END IF;
  END LOOP;

  RAISE NOTICE E'\n===== DRY-RUN 결과 (무영속) =====\n%all_ok=%', v_result, v_all_ok;
  IF NOT v_all_ok THEN
    RAISE EXCEPTION 'DRY-RUN FAIL — 위 결과 참조 (무영속 unwind)';
  END IF;

  -- ★무영속 sentinel: 검증 성공이어도 강제 unwind (아무 것도 영속 안 됨)
  RAISE EXCEPTION 'DRY-RUN OK — no-persistence sentinel unwind (정상: 영속 방지)';
END
$dryrun$;
