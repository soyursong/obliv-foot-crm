-- ============================================================
-- ROLLBACK: T-20260516-foot-CLINIC-DOC-INFO
-- ============================================================
-- 주의: clinic_doctors 테이블 데이터 전체 삭제
-- ============================================================

BEGIN;

-- clinic_doctors 테이블 제거
DROP TABLE IF EXISTS clinic_doctors CASCADE;

-- clinics 컬럼 제거
ALTER TABLE clinics
  DROP COLUMN IF EXISTS business_no,
  DROP COLUMN IF EXISTS established_date;

COMMIT;
