-- DRY-RUN (No-Persistence): T-20260731-foot-FOOTQST-PHOTO-UPLOAD (health_q_photos + foot-health-q-photos 버킷)
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · 본 dryrun 은 up.sql 의 txn-control 문(BEGIN/COMMIT)을 **제거** → 러너의 BEGIN..ROLLBACK 로 무영속.
--   · txn 내부 assertion(DO $chk$): 버킷 private 실존 + 테이블/컬럼 셋 + RLS 활성 + 정책(테이블 select·storage read)
--     + fn 4-arg 시그니처 실존 + fn 3-arg 부재(drop 확인) + anon storage.objects INSERT 정책 부재(DA ②).
--     실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 canonical 러너(scripts/dryrun_lib.mjs)의 별 트랜잭션에서 to_regclass 부재 재확인.

-- ── up.sql 본문 (BEGIN/COMMIT 제거) ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('foot-health-q-photos', 'foot-health-q-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE TABLE IF NOT EXISTS public.health_q_photos (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  result_id    UUID        NOT NULL REFERENCES public.health_q_results(id) ON DELETE CASCADE,
  clinic_id    UUID        NOT NULL REFERENCES public.clinics(id),
  storage_path TEXT        NOT NULL,
  content_type TEXT,
  byte_size    INTEGER,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_q_photos_result ON public.health_q_photos (result_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_health_q_photos_clinic ON public.health_q_photos (clinic_id, uploaded_at DESC);

ALTER TABLE public.health_q_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "health_q_photos_select_clinic" ON public.health_q_photos;
CREATE POLICY "health_q_photos_select_clinic"
  ON public.health_q_photos FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id());

DROP POLICY IF EXISTS "health_q_photos_obj_read" ON storage.objects;
CREATE POLICY "health_q_photos_obj_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'foot-health-q-photos'
    AND (storage.foldername(name))[1] = 'health-q'
    AND (storage.foldername(name))[2] = public.current_user_clinic_id()::text
  );

DROP FUNCTION IF EXISTS fn_health_q_submit(TEXT, JSONB, TEXT);
CREATE OR REPLACE FUNCTION fn_health_q_submit(
  p_token TEXT, p_form_data JSONB, p_storage_path TEXT DEFAULT NULL, p_photos JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN jsonb_build_object('success', true); END; $$;
GRANT EXECUTE ON FUNCTION fn_health_q_submit(TEXT, JSONB, TEXT, JSONB) TO anon, authenticated;

-- ── in-txn assertion ────────────────────────────────────────────────────────
DO $chk$
DECLARE
  v_public BOOLEAN;
  v_cnt    INTEGER;
BEGIN
  -- ① 버킷 private 실존
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'foot-health-q-photos';
  IF v_public IS DISTINCT FROM false THEN RAISE EXCEPTION 'DRYRUN-FAIL: bucket not private/absent'; END IF;

  -- 테이블 + 컬럼 셋
  IF to_regclass('public.health_q_photos') IS NULL THEN RAISE EXCEPTION 'DRYRUN-FAIL: table absent'; END IF;
  SELECT count(*) INTO v_cnt FROM information_schema.columns
    WHERE table_schema='public' AND table_name='health_q_photos'
      AND column_name IN ('id','result_id','clinic_id','storage_path','content_type','byte_size','sort_order','uploaded_at');
  IF v_cnt <> 8 THEN RAISE EXCEPTION 'DRYRUN-FAIL: column set mismatch (%)', v_cnt; END IF;

  -- RLS 활성
  SELECT count(*) INTO v_cnt FROM pg_class WHERE relname='health_q_photos' AND relrowsecurity;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: RLS not enabled'; END IF;

  -- 테이블 select 정책 실존
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE tablename='health_q_photos' AND policyname='health_q_photos_select_clinic';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: table select policy absent'; END IF;

  -- storage read 정책 실존
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE tablename='objects' AND policyname='health_q_photos_obj_read';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: storage read policy absent'; END IF;

  -- DA ② anon 이 이 버킷에 storage.objects INSERT 하는 정책 부재 (roles 에 anon 포함 & INSERT cmd 정책 0)
  SELECT count(*) INTO v_cnt FROM pg_policies
    WHERE tablename='objects' AND cmd='INSERT'
      AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
      AND qual LIKE '%foot-health-q-photos%';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'DRYRUN-FAIL: anon storage INSERT policy present (DA hard-cond violated)'; END IF;

  -- fn 4-arg 실존 + 3-arg 부재
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname='fn_health_q_submit' AND pronargs=4;
  IF v_cnt < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 4-arg fn_health_q_submit absent'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname='fn_health_q_submit' AND pronargs=3;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'DRYRUN-FAIL: 3-arg fn_health_q_submit still present (ambiguity)'; END IF;

  RAISE NOTICE 'DRYRUN-OK: healthq photo upload migration assertions passed';
END
$chk$;
