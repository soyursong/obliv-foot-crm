-- ROLLBACK for 20260606160000_diagnosis_folder_and_favorites.sql
-- T-20260606-foot-DIAGNOSIS-MASTER-MGMT
-- ⚠️ diagnosis_folder DROP 시 폴더 분류 데이터 손실 — 롤백 전 백업 확인.

-- [C] 즐겨찾기 테이블 제거
DROP TABLE IF EXISTS public.doctor_diagnosis_favorites;

-- [A] 상병 폴더 컬럼 제거 (분류 데이터 함께 소실)
ALTER TABLE public.services
  DROP COLUMN IF EXISTS diagnosis_folder;
