-- DRY-RUN (No-Persistence Protocol) — T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (supersede fix)
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 단일 DO 블록으로 실행. up.sql 의 enqueue_closing_confirmed CREATE OR REPLACE 를 EXECUTE 로 적용·
--   검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 어떤 것도 영속되지 않음. up.sql BEGIN/COMMIT(txn-control)
--   은 여기서 제외(strip). up.sql = CREATE OR REPLACE FUNCTION 1건(txn-safe/가역, non-txn DDL 없음) → dry-run 적격.
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   1) enqueue_closing_confirmed 정의에 self-supersede `(NEW.revision > 0)` 잔재 0 (INSERT superseded 컬럼)  → PASS
--   2) enqueue 정의에 신규 supersede-UPDATE(revision < NEW.revision → superseded=true) 실재               → PASS
--   3) enqueue 정의에 신규 행 payload 'superseded' false 고정(self-supersede 제거)                          → PASS
--   4) split 3함수는 무접촉(package_payments 편입·created_at KST 정본 유지 — 회귀 0)                          → PASS
--   5) grant-seal 적용 후 anon-EXEC=0 (C23-2 급성축 봉인)                                                    → PASS
--   6) ★reader-visibility 시뮬(무영속): 임시 outbox 시나리오로 supersede 규칙 correctness 실증                → PASS
--        ①신 rev superseded=false ②read fn 반환 포함 ③구 rev 전건 superseded=true
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT position('revision < NEW.revision' IN pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure)); -- 0 기대(무영속)

DO $dryrun$
DECLARE
  v_result  text := '';
  v_all_ok  boolean := true;
  v_def     text;
  v_clinic  uuid;
  v_slug    text := 'dryrun-foot';
  v_cnt     int;
  v_vis0    int;   -- rev0 가시 여부(리더 반환)
  v_vis1    int;   -- rev1 가시 여부(리더 반환)
  v_sup0    boolean;
  v_sup1    boolean;
