-- Storage 버킷 3종: signatures(동의서), photos(비포/애프터), documents(보험 PDF 등)
-- 모두 private. authenticated 풀 액세스 (승인 유저 기준은 앱 레이어에서 처리).
-- 경로 컨벤션:
--   signatures/templates/{template_id}.pdf       — 양식 마스터
--   signatures/signed/{check_in_id}/{consent_id}.pdf  — 서명 완료본
--   photos/{customer_id}/{check_in_id}/{before|after}_{timestamp}.jpg
--   documents/receipts/{customer_id}/{receipt_id}.pdf
--   documents/prescriptions/{customer_id}/{prescription_id}.pdf

INSERT INTO storage.buckets (id, name, public) VALUES
  ('signatures', 'signatures', false),
  ('photos',     'photos',     false),
  ('documents',  'documents',  false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_signatures_all" ON storage.objects;
DROP POLICY IF EXISTS "auth_photos_all"     ON storage.objects;
DROP POLICY IF EXISTS "auth_documents_all"  ON storage.objects;

CREATE POLICY "auth_signatures_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'signatures') WITH CHECK (bucket_id = 'signatures');
CREATE POLICY "auth_photos_all"     ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'photos')     WITH CHECK (bucket_id = 'photos');
CREATE POLICY "auth_documents_all"  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'documents')  WITH CHECK (bucket_id = 'documents');
