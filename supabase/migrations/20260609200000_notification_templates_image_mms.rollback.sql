-- ROLLBACK: T-20260609-foot-MSG-TEMPLATE-MMS Part B
-- 주의: 버킷 내 객체가 남아있으면 버킷 삭제 전 객체부터 제거 필요.
--       데이터 보존이 필요하면 DROP COLUMN / DROP BUCKET 은 생략하고 정책만 되돌릴 것.

-- 2. storage 정책 + 버킷
DROP POLICY IF EXISTS "msgimg_clinic_read"  ON storage.objects;
DROP POLICY IF EXISTS "msgimg_clinic_write" ON storage.objects;
-- 버킷 내 객체 선삭제(있을 경우)
DELETE FROM storage.objects WHERE bucket_id = 'message-images';
DELETE FROM storage.buckets WHERE id = 'message-images';

-- 1. notification_templates.image_path
ALTER TABLE public.notification_templates
  DROP COLUMN IF EXISTS image_path;
