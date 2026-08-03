-- DRYRUN (no-persistence): T-20260803-foot-REDPAY-NOTXN-SCAN-3STATE-MODEB-PERSIST
--   목적: up.sql 의 전제(신규객체 미존재 or 멱등 재실행 무해 · user_profiles/ledger 실재 · gen_random_uuid)
--         + up.sql 의 DDL·RPC·멱등 upsert·auto-resolve·CHECK 불변식을 prod 무영속 검증.
--   Migration Dry-Run No-Persistence Protocol 준수: 전 구간 단일 txn BEGIN..ROLLBACK, 영속 0.
--     · txn-control 문(COMMIT) 부재 → sentinel-bypass hazard 없음.
--     · 마지막 RAISE EXCEPTION 으로 강제 롤백(성공 경로에서도 무영속 보장).
--   실행: psql -f 이 파일 (prod). "DRYRUN OK" NOTICE 전부 뜬 뒤 'DRYRUN_ROLLBACK' EXCEPTION 으로 abort → 영속 0.

BEGIN;

DO $$
DECLARE
  v_missing TEXT := '';
  v_res     jsonb;
  v_id1     uuid;
  v_open_ct int;
  v_all_ct  int;
BEGIN
  -- ── 1) 전제: 의존객체 실재 ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='user_profiles') THEN
    v_missing := v_missing || ' public.user_profiles(RLS 정책 의존)';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_missing := v_missing || ' supabase_migrations.schema_migrations(ledger)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') THEN
    v_missing := v_missing || ' gen_random_uuid(pgcrypto)';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing;
  END IF;

  -- ── 2) 신규객체는 아직 없어야(멱등 재실행이면 존재 허용) ──
  IF to_regclass('public.redpay_ingestion_gap_log') IS NOT NULL THEN
    RAISE NOTICE 'INFO: redpay_ingestion_gap_log 이미 존재 — 멱등 재실행(CREATE IF NOT EXISTS 무해)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='fn_redpay_ingestion_gap_persist') THEN
    RAISE NOTICE 'INFO: fn_redpay_ingestion_gap_persist 이미 존재 — CREATE OR REPLACE 무해';
  END IF;

  -- ── 3) DDL·RPC·불변식 무영속 리허설 (이 txn 안에서 만들고 굴린 뒤 최종 롤백) ──
  CREATE TABLE IF NOT EXISTS public.redpay_ingestion_gap_log (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    domain            text        NOT NULL DEFAULT 'foot',
    merchant_id       text        NOT NULL,
    band              text,
    business_date     date        NOT NULL,
    gap_kind          text        NOT NULL,
    delta_count       integer     NOT NULL,
    net_amount        bigint,
    detection_count   integer     NOT NULL DEFAULT 1,
    first_detected_at timestamptz NOT NULL DEFAULT now(),
    last_detected_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at       timestamptz,
    resolution        text,
    resolution_note   text,
    CONSTRAINT redpay_ingestion_gap_log_gap_kind_chk       CHECK (gap_kind IN ('delta1_under_ingestion')),
    CONSTRAINT redpay_ingestion_gap_log_open_positive_chk  CHECK (resolved_at IS NOT NULL OR delta_count > 0),
    CONSTRAINT redpay_ingestion_gap_log_resolution_chk     CHECK (resolved_at IS NULL OR resolution IS NOT NULL)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_redpay_gap_open
    ON public.redpay_ingestion_gap_log (merchant_id, business_date, gap_kind) WHERE resolved_at IS NULL;

  -- 불변식 A: CHECK — open 행 delta_count<=0 은 거부되어야
  BEGIN
    INSERT INTO public.redpay_ingestion_gap_log (merchant_id, business_date, gap_kind, delta_count)
    VALUES ('1777289012','2026-07-22','delta1_under_ingestion', 0);
    RAISE EXCEPTION 'DRYRUN FAIL — open delta_count<=0 이 CHECK 를 통과함(불변식 위반)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'DRYRUN OK — open delta_count<=0 CHECK 거부 확인';
  END;

  -- 불변식 B: RPC persist → INSERT(open 1행)
  CREATE OR REPLACE FUNCTION public.fn_redpay_ingestion_gap_persist(
    p_merchant_id text, p_business_date date, p_delta_count integer,
    p_net_amount bigint DEFAULT NULL, p_band text DEFAULT NULL, p_domain text DEFAULT 'foot',
    p_gap_kind text DEFAULT 'delta1_under_ingestion', p_mode text DEFAULT 'persist'
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE v_affected int:=0; v_id uuid; v_dc int; v_is_insert boolean:=false;
  BEGIN
    IF p_mode='resolve' THEN
      UPDATE public.redpay_ingestion_gap_log
         SET resolved_at=now(), resolution='auto_ingested', last_detected_at=now(),
             delta_count=0, net_amount=COALESCE(p_net_amount,net_amount)
       WHERE merchant_id=p_merchant_id AND business_date=p_business_date
         AND gap_kind=p_gap_kind AND resolved_at IS NULL
       RETURNING id, detection_count INTO v_id, v_dc;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RETURN jsonb_build_object('action', CASE WHEN v_affected>0 THEN 'auto_resolved' ELSE 'noop_no_open' END,
                                'gap_id',v_id,'affected',v_affected,'detection_count',v_dc,'resolved',v_affected>0);
    END IF;
    IF COALESCE(p_delta_count,0)<=0 THEN RAISE EXCEPTION 'persist requires positive delta_count; got %', p_delta_count; END IF;
    INSERT INTO public.redpay_ingestion_gap_log (domain,merchant_id,band,business_date,gap_kind,delta_count,net_amount)
    VALUES (COALESCE(p_domain,'foot'),p_merchant_id,p_band,p_business_date,p_gap_kind,p_delta_count,p_net_amount)
    ON CONFLICT (merchant_id,business_date,gap_kind) WHERE resolved_at IS NULL
    DO UPDATE SET last_detected_at=now(), detection_count=public.redpay_ingestion_gap_log.detection_count+1,
                  delta_count=EXCLUDED.delta_count, net_amount=EXCLUDED.net_amount,
                  band=COALESCE(EXCLUDED.band, public.redpay_ingestion_gap_log.band)
    RETURNING id, detection_count, (xmax=0) INTO v_id, v_dc, v_is_insert;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN jsonb_build_object('action', CASE WHEN v_is_insert THEN 'inserted' ELSE 'updated' END,
                              'gap_id',v_id,'affected',v_affected,'detection_count',v_dc,'resolved',false);
  END; $fn$;

  v_res := public.fn_redpay_ingestion_gap_persist('1777289012','2026-07-22', 5, 8700000, '1777289','foot','delta1_under_ingestion','persist');
  IF (v_res->>'action')<>'inserted' OR (v_res->>'affected')::int<1 THEN
    RAISE EXCEPTION 'DRYRUN FAIL — persist INSERT 결과 이상: %', v_res;
  END IF;
  RAISE NOTICE 'DRYRUN OK — persist INSERT(open 1행): %', v_res;

  -- 불변식 C: 재탐지 upsert → dup INSERT 없이 detection_count++ (멱등)
  v_res := public.fn_redpay_ingestion_gap_persist('1777289012','2026-07-22', 6, 9000000, '1777289','foot','delta1_under_ingestion','persist');
  SELECT count(*) INTO v_open_ct FROM public.redpay_ingestion_gap_log
   WHERE merchant_id='1777289012' AND business_date='2026-07-22' AND resolved_at IS NULL;
  IF (v_res->>'action')<>'updated' OR v_open_ct<>1 OR (v_res->>'detection_count')::int<>2 THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 재탐지 멱등 위반(open_ct=% res=%)', v_open_ct, v_res;
  END IF;
  RAISE NOTICE 'DRYRUN OK — 재탐지 upsert 멱등(open 1행·detection_count=2): %', v_res;

  -- 불변식 D: auto-resolve → open→resolved(auto_ingested)
  v_res := public.fn_redpay_ingestion_gap_persist('1777289012','2026-07-22', 0, 0, NULL,'foot','delta1_under_ingestion','resolve');
  SELECT count(*) INTO v_open_ct FROM public.redpay_ingestion_gap_log
   WHERE merchant_id='1777289012' AND business_date='2026-07-22' AND resolved_at IS NULL;
  IF (v_res->>'action')<>'auto_resolved' OR v_open_ct<>0 THEN
    RAISE EXCEPTION 'DRYRUN FAIL — auto-resolve 위반(open_ct=% res=%)', v_open_ct, v_res;
  END IF;
  RAISE NOTICE 'DRYRUN OK — auto-resolve(open→resolved auto_ingested): %', v_res;

  -- 불변식 E: reopen(resolved 후 재발) → 새 open INSERT(이력 보존, 총 2행)
  v_res := public.fn_redpay_ingestion_gap_persist('1777289012','2026-07-22', 3, 4000000, '1777289','foot','delta1_under_ingestion','persist');
  SELECT count(*) INTO v_all_ct  FROM public.redpay_ingestion_gap_log
   WHERE merchant_id='1777289012' AND business_date='2026-07-22';
  SELECT count(*) INTO v_open_ct FROM public.redpay_ingestion_gap_log
   WHERE merchant_id='1777289012' AND business_date='2026-07-22' AND resolved_at IS NULL;
  IF (v_res->>'action')<>'inserted' OR v_all_ct<>2 OR v_open_ct<>1 THEN
    RAISE EXCEPTION 'DRYRUN FAIL — reopen 위반(all=% open=% res=%)', v_all_ct, v_open_ct, v_res;
  END IF;
  RAISE NOTICE 'DRYRUN OK — reopen(새 open INSERT·이력 보존 총 2행·open 1행): %', v_res;

  -- 불변식 F: resolve no-op(open 없음) → affected 0, noop_no_open
  v_res := public.fn_redpay_ingestion_gap_persist('9999999999','2026-07-22', 0, NULL, NULL,'foot','delta1_under_ingestion','resolve');
  IF (v_res->>'action')<>'noop_no_open' OR (v_res->>'affected')::int<>0 THEN
    RAISE EXCEPTION 'DRYRUN FAIL — resolve no-op 위반: %', v_res;
  END IF;
  RAISE NOTICE 'DRYRUN OK — resolve no-op(open 부재 → affected 0): %', v_res;

  -- 불변식 G: persist delta_count<=0 은 RPC 에서 거부
  BEGIN
    v_res := public.fn_redpay_ingestion_gap_persist('1777289012','2026-07-23', 0, NULL, NULL,'foot','delta1_under_ingestion','persist');
    RAISE EXCEPTION 'DRYRUN FAIL — persist delta_count<=0 이 통과함';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'DRYRUN FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'DRYRUN OK — persist delta_count<=0 거부(%)', SQLERRM;
  END;

  RAISE NOTICE '=== DRYRUN ALL OK — DDL/RPC/멱등/auto-resolve/reopen/CHECK 전건 통과. 강제 롤백으로 무영속 abort. ===';

  -- 강제 롤백(무영속 보장) — 성공 경로에서도 반드시 abort.
  RAISE EXCEPTION 'DRYRUN_ROLLBACK (정상 — 무영속 보장)';
END $$;

ROLLBACK;

-- POST-PROBE (무영속 확증): 이 파일 실행 후 아래가 NULL 이어야(영속 0).
--   SELECT to_regclass('public.redpay_ingestion_gap_log');   -- 기대: NULL (dryrun 이 만든 객체 무영속)
