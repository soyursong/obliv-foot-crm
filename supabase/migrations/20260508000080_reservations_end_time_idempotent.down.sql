-- rollback: end_time 컬럼 제거
ALTER TABLE reservations DROP COLUMN IF EXISTS end_time;
