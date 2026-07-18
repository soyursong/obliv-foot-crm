-- ROLLBACK — T-20260718-foot-DOCCALL-DOCTOR-SCHEDULE-WIRING
-- clinic_doctors.staff_id 브릿지 backfill 되돌리기 (DATA only, no DDL).
--
-- forward(20260718120000)가 채운 링크만 역전: 현재 staff_id 가 '같은 clinic·같은 name·director·active' staff 를
--   가리키는 행을 NULL 로. forward 는 이 조건으로만 채우므로 이 역전이 forward 를 정확히 되돌린다.
--   (수동/타 경로 링크가 존재해 보존이 필요하면 이 파일 대신 explicit id 목록으로 되돌릴 것 — Data-Correction SOP.)
-- 안전: UPDATE only. staff_id NULL 은 '미연결=enabled+advisory' 폴백 = T-20260708 이전 거동으로 복귀(비파괴).

BEGIN;

UPDATE clinic_doctors cd
SET staff_id = NULL
WHERE cd.staff_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM staff s
    WHERE s.id = cd.staff_id
      AND s.clinic_id = cd.clinic_id
      AND s.name = cd.name
      AND s.role = 'director'
      AND s.active = true
  );

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260718120000';

COMMIT;
