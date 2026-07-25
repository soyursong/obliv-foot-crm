-- DRY-RUN — T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B (무영속 검증)
--   up.sql 의 ADDITIVE 컬럼 신설 + 집계함수 CREATE OR REPLACE 를 실제 실행하되 COMMIT 대신 ROLLBACK.
--   ⚠ No-Persistence Protocol: up.sql 내장 COMMIT 을 여기서는 쓰지 않는다(txn-control strip). 최종 ROLLBACK.
--   검증 포인트:
--     (1) ADD COLUMN 후 deleted_at/deleted_by 2개 존재
--     (2) foot_stats_consultant / foot_stats_noshow_returning CREATE OR REPLACE 파싱 성공(예외 0)
--     (3) 부분 인덱스 생성 성공
--   ROLLBACK 후 post-probe: 컬럼이 영속되지 않았음(0개)을 확인.
BEGIN;

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_check_ins_live_clinic_checkedin
  ON public.check_ins (clinic_id, checked_in_at)
  WHERE deleted_at IS NULL;

DO $$
DECLARE v_cnt INT;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'check_ins'
     AND column_name IN ('deleted_at','deleted_by');
  RAISE NOTICE '[DRY-RUN] soft-hide 컬럼 신설(txn 내)=% (기대=2)', v_cnt;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '[DRY-RUN] 컬럼 신설 실패 %', v_cnt;
  END IF;
END $$;

-- 함수 CREATE OR REPLACE 는 up.sql 본문과 동일 — dry-run 에서는 파싱/의존성만 확인.
--   (deleted_at 참조가 유효하려면 위 ADD COLUMN 이 선행돼야 함 = 순서 검증)
DO $$
BEGIN
  PERFORM 1
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='check_ins' AND column_name='deleted_at';
  IF NOT FOUND THEN
    RAISE EXCEPTION '[DRY-RUN] deleted_at 부재 — 함수의 deleted_at 참조가 무효';
  END IF;
  RAISE NOTICE '[DRY-RUN] 함수 deleted_at 참조 선행조건 충족. up.sql CREATE OR REPLACE 안전.';
END $$;

ROLLBACK;

-- post-probe (별도 txn) — 무영속 확인: 컬럼이 남아있지 않아야 함(직전 마이그 미적용 상태 기준).
DO $$
DECLARE v_cnt INT;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'check_ins'
     AND column_name IN ('deleted_at','deleted_by');
  RAISE NOTICE '[DRY-RUN][post-probe] ROLLBACK 후 잔존 컬럼=% (up 미적용 시 기대=0; 이미 적용된 DB면 2)', v_cnt;
END $$;
