-- T-20260502-foot-LASER-TIME-UNIT rollback
-- clinics 테이블에서 laser_time_units 컬럼 제거

ALTER TABLE clinics DROP COLUMN IF EXISTS laser_time_units;
