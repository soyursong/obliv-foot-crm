-- Rollback: 20260529000010_check_in_room_logs_rls_fix
-- backfill 데이터 제거 불가 (logged_by = null인 오늘치만 제거 — 위험하므로 수동 판단)
-- 정책만 원복 (broken 상태로 되돌리므로 실제 배포 시 사용 안 함)

DROP POLICY IF EXISTS "room_logs_clinic_rw" ON check_in_room_logs;

-- 기존 잘못된 정책은 복원하지 않음 (복원 시 INSERT 다시 깨짐)
-- 필요 시 수동 DROP TABLE check_in_room_logs 후 재마이그레이션
