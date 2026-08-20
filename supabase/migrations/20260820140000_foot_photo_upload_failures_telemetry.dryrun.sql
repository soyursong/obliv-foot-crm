-- DRY-RUN (No-Persistence): T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · UP.sql 은 COMMIT(txn-control)을 포함 = sentinel-bypass hazard → 본 dry-run 은 COMMIT 을 strip 하고
--     BEGIN..ROLLBACK 로 감싸 무영속 보장. txn 내부 assertion 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 테이블 부재 재확인.
--   · CREATE TABLE/CREATE POLICY 는 트랜잭션 내 완전가역 → ROLLBACK 시 prod 에 아무 것도 남지 않음.
BEGIN;

-- PREFLIGHT (helper 실재)
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: current_user_clinic_id() 부재';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: is_admin_or_manager() 부재';
  END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.photo_upload_failures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  clinic_id       UUID,
  bucket          TEXT        NOT NULL,
  path_prefix     TEXT,
  file_size_bytes BIGINT,
  http_status     INTEGER,
  error_code      TEXT,
  duration_ms     INTEGER,
  retry_attempt   INTEGER     NOT NULL DEFAULT 0,
  created_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_failures_created_at
  ON public.photo_upload_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_upload_failures_bucket_created
  ON public.photo_upload_failures(bucket, created_at DESC);

REVOKE ALL ON public.photo_upload_failures FROM PUBLIC;
REVOKE ALL ON public.photo_upload_failures FROM anon;
GRANT SELECT, INSERT ON public.photo_upload_failures TO authenticated;

ALTER TABLE public.photo_upload_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_upload_failures_insert ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_insert ON public.photo_upload_failures
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS photo_upload_failures_select ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_select ON public.photo_upload_failures
  FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());

DROP POLICY IF EXISTS photo_upload_failures_anon_deny ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_anon_deny ON public.photo_upload_failures
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- assertion: 테이블 + RLS + 3정책 착지 + PHI 컬럼 부재
DO $chk$
DECLARE
  v_cols     text[];
  v_pol      int;
  v_phi      int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='photo_upload_failures') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 테이블 미생성';
  END IF;

  SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname='public'
    AND tablename='photo_upload_failures'
    AND policyname IN ('photo_upload_failures_insert','photo_upload_failures_select','photo_upload_failures_anon_deny');
  IF v_pol <> 3 THEN RAISE EXCEPTION 'DRYRUN-FAIL: RLS 정책 3건 미착지 (count=%)', v_pol; END IF;

  -- PHI-free 스키마 가드: 환자 식별 컬럼이 스키마에 존재하면 실패
  SELECT count(*) INTO v_phi FROM information_schema.columns
    WHERE table_schema='public' AND table_name='photo_upload_failures'
      AND column_name IN ('customer_id','patient_id','customer_name','chart_number','file_name','filename','original_filename','full_path','storage_path');
  IF v_phi <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: PHI/식별 컬럼이 스키마에 존재 (count=%) — PHI-free 위반', v_phi;
  END IF;

  RAISE NOTICE 'DRYRUN OK: 테이블+RLS 3정책 착지 + PHI 컬럼 0 (무영속 ROLLBACK 예정).';
END $chk$;

ROLLBACK;

-- post-probe (runner 별 트랜잭션 · dry-run 후 prod 부재 재확인):
--   SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name='photo_upload_failures';  -- 기대: 0 (무영속)
