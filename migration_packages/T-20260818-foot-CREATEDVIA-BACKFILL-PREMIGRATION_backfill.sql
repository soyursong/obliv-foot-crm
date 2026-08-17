-- T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION — created_via 결정론적 부분집합 backfill
-- DA verdict=CONDITIONAL (da_decision_foot_createdvia_backfill_premigration_20260818.md).
-- change-class: 순수 data UPDATE · 스키마 무변 (DDL 0). CHECK 이미 'manual'/'dopamine' 허용.
-- ★ apply-gate = supervisor MIG-GATE + 물리 GO-token 선행 REQUIRED. apply_before_go 금지.
-- ★ per-subset 별 predicate·별 freeze-set — blanket UPDATE fold 금지(DA §E-H3).
-- freeze-set: FS1(dopamine)=1, FS2(manual)=187, total=188. FS3(잔여 12, test-seed)=NULL 무접촉.
-- rollback: T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION_backfill.rollback.sql
-- 멱등: created_via IS NULL 술어로만 fill → 재실행 시 0행(이미 채운 행 재접촉 안 함).

BEGIN;

-- ── FS1: dopamine-marker 결정론 부분집합 (Class R · provenance 복원) ────────────
-- predicate: created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL
-- 기대 freeze-set = 1행 (id 2fb4885d-...; E2E 카나리이나 provenance=dopamine 사실).
DO $$
DECLARE n int;
BEGIN
  UPDATE public.reservations
     SET created_via = 'dopamine', updated_at = now()
   WHERE created_via IS NULL
     AND source_system = 'dopamine'
     AND external_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'FS1 dopamine rows updated = %', n;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FS1 freeze-set 불일치: expected 1, got % → 전체 롤백', n;
  END IF;
END $$;

-- ── FS2: by-construction manual 부분집합 (Class R · pre-mig manual-only 경로공간 실증) ──
-- predicate: created_via IS NULL AND created_at < '2026-06-29 11:09:35.494874+00'
--            AND source_system IS NULL AND external_id IS NULL
-- census 실증: (a) foot 셀프북/키오스크 예약생성 경로 부재(코드 0), (b) dopamine 최초행 2026-07-01(경계 後),
--   (c) source_system 컬럼(2026-05-20~) 존재하나 187행 전부 NULL = 적극적 비-dopamine 증거,
--   (d) external_id/lead_id 전부 NULL → 유일 생성경로 = 스태프 수기(admin) = 'manual'.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.reservations
     SET created_via = 'manual', updated_at = now()
   WHERE created_via IS NULL
     AND created_at < '2026-06-29 11:09:35.494874+00'
     AND source_system IS NULL
     AND external_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'FS2 manual rows updated = %', n;
  IF n <> 187 THEN
    RAISE EXCEPTION 'FS2 freeze-set 불일치: expected 187, got % → 전체 롤백', n;
  END IF;
END $$;

-- ── POSTCHECK(txn 내): 잔여 NULL == 12 (FS3 test-seed 무접촉) 이어야 ──
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM public.reservations WHERE created_via IS NULL;
  RAISE NOTICE 'post-fill 잔여 created_via NULL = % (기대 12)', remaining;
  IF remaining <> 12 THEN
    RAISE EXCEPTION '잔여 NULL 불일치: expected 12, got % → 전체 롤백', remaining;
  END IF;
END $$;

COMMIT;
-- 적용 후 POSTCHECK(별도): 채운 188행만 변경·잔여 12 NULL 무접촉·analytics 오염 0 검증.
