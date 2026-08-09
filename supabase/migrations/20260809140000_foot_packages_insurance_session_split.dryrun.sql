-- DRY-RUN (무영속): T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2
--   Migration Dry-Run No-Persistence Protocol 준수.
--   foot = Management API PAT 보유 → 무영속 검증 = plpgsql DO 블록 안에서 forward(ADD COLUMN×2 + ADD
--     CONSTRAINT) 실행 후 RAISE EXCEPTION 으로 전체 롤백(DO 블록 트랜잭션 abort) → 영속 0.
--     in-txn 관측값은 예외 메시지로 회수.
--   그 후 post-probe 로 prod 에 두 컬럼이 여전히 부재(비영속)임을 fresh 쿼리로 실측(INV-3).
--   (INV-1 txn-control strip: 본 검증은 forward 파일의 top-level BEGIN;/COMMIT; 를 사용하지 않고
--    DO 블록 단일-statement 로 실행 → 조기 COMMIT sentinel-bypass 원천 부재.)
--   실 러너: db-gate/T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2_dryrun.mjs (supervisor DB-GATE 실행)
--
-- 검증 시나리오:
--   A. 적용 중(in-txn, DO 블록 내): packages 에 covered_sessions·noncovered_sessions 컬럼 존재(count=2).
--   B. RAISE EXCEPTION 롤백 후(post-probe): 두 컬럼 count=0 (비영속 실증).
--   C. NOT VALID partial CHECK 정의 유효 — 기존 행(둘 다 NULL) 위반 0 (in-txn count=0 검증).
--   D. schema_migrations 원장에 20260809140000 부재(미적용 상태 유지).
--
-- ▼ 무영속 재현 SQL(단일 DO statement, RAISE EXCEPTION 자동 롤백). 실 PASS 판정은 러너가 수행.

DO $$
DECLARE
  v_col_cnt   int;
  v_violators int;
BEGIN
  -- forward 적용(in-txn)
  ALTER TABLE public.packages
    ADD COLUMN IF NOT EXISTS covered_sessions    INTEGER,
    ADD COLUMN IF NOT EXISTS noncovered_sessions INTEGER;

  ALTER TABLE public.packages
    ADD CONSTRAINT packages_insurance_split_sum_chk
    CHECK (
      covered_sessions IS NULL
      OR noncovered_sessions IS NULL
      OR covered_sessions + noncovered_sessions = total_sessions
    ) NOT VALID;

  -- (TEST A) in-txn 컬럼 존재 확인
  SELECT count(*) INTO v_col_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'packages'
     AND column_name IN ('covered_sessions', 'noncovered_sessions');

  -- (TEST C) 기존 행 중 CHECK 위반(둘 다 NULL 이므로 0 이어야 함)
  SELECT count(*) INTO v_violators
    FROM public.packages
   WHERE covered_sessions IS NOT NULL
     AND noncovered_sessions IS NOT NULL
     AND covered_sessions + noncovered_sessions <> total_sessions;

  -- 강제 롤백 → 무영속 보장. in-txn 관측값 예외 메시지로 회수.
  RAISE EXCEPTION 'DRYRUN_NOPERSIST col_cnt=% (expect 2) violators=% (expect 0)', v_col_cnt, v_violators;
END $$;

-- (TEST B) 위 예외로 ALTER 롤백됨. 아래 fresh 쿼리로 두 컬럼 부재(count=0) 실측(러너 post-probe).
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='packages'
--     AND column_name IN ('covered_sessions','noncovered_sessions');   -- expect 0

-- (TEST D) SELECT ... FROM supabase_migrations.schema_migrations WHERE version='20260809140000' → 0행(미적용).
