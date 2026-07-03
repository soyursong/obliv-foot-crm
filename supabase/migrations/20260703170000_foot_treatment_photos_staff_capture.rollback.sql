-- ROLLBACK: T-20260703-foot-STAFFPHOTO-CHART-LINK
-- 20260703170000_foot_treatment_photos_staff_capture.sql 역전.
--
-- ⚠ 의료법 §22 보존: 운영 데이터가 이미 적재된 뒤의 롤백은 PHI(임상사진) 손실을 유발한다.
--   본 롤백은 "배포 직후 무데이터 상태 즉시 회수" 시나리오 전용.
--   운영 중 회수가 필요하면 DROP TABLE 대신 정책만 되돌리고 데이터는 보존할 것(아래 [보존형] 참조).
--
-- [표준형] 배포 직후 클린 롤백 (무데이터 전제):
BEGIN;

-- storage.objects 미러 정책 제거
DROP POLICY IF EXISTS "treatment_photos_obj_update" ON storage.objects;
DROP POLICY IF EXISTS "treatment_photos_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "treatment_photos_obj_read"   ON storage.objects;

-- 테이블 정책 제거
DROP POLICY IF EXISTS "treatment_photos_update_staff" ON public.treatment_photos;
DROP POLICY IF EXISTS "treatment_photos_insert_staff" ON public.treatment_photos;
DROP POLICY IF EXISTS "treatment_photos_read_clinic"  ON public.treatment_photos;

-- 인덱스 + 테이블 제거 (CASCADE 없이 — FK 자식 없음)
DROP INDEX IF EXISTS public.idx_treatment_photos_clinic_live;
DROP INDEX IF EXISTS public.idx_treatment_photos_checkin_live;
DROP INDEX IF EXISTS public.idx_treatment_photos_customer_live;
DROP TABLE IF EXISTS public.treatment_photos;

-- 버킷 제거 (버킷 내 object 존재 시 실패 → 무데이터 전제. object 있으면 [보존형] 사용).
DELETE FROM storage.buckets WHERE id = 'treatment-photos';

COMMIT;

-- ────────────────────────────────────────────────────────────────
-- [보존형] 운영 중 회수 (데이터 보존) — 위 BEGIN..COMMIT 대신 아래만 실행:
--   DROP POLICY IF EXISTS "treatment_photos_obj_update" ON storage.objects;
--   DROP POLICY IF EXISTS "treatment_photos_obj_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "treatment_photos_obj_read"   ON storage.objects;
--   DROP POLICY IF EXISTS "treatment_photos_update_staff" ON public.treatment_photos;
--   DROP POLICY IF EXISTS "treatment_photos_insert_staff" ON public.treatment_photos;
--   -- read 정책은 유지(원장 조회 보존) 하거나 함께 제거. 테이블/버킷/데이터는 보존.
-- ────────────────────────────────────────────────────────────────
