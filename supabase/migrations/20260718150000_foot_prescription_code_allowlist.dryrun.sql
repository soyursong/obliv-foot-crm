-- DRY-RUN (No-Persistence): T-20260615-foot-RX-WHITELIST-FOLDERTREE (Phase 1 overlay 테이블)
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): 테이블 실존 + 컬럼 셋 + UNIQUE 제약 + RLS 활성 + 정책 2종 검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)의 별 트랜잭션에서
--     to_regclass 부재 재확인(assertAbsent). 본 파일은 in-txn 검증 companion.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescription_code_allowlist (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_slug          text NOT NULL DEFAULT 'jongno-foot',
  prescription_code_id uuid NOT NULL REFERENCES public.prescription_codes(id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT true,
  curated_by           uuid,
  curated_at           timestamptz,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_code_allowlist_uq UNIQUE (clinic_slug, prescription_code_id)
);
ALTER TABLE public.prescription_code_allowlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prescription_code_allowlist_approved_read ON public.prescription_code_allowlist;
CREATE POLICY prescription_code_allowlist_approved_read ON public.prescription_code_allowlist
  FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS prescription_code_allowlist_admin_all ON public.prescription_code_allowlist;
CREATE POLICY prescription_code_allowlist_admin_all ON public.prescription_code_allowlist
  FOR ALL TO authenticated USING (public.is_admin_or_manager()) WITH CHECK (public.is_admin_or_manager());

-- ── in-txn assertion ────────────────────────────────────────────────
DO $chk$
DECLARE
  v_cols int;
  v_uq   int;
  v_rls  bool;
  v_pol  int;
BEGIN
  IF to_regclass('public.prescription_code_allowlist') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 테이블 미생성';
  END IF;

  SELECT count(*) INTO v_cols FROM information_schema.columns
    WHERE table_schema='public' AND table_name='prescription_code_allowlist'
      AND column_name IN ('id','clinic_slug','prescription_code_id','enabled','curated_by','curated_at','note','created_at');
  IF v_cols <> 8 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 컬럼 셋 불일치 (got %)', v_cols; END IF;

  SELECT count(*) INTO v_uq FROM pg_constraint
    WHERE conrelid='public.prescription_code_allowlist'::regclass AND contype='u';
  IF v_uq < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: UNIQUE 제약 부재'; END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid='public.prescription_code_allowlist'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'DRYRUN-FAIL: RLS 미활성'; END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
    WHERE schemaname='public' AND tablename='prescription_code_allowlist';
  IF v_pol <> 2 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 정책 2종 아님 (got %)', v_pol; END IF;

  RAISE NOTICE 'DRYRUN-OK: prescription_code_allowlist 8컬럼 + UNIQUE + RLS + 정책2종 검증 통과';
END
$chk$;

ROLLBACK;
