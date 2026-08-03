-- DRYRUN (no-persistence): T-20260803-foot-RXSET-VERIFY-CACHE-AC3
--   목적: up.sql 전제(prescription_codes 실재) 검증 + ADDITIVE 안전성(신설 6컬럼 미충돌) 무영속 확인.
--   Migration Dry-Run No-Persistence Protocol 준수: COMMIT 없음 · 순수 SELECT/RAISE · DDL 미영속.
--   실행: psql -f 이 파일. 전제 위반 시 EXCEPTION. 영속 0.

DO $$
DECLARE
  v_missing TEXT := '';
  c TEXT;
BEGIN
  -- ── 1) 대상 테이블 실재 ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='prescription_codes') THEN
    v_missing := v_missing || ' public.prescription_codes(테이블 부재)';
  END IF;

  -- ── 2) 신설 6컬럼은 아직 없어야(멱등 재실행이면 존재 허용, ADD COLUMN IF NOT EXISTS 무해) ──
  FOREACH c IN ARRAY ARRAY['verify_status','verify_ingredient','verify_matched_code',
                           'verified_at','verify_input_hash','verify_model_version'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='prescription_codes' AND column_name=c) THEN
      RAISE NOTICE 'INFO: prescription_codes.% 이미 존재 — 멱등 재실행(ADD COLUMN IF NOT EXISTS 무해)', c;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — up.sql 전제 스키마 부재:%', v_missing;
  END IF;

  RAISE NOTICE 'DRYRUN OK — prescription_codes 실재, verify_* 6컬럼 ADDITIVE 안전(무영속). up 적용 가능.';
END $$;
