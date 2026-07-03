-- T-20260703-foot-STAFFPHOTO-CHART-LINK — 직원촬영 발 임상사진 차트연동
-- canonical treatment_photos TABLE 신설 (derm canonical shape 채택) + private 전용 버킷 + RLS.
--
-- ★정본 근거: data-architect CONSULT-REPLY MSG-20260703-103153-y6ez (GO_WARN, ADDITIVE=YES).
--   planner NEW-TASK MSG-20260703-103818-x1mm (착수 GO, standby 6w6d supersede). 대표 게이트 EXEMPT(§3.1).
--
-- DA 구현조건 5건 반영:
--   ① private 버킷 public=false. 서빙=RLS-gated signed URL만. 경로 {clinic_id}/{customer_id}/{uuid}.
--   ② canonical treatment_photos shape 채택 (foot 부재 → 신설). 직원촬영 구분 = 로컬 source/photo_category enum.
--      ※ foot 에는 기존 check_ins.treatment_photos TEXT[] '컬럼'만 존재(레거시 비포/애프터). 본 '테이블'과 별개.
--        신규 명칭(patient_clinical_photos 등) 금지 → canonical 명 treatment_photos 사용.
--   ③ check_in_id UUID NULL FK → check_ins(id) ON DELETE SET NULL + customer_id + clinic_id 결속.
--   ④ soft-delete: deleted_at set. 물리 DELETE / Storage object 영구삭제 금지(의료법 §22 보존).
--      check_in 삭제 시 사진 CASCADE 금지 → ON DELETE SET NULL.
--   ⑤ RLS: write=clinic 일치 AND 인증 직원(표준 staff role). read=동일 clinic 진료뷰 전체(원장 포함).
--      storage.objects = 테이블 RLS 미러(path prefix 동일). 정렬 created_at DESC, 부분인덱스 WHERE deleted_at IS NULL.
--      PHI tier=restricted, RRN-class 아님(이미지 본문 필드암호화 불요).
--
-- ★PHI DB-GATE: ADDITIVE 여도 PHI 테이블 → supervisor DDL-diff 게이트 통과 후 배포. 롤백 = 동명 .rollback.sql.
-- ★재실행 안전: IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE. 데이터 mutation 0 (DDL only).
-- ★cross-CRM 영향 0: treatment_photos 는 foot-로컬 신설(schema_registry 미등재). derm 동명 테이블과 물리 분리(각 project).

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) private 전용 버킷 (public=false). 무인증 CDN target 절대 미포함.
--    이미 존재해도 강제 private 로 방어(재실행 안전).
-- ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('treatment-photos', 'treatment-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ────────────────────────────────────────────────────────────────
-- 2) canonical treatment_photos 테이블 (derm shape + foot 로컬 확장)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treatment_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  check_in_id UUID     REFERENCES public.check_ins(id) ON DELETE SET NULL,  -- check_in 삭제해도 사진 보존
  clinic_id   UUID NOT NULL REFERENCES public.clinics(id),
  -- 사진 정보 (canonical)
  photo_url   TEXT NOT NULL,                    -- storage object path: {clinic_id}/{customer_id}/{uuid}
  -- 로컬 확장: object 가 어느 버킷에 있는지(신규=treatment-photos, backfill 레거시=photos).
  --   read 경로가 per-row 버킷으로 signed URL 발급. (레거시 backfill 은 object 를 물리 이동하지 않음)
  storage_bucket TEXT NOT NULL DEFAULT 'treatment-photos'
                 CHECK (storage_bucket IN ('treatment-photos','photos')),
  photo_type  TEXT NOT NULL DEFAULT 'progress' CHECK (photo_type IN ('before','after','progress')),
  body_part   TEXT,                             -- 발 부위(예: 왼발/오른발/발톱/발바닥 등)
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  treatment_name TEXT,
  session_no  INTEGER,
  note        TEXT,
  file_size_bytes INTEGER,
  original_filename TEXT,
  uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- foot 로컬: 직원촬영 구분 (별도 테이블·별도 명칭 금지 → 로컬 enum 컬럼)
  --   legacy_string_array = 구 check_ins.treatment_photos(TEXT[]) 백필분(20260703170500 참조).
  source      TEXT NOT NULL DEFAULT 'staff_capture'
              CHECK (source IN ('staff_capture','patient_upload','import','legacy_string_array')),
  photo_category TEXT,                          -- 발 임상 카테고리 자유 태깅(무좀/발톱/각질 등)
  -- soft-delete (물리 DELETE 금지 — 의료법 §22 보존)
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.treatment_photos IS
  '직원촬영 임상사진 (T-20260703-foot-STAFFPHOTO-CHART-LINK). PHI tier=restricted. soft-delete(deleted_at). canonical derm shape.';

