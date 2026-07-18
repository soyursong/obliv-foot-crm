-- DRY-RUN (No-Persistence): T-20260702-foot-PROGRESS-CSV-BULKRESULT (progress_result_images + progress-results 버킷)
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(COMMIT)을 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · txn 내부 assertion(DO $chk$): 테이블 실존 + 컬럼 셋 + 멱등 UNIQUE + RLS 활성 + 정책 3종 + CHECK 제약 + 버킷 실존 검증.
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)의 별 트랜잭션에서
--     to_regclass 부재 재확인(assertAbsent). 본 파일은 in-txn 검증 companion.
BEGIN;

-- ── up.sql 본문 (COMMIT 제거) ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES
  ('progress-results', 'progress-results', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "progress_results_admin_all" ON storage.objects;
CREATE POLICY "progress_results_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'progress-results' AND public.is_admin_or_manager())
  WITH CHECK (bucket_id = 'progress-results' AND public.is_admin_or_manager());

CREATE TABLE IF NOT EXISTS public.progress_result_images (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES public.clinics(id),
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  chart_no     text        NOT NULL,
  visit_date   date        NOT NULL,
  image_url    text        NOT NULL,
  file_name    text        NOT NULL,
  content_hash text        NOT NULL,
  matched_by   text        NOT NULL DEFAULT 'auto' CHECK (matched_by IN ('auto','manual')),
  match_status text        NOT NULL DEFAULT 'auto' CHECK (match_status IN ('auto','manual','flagged')),
  uploaded_by  uuid        REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  note         text,
  CONSTRAINT progress_result_images_idem_uq UNIQUE (clinic_id, chart_no, visit_date, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_pri_customer ON public.progress_result_images(customer_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_pri_clinic   ON public.progress_result_images(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pri_chart    ON public.progress_result_images(clinic_id, chart_no, visit_date);
ALTER TABLE public.progress_result_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pri_admin_select" ON public.progress_result_images;
CREATE POLICY "pri_admin_select" ON public.progress_result_images
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager());
DROP POLICY IF EXISTS "pri_admin_insert" ON public.progress_result_images;
CREATE POLICY "pri_admin_insert" ON public.progress_result_images
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager());
DROP POLICY IF EXISTS "pri_own_delete" ON public.progress_result_images;
CREATE POLICY "pri_own_delete" ON public.progress_result_images
  FOR DELETE TO authenticated
  USING (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager() AND uploaded_by = auth.uid());

-- ── in-txn assertion ────────────────────────────────────────────────
DO $chk$
DECLARE
  v_cols int;
  v_uq   int;
  v_rls  bool;
  v_pol  int;
  v_chk  int;
  v_buck int;
BEGIN
  IF to_regclass('public.progress_result_images') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 테이블 미생성';
  END IF;

  SELECT count(*) INTO v_cols FROM information_schema.columns
    WHERE table_schema='public' AND table_name='progress_result_images'
      AND column_name IN ('id','clinic_id','customer_id','chart_no','visit_date','image_url',
                          'file_name','content_hash','matched_by','match_status','uploaded_by','uploaded_at','note');
  IF v_cols <> 13 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 컬럼 셋 불일치 (got %)', v_cols; END IF;

  SELECT count(*) INTO v_uq FROM pg_constraint
    WHERE conrelid='public.progress_result_images'::regclass AND contype='u';
  IF v_uq < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 멱등 UNIQUE 제약 부재'; END IF;

  SELECT count(*) INTO v_chk FROM pg_constraint
    WHERE conrelid='public.progress_result_images'::regclass AND contype='c';
  IF v_chk < 2 THEN RAISE EXCEPTION 'DRYRUN-FAIL: CHECK 제약(matched_by/match_status) 부재 (got %)', v_chk; END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid='public.progress_result_images'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'DRYRUN-FAIL: RLS 미활성'; END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
    WHERE schemaname='public' AND tablename='progress_result_images';
  IF v_pol <> 3 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 정책 3종 아님 (got %)', v_pol; END IF;

  SELECT count(*) INTO v_buck FROM storage.buckets WHERE id='progress-results' AND public=false;
  IF v_buck <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: private 버킷 미생성 (got %)', v_buck; END IF;

  RAISE NOTICE 'DRYRUN-OK: progress_result_images 13컬럼 + 멱등UNIQUE + CHECK2 + RLS + 정책3종 + private버킷 검증 통과';
END
$chk$;

ROLLBACK;