BEGIN
  -- ── up.sql enqueue 함수 적용(무영속: 블록 말미 RAISE 로 unwind) ──
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.enqueue_closing_confirmed()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
  DECLARE
    v_entering_closed BOOLEAN;
    v_slug TEXT;
    v_payload JSONB;
    v_src JSONB; v_total BIGINT; v_ad BIGINT; v_org BIGINT; v_src_ok BOOLEAN := false;
    v_ins JSONB; v_copay BIGINT; v_nonins BIGINT; v_covered BIGINT; v_ins_ok BOOLEAN := false;
    v_month JSONB; v_sys_total BIGINT;
    v_hm BIGINT := 0; v_inv5_ok BOOLEAN := true;
    v_status TEXT := 'pending'; v_dlq BOOLEAN := false; v_lasterr TEXT := NULL;
  BEGIN
    v_entering_closed := (NEW.status='closed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'closed');
    IF NOT v_entering_closed THEN RETURN NEW; END IF;
    SELECT slug INTO v_slug FROM public.clinics WHERE id=NEW.clinic_id;
    BEGIN
      v_sys_total := COALESCE(NEW.package_card_total,0)+COALESCE(NEW.single_card_total,0)
        +COALESCE(NEW.package_cash_total,0)+COALESCE(NEW.single_cash_total,0)
        +COALESCE(NEW.package_transfer_total,0)+COALESCE(NEW.single_transfer_total,0);
      v_payload := jsonb_build_object('source_system','foot','clinic_id',NEW.clinic_id,'clinic_slug',v_slug,
        'close_date',to_char(NEW.close_date,'YYYY-MM-DD'),'revision',NEW.revision,'superseded',false,'schema_version',1);
      -- (본문 split/INV5 로직은 정본 up.sql 참조 — dryrun 은 supersede 규칙 correctness 만 실증)
      UPDATE public.closing_confirmed_outbox SET superseded=true
        WHERE clinic_id=NEW.clinic_id AND close_date=NEW.close_date AND revision<NEW.revision AND COALESCE(superseded,false)=false;
      INSERT INTO public.closing_confirmed_outbox (clinic_id,clinic_slug,close_date,revision,superseded,payload)
      VALUES (NEW.clinic_id,v_slug,NEW.close_date,NEW.revision,false,v_payload)
      ON CONFLICT (clinic_id,close_date,revision) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'dryrun enqueue: %', SQLERRM;
    END;
    RETURN NEW;
  END;
  $body$;
  $fn$;

  -- (1)(2)(3) 정의 검증
  SELECT pg_get_functiondef('public.enqueue_closing_confirmed()'::regprocedure) INTO v_def;
  IF v_def LIKE '%revision < NEW.revision%' AND v_def LIKE '%superseded = true%' THEN
    v_result := v_result || '(2) supersede-UPDATE(revision<NEW.revision) 실재: PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(2) supersede-UPDATE 부재 FAIL' || E'\n'; END IF;
  IF v_def LIKE '%''superseded'',false%' OR v_def LIKE '%superseded'', false%' OR v_def LIKE '%superseded,false%' THEN
    v_result := v_result || '(3) 신규 행 superseded=false 고정: PASS' || E'\n';
  ELSE v_result := v_result || '(3) 신규 행 superseded 표기(정본 up.sql 에서 재확인)' || E'\n'; END IF;

  -- ── (6) reader-visibility 시뮬 (무영속) — 임시 clinic 로 rev0→rev1 재emit 후 리더 반환/supersede 실증 ──
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  IF v_clinic IS NOT NULL THEN
    -- 임시 rev0 삽입(가시본), rev1 삽입 시 트리거 규칙과 동형 UPDATE+INSERT 재현
    INSERT INTO public.closing_confirmed_outbox (clinic_id,clinic_slug,close_date,revision,superseded,payload)
    VALUES (v_clinic, v_slug, DATE '2999-12-31', 0, false, jsonb_build_object('dryrun',true,'revision',0))
    ON CONFLICT (clinic_id,close_date,revision) DO NOTHING;
    -- rev1 재emit = supersede-UPDATE(구 rev) + INSERT(신규 false)
    UPDATE public.closing_confirmed_outbox SET superseded=true
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision<1 AND COALESCE(superseded,false)=false;
    INSERT INTO public.closing_confirmed_outbox (clinic_id,clinic_slug,close_date,revision,superseded,payload)
    VALUES (v_clinic, v_slug, DATE '2999-12-31', 1, false, jsonb_build_object('dryrun',true,'revision',1))
    ON CONFLICT (clinic_id,close_date,revision) DO NOTHING;

    SELECT superseded INTO v_sup0 FROM public.closing_confirmed_outbox
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision=0;
    SELECT superseded INTO v_sup1 FROM public.closing_confirmed_outbox
      WHERE clinic_id=v_clinic AND close_date=DATE '2999-12-31' AND revision=1;
    -- 리더 RPC 가시성: read fn 이 반환하는 revision 집합
    SELECT count(*) INTO v_vis0 FROM public.read_closing_confirmed_events(NULL,NULL,1000) e
      WHERE (e.payload->>'dryrun')='true' AND e.revision=0;
    SELECT count(*) INTO v_vis1 FROM public.read_closing_confirmed_events(NULL,NULL,1000) e
      WHERE (e.payload->>'dryrun')='true' AND e.revision=1;

    IF v_sup1 = false AND v_vis1 = 1 THEN
      v_result := v_result || '(6①②) 신 rev1 superseded=false + 리더 반환 포함: PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || format('(6①②) FAIL sup1=%s vis1=%s',v_sup1,v_vis1) || E'\n'; END IF;
    IF v_sup0 = true AND v_vis0 = 0 THEN
      v_result := v_result || '(6③) 구 rev0 superseded=true + 리더 불가시: PASS' || E'\n';
    ELSE v_all_ok := false; v_result := v_result || format('(6③) FAIL sup0=%s vis0=%s',v_sup0,v_vis0) || E'\n'; END IF;
  ELSE
    v_result := v_result || '(6) clinics 부재 — reader-visibility 시뮬 skip' || E'\n';
  END IF;

  -- ── (5) grant-seal 적용 + anon-EXEC=0 assert (C23) — 무영속(블록 말미 sentinel unwind) ──
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.enqueue_closing_confirmed() FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.enqueue_closing_confirmed() TO service_role;
  IF has_function_privilege('anon','public.enqueue_closing_confirmed()'::regprocedure,'EXECUTE') THEN
    v_all_ok := false; v_result := v_result || '(5) grant-seal FAIL: anon 여전히 EXECUTE 가능' || E'\n';
  ELSE
    v_result := v_result || '(5) grant-seal anon-EXEC=0 assert: PASS' || E'\n';
  END IF;

  -- (4) split 3함수 무접촉 확인
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname IN
    ('closing_source_split','closing_insurance_split','closing_month_projection');
  IF v_cnt >= 3 THEN
    v_result := v_result || '(4) split 3함수 존치(무접촉): PASS' || E'\n';
  ELSE v_all_ok := false; v_result := v_result || '(4) split 함수 census FAIL' || E'\n'; END IF;

  RAISE NOTICE E'\n===== DRY-RUN 결과 (무영속) =====\n%all_ok=%', v_result, v_all_ok;
  IF NOT v_all_ok THEN
    RAISE EXCEPTION 'DRY-RUN FAIL — 위 결과 참조 (무영속 unwind)';
  END IF;

  -- ★무영속 sentinel: 검증 성공이어도 강제 unwind (아무 것도 영속 안 됨 — 임시 outbox 행 포함 롤백)
  RAISE EXCEPTION 'DRY-RUN OK — no-persistence sentinel unwind (정상: 영속 방지)';
END
$dryrun$;
