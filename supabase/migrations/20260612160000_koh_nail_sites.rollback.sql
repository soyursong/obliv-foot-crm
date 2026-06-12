-- ============================================================
-- ROLLBACK: T-20260612-foot-KOH-REPORT-PHASE15 (A-1) koh_nail_sites
-- ============================================================
-- RPC DROP + 컬럼 DROP. 데이터(발톱부위 입력분) 손실 — 의도된 복귀.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS set_koh_nail_sites(uuid, jsonb);

ALTER TABLE check_in_services DROP COLUMN IF EXISTS koh_nail_sites;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='check_in_services' AND column_name='koh_nail_sites'
  ) THEN RAISE EXCEPTION 'koh_nail_sites 컬럼 DROP 실패'; END IF;
  RAISE NOTICE 'T-20260612-foot-KOH-REPORT-PHASE15 rollback: 컬럼+RPC 제거 완료';
END $$;

COMMIT;
