-- DRYRUN (no-persistence): T-20260818-foot-CUSTMGMT-SEARCH-FAIL
-- ══════════════════════════════════════════════════════════════════
-- 목적: up.sql 전제(pg_trgm 가용 · customers 4컬럼 name/phone/birth_date/chart_number 실재·TEXT ·
--   ledger 실재) + 4컬럼 gin_trgm_ops 인덱스 DDL 유효성(operator class 적용) +
--   ★dispositive 검증: 4-branch OR 술어가 BitmapOr(4 Bitmap Index Scan)로 커버되어
--   Seq Scan 이 소거되는가 (57014 timeout RC 해소 실효 증명) 를 prod 무영속 검증.
--
-- ── CONCURRENTLY dry-run 한계 (Migration Dry-Run No-Persistence Protocol §5) ──
--   `CREATE INDEX CONCURRENTLY` = non-txn DDL → 롤백 봉투로 무영속 검증 불가
--   (dryrun_lib.mjs 검출 시 NON_TXN_DDL_CANNOT_DRYRUN hard-fail). 따라서 본 dry-run 은
--   **동일 정의의 non-concurrent 형(CREATE INDEX, CONCURRENTLY 제거)** 을 무영속 블록에서
--   생성해 (a) DDL/operator-class 유효성 (b) 실 planner 의 OR-branch 커버(BitmapOr)를 증명한다.
--   prod CONCURRENTLY 실적용 = supervisor GO-token 후 apply 스크립트로 검증(index valid=true POSTCHECK).
--   → 본 dry-run 은 "인덱스가 만들어지면 planner 가 4-branch 전부 index-satisfiable 로 쓴다"를
--     실 prod 스키마/데이터 위에서 증명 (CONCURRENTLY 는 잠금전략만 다를 뿐 인덱스 구조 동일).
--
-- ── 무영속 보장 (INV-2 exception-handler backstop) ─────────────────
--   전 구간 단일 DO 블록. 마지막에 RAISE EXCEPTION 'DRYRUN_RESULT…' 로 implicit savepoint 롤백
--   → 생성 인덱스/set_config 전량 폐기(영속 0). Management API 는 이 EXCEPTION 메시지를
--   error 로 반환 → 검증 verdict 를 머신-판독 가능하게 회수. COMMIT 문 0.
--   사후 무영속 introspection(러너, 별 세션):
--     SELECT count(*) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
--       WHERE c.relname LIKE 'idx_customers_%_trgm';   -- expect 0 (미영속)
-- ══════════════════════════════════════════════════════════════════

DO $dryrun$
DECLARE
  v_missing   text := '';
  v_plan      text := '';
  v_rec       record;
  v_seqscan   boolean;
  v_bitmaps   int;
  v_idxcount  int;
  v_query     text := $q$
    SELECT id FROM public.customers
    WHERE name ilike '%김%'
       OR phone ilike '%김%'
       OR birth_date ilike '%김%'
       OR chart_number ilike '%김%'
  $q$;
BEGIN
  -- 1) 전제: 확장·컬럼·타입·원장 실재
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
    -- up.sql 이 CREATE EXTENSION IF NOT EXISTS 로 생성하므로, dry-run 에서도 임시 생성 시도
    BEGIN EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm'; EXCEPTION WHEN OTHERS THEN
      v_missing := v_missing || ' pg_trgm(생성불가)'; END;
  END IF;
  FOR v_rec IN
    SELECT unnest(ARRAY['name','phone','birth_date','chart_number']) AS col
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='customers'
                     AND column_name=v_rec.col AND data_type='text') THEN
      v_missing := v_missing || ' customers.'||v_rec.col||'(TEXT 아님/부재)';
    END IF;
  END LOOP;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_missing := v_missing || ' supabase_migrations.schema_migrations(ledger)';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing;
  END IF;

  -- 2) 4 인덱스 non-concurrent 생성 (DDL/operator-class 유효성 · 무영속: 블록 롤백)
  EXECUTE 'CREATE INDEX idx_customers_name_trgm         ON public.customers USING gin (name gin_trgm_ops)';
  EXECUTE 'CREATE INDEX idx_customers_phone_trgm        ON public.customers USING gin (phone gin_trgm_ops)';
  EXECUTE 'CREATE INDEX idx_customers_birth_date_trgm   ON public.customers USING gin (birth_date gin_trgm_ops)';
  EXECUTE 'CREATE INDEX idx_customers_chart_number_trgm ON public.customers USING gin (chart_number gin_trgm_ops)';
  SELECT count(*) INTO v_idxcount FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
    WHERE c.relname LIKE 'idx_customers_%_trgm';

  -- 3) ★dispositive: seq-scan penalize 후 planner 가 4-branch OR 를 BitmapOr 로 커버하는지
  PERFORM set_config('enable_seqscan','off', true);   -- true=LOCAL(txn 범위, 롤백과 함께 원복)
  FOR v_rec IN EXECUTE 'EXPLAIN (FORMAT TEXT) '||v_query LOOP
    v_plan := v_plan || v_rec."QUERY PLAN" || E'\n';
  END LOOP;
  v_seqscan := position('Seq Scan on customers' in v_plan) > 0;
  v_bitmaps := (length(v_plan) - length(replace(v_plan,'Bitmap Index Scan',''))) / length('Bitmap Index Scan');

  -- 4) verdict 회수 (EXCEPTION → 롤백 = 무영속, Mgmt API 가 메시지 반환)
  RAISE EXCEPTION 'DRYRUN_RESULT | trgm_indexes_created=% (expect 4) | seqscan_on_customers=% (expect f) | bitmap_index_scans=% (expect 4) | PLAN>>> %',
    v_idxcount, v_seqscan, v_bitmaps, v_plan;
END $dryrun$;
