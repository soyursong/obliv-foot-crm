-- DRYRUN (no-persistence): T-20260818-foot-STATS-PERIOD-QUERY-INDEX-AGGRPC-DBHARDEN
--
--   ★ CONCURRENTLY 제약: CREATE INDEX CONCURRENTLY 는 BEGIN..ROLLBACK 단일 txn 안에서 실행 불가.
--     따라서 표준 "BEGIN..ROLLBACK 무영속" 프로토콜로 인덱스 생성 자체를 dry-run 할 수 없다.
--     DA-20260819 Q3 대안1 지침대로 dry-run = (1) 전제 실재/컬럼 preflight + (2) baseline EXPLAIN
--     (현행 순차스캔 plan 캡처) 로 무영속 검증한다. 본 파일은 DDL 0(read-only EXPLAIN·SELECT만)
--     → 영속 0 이 inherent(sentinel-bypass hazard 없음). belt-and-suspenders 로 BEGIN..ROLLBACK 로 감쌈.
--   실행: psql -f 이 파일 (prod). 'DRYRUN OK' NOTICE 확인 후 ROLLBACK → 영속 0.
--   apply 후 실제 index-scan 전환 evidence(AC-2) = up.sql POSTCHECK + EXPLAIN(ANALYZE), supervisor GO-token 이후.

BEGIN;

-- ── 1) 전제: base 테이블/컬럼/원장 실재 (up.sql preflight 등가) ──
DO $$
DECLARE v_missing text := '';
BEGIN
  IF to_regclass('public.reservations') IS NULL THEN v_missing := v_missing || ' public.reservations'; END IF;
  IF to_regclass('public.check_ins')    IS NULL THEN v_missing := v_missing || ' public.check_ins'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='reservations' AND column_name='clinic_id') THEN
    v_missing := v_missing || ' reservations.clinic_id'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='reservations' AND column_name='created_at') THEN
    v_missing := v_missing || ' reservations.created_at'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='reservations' AND column_name='reservation_date') THEN
    v_missing := v_missing || ' reservations.reservation_date'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='check_ins' AND column_name='clinic_id') THEN
    v_missing := v_missing || ' check_ins.clinic_id'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='check_ins' AND column_name='created_date') THEN
    v_missing := v_missing || ' check_ins.created_date'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='check_ins' AND column_name='deleted_at') THEN
    v_missing := v_missing || ' check_ins.deleted_at'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_missing := v_missing || ' supabase_migrations.schema_migrations(ledger)'; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing;
  END IF;
  RAISE NOTICE 'DRYRUN OK — 전제 충족(base 테이블/컬럼/원장 실재).';
END $$;

-- ── 2) 인덱스명 collision(기존 valid 동명) 없음 확인 (재시도 아닌 초기 적용 전제) ──
DO $$
DECLARE v_exists int;
BEGIN
  SELECT count(*) INTO v_exists FROM pg_indexes
  WHERE schemaname='public'
    AND indexname IN ('idx_foot_reservations_clinic_created_at',
                      'idx_foot_reservations_clinic_resv_date',
                      'idx_foot_check_ins_clinic_created_date');
  RAISE NOTICE 'DRYRUN — 동명 인덱스 선재 개수=% (0=초기적용 / >0=멱등 재적용 or INVALID 잔류, up.sql §0 재시도룰 처리).', v_exists;
END $$;

-- ── 3) baseline EXPLAIN (현행 plan 캡처 — 인덱스 미적용 상태 순차스캔 확인) ──
--   ※ EXPLAIN(ANALYZE 없음) = plan 컴파일만·실행 0·영속 0. 실제 clinic_id 는 러너가 치환.
--   apply 후 동일 쿼리 EXPLAIN(ANALYZE) 에서 Index Scan 전환 = AC-2 evidence.
DO $$
DECLARE v_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_clinic FROM public.reservations
   WHERE clinic_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF v_clinic IS NULL THEN
    RAISE NOTICE 'DRYRUN — baseline EXPLAIN skip(reservations clinic_id 표본 없음). 전제검증만으로 무영속 PASS.';
  ELSE
    RAISE NOTICE 'DRYRUN — baseline EXPLAIN 대상 clinic_id=% (아래 EXPLAIN 3건 수동/러너 실행 권장).', v_clinic;
  END IF;
END $$;

-- (러너/수동) 아래 3건은 실 clinic_id 로 치환해 EXPLAIN 실행, 현행 Seq Scan 확인:
--   EXPLAIN SELECT id FROM public.reservations
--     WHERE clinic_id='<uuid>' AND created_at >= '2026-07-01T00:00:00+09:00' AND created_at <= '2026-08-18T23:59:59+09:00';
--   EXPLAIN SELECT id FROM public.reservations
--     WHERE clinic_id='<uuid>' AND reservation_date >= '2026-07-01' AND reservation_date <= '2026-08-18';
--   EXPLAIN SELECT id FROM public.check_ins
--     WHERE clinic_id='<uuid>' AND deleted_at IS NULL AND status != 'cancelled'
--       AND created_date >= '2026-07-01' AND created_date <= '2026-08-18';

-- 무영속 보장: DDL 0 + 명시 ROLLBACK 로 전량 폐기.
ROLLBACK;

-- 사후 무영속 확인(러너, 별 세션):
--   SELECT count(*) FROM pg_indexes WHERE schemaname='public'
--     AND indexname IN ('idx_foot_reservations_clinic_created_at',
--                       'idx_foot_reservations_clinic_resv_date',
--                       'idx_foot_check_ins_clinic_created_date');  -- expect 0 (미영속)
