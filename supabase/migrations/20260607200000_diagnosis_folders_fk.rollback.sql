-- ROLLBACK for 20260607200000_diagnosis_folders_fk.sql
-- T-20260607-foot-DXRX-MGMT-2PANEL 갈래① 상병명 3-A additive FK
--
-- ⚠️ services.diagnosis_folder TEXT 는 복원하지 않음(애초에 보존만 함, 무손실 원본 유지).
-- ⚠️ diagnosis_folder_id 컬럼 DROP 시 FK 매핑 데이터 손실 — 단, TEXT diagnosis_folder 안전망이
--    그대로 남아 폴더 분류 정보 자체는 보존됨(롤백 후 재백필 가능).
-- FK 의존성 역순: services 컬럼/인덱스 → 폴더 테이블 정책/인덱스/테이블.

-- 2. services FK 컬럼 제거 (TEXT diagnosis_folder 는 남김)
DROP INDEX IF EXISTS public.idx_services_diagnosis_folder_id;
ALTER TABLE public.services
  DROP COLUMN IF EXISTS diagnosis_folder_id;

-- 3 & 1. 폴더 테이블 정책 → 인덱스 → 테이블
DROP POLICY IF EXISTS "diagnosis_folders_write_auth" ON public.diagnosis_folders;
DROP POLICY IF EXISTS "diagnosis_folders_read_all"  ON public.diagnosis_folders;

DROP INDEX IF EXISTS public.uq_diagnosis_folders_child_name;
DROP INDEX IF EXISTS public.uq_diagnosis_folders_root_name;
DROP INDEX IF EXISTS public.idx_diagnosis_folders_parent;
DROP INDEX IF EXISTS public.idx_diagnosis_folders_clinic;

DROP TABLE IF EXISTS public.diagnosis_folders;

-- 0. (의도적 비복원) ADD COLUMN IF NOT EXISTS diagnosis_folder 는 되돌리지 않음.
--    20260606160000 의 자산이며 본 마이그가 신규 생성한 것이 아니므로 보존.
