-- ══════════════════════════════════════════════════════════════════
-- T-20260818-foot-STATS-PERIOD-QUERY-INDEX-AGGRPC-DBHARDEN
--   통계 TM집계 탭 기간조회 baseline 구조취약(무인덱스 순차 스캔) durable 정본해소
-- ══════════════════════════════════════════════════════════════════
-- 부모 hotfix: T-20260818-foot-STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT
--   (commit a5a16e73, db_change=false) — hot 집계서 customers PHI embed 제거 +
--   드릴다운 지연조회로 57014 statement timeout 급성 부하비례 완화. baseline 구조취약 잔존.
-- 본 마이그 = 그 잔존 RC(무인덱스 순차 스캔) durable 해소.
--
-- DA CONSULT-REPLY: DA-20260819-foot-STATS-PERIOD-INDEX-AGGRPC (MSG-20260819-004004-diu9)
--   verdict = 조건부 GO / (a) 복합 인덱스가 canonical(RPC 신설은 범위 밖·별건).
--   change-class = ADDITIVE(index-only 신설·신규 컬럼/테이블/enum 0·데이터 write 0·롤백=DROP INDEX).
--   autonomy §3.1 → 대표게이트(CEO) 무대상. supervisor DDL-diff DB-GATE + 물리 GO-token 만 통과.
--
-- ── RC (dev-foot 실측, src/lib/stats.ts fetchTmAggregate L465-535) ──────────
--   기간 내 전 raw 행을 1000/page cursor pagination(.range, 최대 30p)으로 스캔.
--   jongno 17d 3,410행 / 48d 5,554행. 3 쿼리 모두 clinic_id 스코프 + 무인덱스 순차 스캔:
--     (A) 예약등록건수: reservations  WHERE clinic_id=? AND created_at BETWEEN ?..?   (L493-498)
--     (B) 예약수:       reservations  WHERE clinic_id=? AND reservation_date BETWEEN ?..? (L500-504)
--     (C) 내원건수:     check_ins     WHERE clinic_id=? AND deleted_at IS NULL
--                                       AND status != 'cancelled' AND created_date BETWEEN ?..? (L506-512)
--
-- ── 해소: 복합 인덱스 3개 (DA Q2 — 티켓 명시 2개 + (B) 누락분 reservation_date 포함) ─
--   1) reservations (clinic_id, created_at)                      ← (A)
--   2) reservations (clinic_id, reservation_date)                ← (B) [티켓 명시서 누락, DA 포함 확정]
--   3) check_ins (clinic_id, created_date) WHERE deleted_at IS NULL ← (C) 부분 인덱스
--      ※ DA Q4: 부분 predicate 는 deleted_at IS NULL 만. status != 'cancelled' (부등호 술어) 미포함
--        — 옵티마이저 매칭 취약 + 향후 status 값 변경 시 무효화 우려. status 는 커버 행 내 필터.
--
-- ── CONCURRENTLY (DA Q3) ────────────────────────────────────────────────────
--   라이브 write 경로(예약/체크인) 무중단 위해 CREATE INDEX CONCURRENTLY.
--   ★ CONCURRENTLY 는 명시 트랜잭션 블록(BEGIN..COMMIT) 안에서 실행 불가 →
--     본 파일은 outer BEGIN/COMMIT 를 두지 않는다(각 statement autocommit).
--   ★ 재시도 안전(INVALID 인덱스 룰): 선행 CONCURRENTLY 실패 시 INVALID 인덱스가 잔류하면
--     후속 IF NOT EXISTS 가 skip 해 INVALID 상태가 고착 → §0 에서 동명 INVALID 인덱스만
--     선제 DROP(plain, 대상 인덱스 한정 짧은 lock) 후 재생성. 정상(valid) 인덱스는 보존.
--
-- ── ADDITIVE 무접촉 가드 (DA 착수조건) ──────────────────────────────────────
--   쿼리/산식/귀속축/상태필터 불변 — fetchTmAggregate/dedupVisited/tmAttributionKey/tmRoleIds
--   1줄도 수정 없음(FE 무접촉). 옵티마이저 경로만 순차스캔→인덱스스캔 전환(회귀 0).
--   base-table/컬럼/제약/트리거/RLS 무접촉. 롤백 = DROP INDEX(완전 가역, 데이터 0).
--
-- ★ apply 는 supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지).
--   Gate-B(DA) GO ≠ apply 허가.
-- risk: GO_WARN — index-only 신설 3건, 파괴 0.
-- ══════════════════════════════════════════════════════════════════

