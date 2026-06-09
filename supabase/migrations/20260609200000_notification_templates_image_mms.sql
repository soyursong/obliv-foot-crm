-- T-20260609-foot-MSG-TEMPLATE-MMS Part B: MMS(이미지 첨부) 인프라
-- 작성: dev-foot / 2026-06-09
-- ⚠ 운영 적용은 supervisor 이관 (운영 DB 스키마 변경 권한). 롤백 SQL 동봉.
--
-- 변경 범위 (1회 인프라 구축):
--   1. notification_templates.image_path  컬럼 추가 — 템플릿에 약도/약국지도 이미지 첨부 보관
--      (storage 경로 보관; 값이 있으면 발송 시 MMS로 전환)
--   2. storage 버킷 'message-images' (private) + clinic 격리 RLS
--      경로 컨벤션: message-images/{clinic_id}/{template|manual}/{uuid}.jpg
--
-- 기존 발송 경로 무영향: image_path 가 NULL 이면 종전 SMS/LMS 그대로.

-- ============================================================
-- SECTION 1: notification_templates.image_path
-- ============================================================
ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS image_path TEXT;

COMMENT ON COLUMN public.notification_templates.image_path IS
  'T-20260609-foot-MSG-TEMPLATE-MMS: MMS 첨부 이미지의 storage 경로(message-images 버킷). NULL=SMS/LMS, 값 있으면 MMS 발송.';

-- ============================================================
-- SECTION 2: storage 버킷 message-images (private) + clinic 격리
-- ============================================================
-- 경로 1st 세그먼트 = clinic_id 로 강제 → 지점 간 이미지 격리.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('message-images', 'message-images', false)
ON CONFLICT (id) DO NOTHING;

-- clinic 격리: 경로 첫 폴더(clinic_id) 가 요청자 소속 지점과 일치해야 read/write 허용.
-- get_user_clinic_id() 는 기존 RLS 헬퍼(SECURITY DEFINER) 재사용.
DROP POLICY IF EXISTS "msgimg_clinic_read"  ON storage.objects;
DROP POLICY IF EXISTS "msgimg_clinic_write" ON storage.objects;

CREATE POLICY "msgimg_clinic_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-images'
    AND (storage.foldername(name))[1] = public.get_user_clinic_id()::text
  );

CREATE POLICY "msgimg_clinic_write" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'message-images'
    AND (storage.foldername(name))[1] = public.get_user_clinic_id()::text
  )
  WITH CHECK (
    bucket_id = 'message-images'
    AND (storage.foldername(name))[1] = public.get_user_clinic_id()::text
  );
