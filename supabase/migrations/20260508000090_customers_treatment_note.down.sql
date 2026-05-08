-- C23-DETAIL-SIMPLIFY rollback: treatment_note 컬럼 제거
ALTER TABLE customers DROP COLUMN IF EXISTS treatment_note;
