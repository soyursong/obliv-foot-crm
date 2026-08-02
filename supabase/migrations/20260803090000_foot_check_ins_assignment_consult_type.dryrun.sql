-- DRYRUN (no-persistence): T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN
--   목적: up.sql 전제(check_ins 실재) 검증 + ADDITIVE 안전성(신설 컬럼/제약 미충돌) 무영속 확인.
--   Migration Dry-Run No-Persistence Protocol 준수: COMMIT 없음 · 순수 SELECT/RAISE · DDL 미영속.
--   실행: psql -f 이 파일. 전제 위반 시 EXCEPTION. 영속 0.

DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  -- ── 1) 대상 테이블 실재 ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='check_ins') THEN
    v_missing := v_missing || ' public.check_ins(테이블 부재)';
  END IF;

  -- ── 2) 신설 컬럼/제약은 아직 없어야(멱등 재실행이면 존재 허용, 무해) ──
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='check_ins'
               AND column_name='assignment_consult_type') THEN
    RAISE NOTICE 'INFO: check_ins.assignment_consult_type 이미 존재 — 멱등 재실행(ADD COLUMN IF NOT EXISTS 무해)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname='chk_check_ins_assignment_consult_type') THEN
    RAISE NOTICE 'INFO: chk_check_ins_assignment_consult_type 이미 존재 — DO 가드 무해';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — up.sql 전제 스키마 부재:%', v_missing;
  END IF;

  RAISE NOTICE 'DRYRUN PASS (no-persistence): check_ins 실재. ADDITIVE 컬럼+CHECK 적용 안전(default NULL·백필 0·기존 reader 무영향). 영속 0.';
END $$;