-- ────────────────────────────────────────────────────────────────
-- 3) 인덱스 — 부분 인덱스 WHERE deleted_at IS NULL, created_at DESC 정렬
-- ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_treatment_photos_customer_live
  ON public.treatment_photos (customer_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_treatment_photos_checkin_live
  ON public.treatment_photos (check_in_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_treatment_photos_clinic_live
  ON public.treatment_photos (clinic_id, created_at DESC) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────────
-- 4) 테이블 RLS
--    read(SELECT): 동일 clinic 진료 뷰 접근자 전체(원장 포함). 축소 금지.
--    write(INSERT/UPDATE/soft-delete): clinic 일치 AND 인증 직원(표준 staff role). patient/anon 차단.
--    물리 DELETE 정책 미부여 → soft-delete 강제.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.treatment_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "treatment_photos_read_clinic" ON public.treatment_photos;
CREATE POLICY "treatment_photos_read_clinic"
  ON public.treatment_photos FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id());

DROP POLICY IF EXISTS "treatment_photos_insert_staff" ON public.treatment_photos;
CREATE POLICY "treatment_photos_insert_staff"
  ON public.treatment_photos FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id = public.current_user_clinic_id()
    -- ALL_STAFF_ROLES (src/lib/permissions.ts) verbatim mirror — anti-drift. tm 제외(원격/임상촬영 비대상), technician 미존재.
    AND public.current_user_role() IN
        ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff')
  );

DROP POLICY IF EXISTS "treatment_photos_update_staff" ON public.treatment_photos;
CREATE POLICY "treatment_photos_update_staff"
  ON public.treatment_photos FOR UPDATE TO authenticated
  USING (
    clinic_id = public.current_user_clinic_id()
    -- ALL_STAFF_ROLES (src/lib/permissions.ts) verbatim mirror — anti-drift. tm 제외(원격/임상촬영 비대상), technician 미존재.
    AND public.current_user_role() IN
        ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff')
  )
  WITH CHECK (
    clinic_id = public.current_user_clinic_id()
  );

-- ────────────────────────────────────────────────────────────────
-- 5) storage.objects 정책 = 테이블 RLS 미러 (path prefix = clinic_id, 버킷 private).
--    DELETE 정책 미부여 → Storage object 영구삭제 차단(의료법 보존).
-- ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "treatment_photos_obj_read" ON storage.objects;
CREATE POLICY "treatment_photos_obj_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'treatment-photos'
    AND (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );

DROP POLICY IF EXISTS "treatment_photos_obj_insert" ON storage.objects;
CREATE POLICY "treatment_photos_obj_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'treatment-photos'
    AND (storage.foldername(name))[1] = public.current_user_clinic_id()::text
    -- ALL_STAFF_ROLES (src/lib/permissions.ts) verbatim mirror — anti-drift. tm 제외(원격/임상촬영 비대상), technician 미존재.
    AND public.current_user_role() IN
        ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff')
  );

DROP POLICY IF EXISTS "treatment_photos_obj_update" ON storage.objects;
CREATE POLICY "treatment_photos_obj_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'treatment-photos'
    AND (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  )
  WITH CHECK (
    bucket_id = 'treatment-photos'
    AND (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );

COMMIT;
