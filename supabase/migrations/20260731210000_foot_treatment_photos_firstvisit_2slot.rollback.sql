-- ROLLBACK: T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR
--   20260731210000_foot_treatment_photos_firstvisit_2slot.sql 역연산.
--
-- ★주의: foot_side 컬럼 DROP 은 그 컬럼에 저장된 laterality 데이터를 소실시킨다.
--   본 롤백은 스키마 원복용(마이그 직후 무영속·데이터 없을 때). 운영 데이터 존재 시에는
--   컬럼 DROP 대신 값집합만 되돌리는 부분 롤백을 검토(의료법 §22 보존 — 사진 행 자체는 불변).
-- ★source CHECK 는 확장 이전(4값)으로 원복. 단, 'first_visit_mgmt_record' 행이 이미 존재하면
--   ADD CONSTRAINT 가 실패한다 → 그 경우 롤백 불가(운영 데이터 존재 = forward-only). 마이그 직후에만 안전.

BEGIN;

-- 3) partial unique index 제거
DROP INDEX IF EXISTS public.uq_treatment_photos_checkin_source_side;

-- 2) foot_side 컬럼 제거 (inline CHECK 동반 삭제)
ALTER TABLE public.treatment_photos DROP COLUMN IF EXISTS foot_side;

-- 1) source CHECK 값집합 원복 (확장 이전 4값). 'first_visit_mgmt_record' 행 부재 전제.
ALTER TABLE public.treatment_photos DROP CONSTRAINT IF EXISTS treatment_photos_source_check;
ALTER TABLE public.treatment_photos ADD CONSTRAINT treatment_photos_source_check
  CHECK (source IN ('staff_capture','patient_upload','import','legacy_string_array'));

COMMIT;