-- ── 0) 재시도 안전: 동명 INVALID 인덱스 선제 정리 (plain DROP, 대상 한정) ────────
--   선행 CONCURRENTLY 부분실패 잔류분만 제거. valid 인덱스는 건드리지 않음(멱등 재실행 안전).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT i.indisvalid
      AND c.relname IN (
        'idx_foot_reservations_clinic_created_at',
        'idx_foot_reservations_clinic_resv_date',
        'idx_foot_check_ins_clinic_created_date'
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.relname);
    RAISE NOTICE 'STATS-PERIOD-INDEX: dropped INVALID leftover index % (retry-safety).', r.relname;
  END LOOP;
END $$;

-- ── 1) preflight: base 테이블/컬럼 실재 (fail-fast, 인덱스 생성 전 abort) ────────
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
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'STATS-PERIOD-INDEX preflight FAIL — 전제 미충족:%', v_missing;
  END IF;
  RAISE NOTICE 'STATS-PERIOD-INDEX preflight OK — base 테이블/컬럼 실재.';
END $$;

-- ── 2) 복합 인덱스 생성 (CONCURRENTLY · IF NOT EXISTS · autocommit) ─────────────
-- (A) 예약등록건수 축: reservations.created_at 기간 범위조회
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foot_reservations_clinic_created_at
  ON public.reservations (clinic_id, created_at);

-- (B) 예약수 축: reservations.reservation_date 기간 범위조회
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foot_reservations_clinic_resv_date
  ON public.reservations (clinic_id, reservation_date);

-- (C) 내원건수 축: check_ins.created_date 기간 범위조회 (soft-hide 제외 부분 인덱스)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foot_check_ins_clinic_created_date
  ON public.check_ins (clinic_id, created_date)
  WHERE deleted_at IS NULL;

-- ── 3) POSTCHECK: 3 인덱스 실재 + indisvalid=true (부분생성/INVALID abort) ──────
DO $$
DECLARE
  v_names text[] := ARRAY[
    'idx_foot_reservations_clinic_created_at',
    'idx_foot_reservations_clinic_resv_date',
    'idx_foot_check_ins_clinic_created_date'
  ];
  v_name  text;
  v_valid boolean;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT i.indisvalid INTO v_valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname = v_name;

    IF v_valid IS NULL THEN
      RAISE EXCEPTION 'STATS-PERIOD-INDEX POSTCHECK FAIL — 인덱스 부재: %', v_name;
    ELSIF NOT v_valid THEN
      RAISE EXCEPTION 'STATS-PERIOD-INDEX POSTCHECK FAIL — 인덱스 INVALID(CONCURRENTLY 부분실패): % (§0 재시도 룰로 재적용)', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'STATS-PERIOD-INDEX POSTCHECK OK — 3 복합 인덱스 실재 + valid.';
END $$;

-- 검증 쿼리 (apply 후 수동 확인 · AC-2 EXPLAIN evidence):
--   SELECT indexname, indexdef FROM pg_indexes
--     WHERE schemaname='public' AND indexname LIKE 'idx_foot_%'
--       AND indexname IN ('idx_foot_reservations_clinic_created_at',
--                         'idx_foot_reservations_clinic_resv_date',
--                         'idx_foot_check_ins_clinic_created_date');
--   -- AC-2 index scan 전환 확인 (넓은 기간 30일+):
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.reservations
--     WHERE clinic_id = '<jongno-uuid>'
--       AND created_at >= '2026-07-01T00:00:00+09:00' AND created_at <= '2026-08-18T23:59:59+09:00';
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.reservations
--     WHERE clinic_id = '<jongno-uuid>'
--       AND reservation_date >= '2026-07-01' AND reservation_date <= '2026-08-18';
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.check_ins
--     WHERE clinic_id = '<jongno-uuid>' AND deleted_at IS NULL AND status != 'cancelled'
--       AND created_date >= '2026-07-01' AND created_date <= '2026-08-18';
