-- ROLLBACK — T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC
-- ADDITIVE 역연산: 신규 nullable FK 컬럼 2개 DROP. backfill 없었으므로(레거시 NULL) 데이터 유실 없음.
-- FK ON DELETE SET NULL이라 참조 무결성 잔재 없음. 멱등: DROP COLUMN IF EXISTS.
--
-- ⚠ 순서: check_ins.treating_doctor_id 먼저, clinic_doctors.staff_id 다음(상호 의존 없음 — 순서 무관하나 신설 역순).

ALTER TABLE check_ins     DROP COLUMN IF EXISTS treating_doctor_id;
ALTER TABLE clinic_doctors DROP COLUMN IF EXISTS staff_id;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260708210000';
