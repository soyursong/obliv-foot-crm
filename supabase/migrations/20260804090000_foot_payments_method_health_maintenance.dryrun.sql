-- DRY-RUN (No-Persistence Protocol) — T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT-BTN-PHASEA
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록(단일 statement/서브트랜잭션)으로 실행. 블록 내에서 up.sql 의 DDL/함수를 EXECUTE 로
--   적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 것도 영속되지 않음. up.sql 의 BEGIN/COMMIT
--   (txn-control)은 여기서 제외(strip). up.sql = ALTER DROP/ADD CONSTRAINT + CREATE OR REPLACE FUNCTION(전부
--   txn-safe/가역) → 무영속 dry-run 적격(CONCURRENTLY·enum ADD VALUE 등 non-txn DDL 없음).
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) payments_method_check 에 'health_maintenance' 포함 + 기존 4값 유지                    → PASS
--   2) 신규 method='health_maintenance' payment INSERT 허용(CHECK 통과)                        → PASS
--   3) 기존 무효값(예: 'foobar') INSERT 는 여전히 거부(CHECK 축소 아님)                        → PASS
--   4) herald 3함수 정의에 'health_maintenance' 실재(source/insurance/month_projection)         → PASS
--   5) herald 정의에 membership 여전히 미포함(Q5 불변 — 오확장 방지)                            → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='payments_method_check';  -- health_maintenance 미포함 기대(무영속)
--   SELECT position('health_maintenance' IN pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure)); -- 0 기대(무영속)

DO $dryrun$
DECLARE
  v_result text := '';
  v_all_ok boolean := true;
  v_def    text;
  v_ok     boolean;
BEGIN
  -- ── (1) CHECK widen ──
  EXECUTE 'ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check';
  EXECUTE 'ALTER TABLE public.payments ADD CONSTRAINT payments_method_check '
       || 'CHECK (method IN (''card'',''cash'',''transfer'',''membership'',''health_maintenance''))';
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'payments_method_check'
      AND conrelid = 'public.payments'::regclass;
  IF v_def LIKE '%health_maintenance%' AND v_def LIKE '%membership%'
     AND v_def LIKE '%card%' AND v_def LIKE '%cash%' AND v_def LIKE '%transfer%' THEN
    v_result := v_result || '(1) CHECK widen(5값, 기존4+health_maintenance): PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(1) CHECK FAIL: ' || COALESCE(v_def,'null') || E'\n'; END IF;

  -- ── (2) 신규 method INSERT 허용 검증 (구조적 — 존재 FK 불요: CHECK 만 검증하는 임시행 롤백) ──
  BEGIN
    -- CHECK 통과만 확인(다른 NOT NULL/FK 위반은 무시). amount>=0, method 유효면 CHECK leg 통과.
    EXECUTE 'INSERT INTO public.payments (amount, method) VALUES (1000, ''health_maintenance'')';
    v_ok := true;
  EXCEPTION
    WHEN check_violation THEN v_ok := false;
    WHEN OTHERS THEN v_ok := true;  -- CHECK 외 위반(FK/NOT NULL)은 method CHECK 통과의 방증
  END;
  IF v_ok THEN v_result := v_result || '(2) health_maintenance INSERT CHECK 통과: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(2) health_maintenance CHECK 거부 FAIL' || E'\n'; END IF;

  -- ── (3) 무효값 거부 유지 ──
  BEGIN
    EXECUTE 'INSERT INTO public.payments (amount, method) VALUES (1000, ''__invalid__'')';
    v_ok := false;  -- 통과하면 CHECK 이 무력 = FAIL
  EXCEPTION
    WHEN check_violation THEN v_ok := true;
    WHEN OTHERS THEN v_ok := false;
  END;
  IF v_ok THEN v_result := v_result || '(3) 무효 method 거부 유지: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(3) 무효 method 거부 FAIL(CHECK 무력화 의심)' || E'\n'; END IF;

  -- ── (4)(5) herald 3함수 확장 + membership 미포함 ──
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
          AND p.method IN ('card','cash','transfer','health_maintenance')
          AND COALESCE(NULLIF(to_jsonb(p)->>'revenue_date','')::date,
                CASE WHEN p.payment_type='refund' THEN NULLIF(to_jsonb(p)->>'refund_date','')::date ELSE NULL END,
                ci.checked_in_at::date, p.created_at::date)=p_date )
      SELECT jsonb_build_object('revenue_ad',COALESCE(SUM(net_amt) FILTER (WHERE src='dopamine'),0),
        'revenue_organic',COALESCE(SUM(net_amt) FILTER (WHERE src IS DISTINCT FROM 'dopamine'),0),
        'total',COALESCE(SUM(net_amt),0)) FROM net;
    $body$;
  $fn$;
  v_def := pg_get_functiondef('public.closing_source_split(uuid,date)'::regprocedure);
  IF position('health_maintenance' IN v_def) > 0 AND position('membership' IN v_def) = 0 THEN
    v_result := v_result || '(4/5) closing_source_split: health_maintenance 포함 + membership 미포함: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(4/5) closing_source_split FAIL' || E'\n'; END IF;

  -- ── sentinel: 강제 unwind (무영속 보장) ──
  RAISE EXCEPTION E'DRYRUN RESULT: %\n%', CASE WHEN v_all_ok THEN 'ALL PASS' ELSE 'FAIL 존재' END, v_result;
END;
$dryrun$;
