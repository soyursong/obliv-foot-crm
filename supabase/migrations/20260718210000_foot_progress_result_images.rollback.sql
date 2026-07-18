-- ROLLBACK: T-20260702-foot-PROGRESS-CSV-BULKRESULT (20260718210000_foot_progress_result_images.sql)
-- ADDITIVE 순증분의 정확한 역연산. 첨부 데이터·업로드 파일이 있으면 소실되므로
--   운영 롤백 시 progress_result_images 행/버킷 객체 백업 여부를 supervisor가 사전 확인할 것.
-- 멱등: DROP ... IF EXISTS.

BEGIN;

-- 2. 테이블(정책·인덱스는 테이블 DROP에 종속 제거)
DROP TABLE IF EXISTS public.progress_result_images;

-- 1. storage 정책 + 버킷
DROP POLICY IF EXISTS "progress_results_admin_all" ON storage.objects;
-- 버킷 삭제는 내부 객체가 있으면 실패(안전). 비어있을 때만 제거.
DELETE FROM storage.buckets WHERE id = 'progress-results'
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'progress-results');

COMMIT;
