-- ROLLBACK — T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM (20260618200000_staff_attendance_ssot.sql)
--
-- 신설 테이블 1건 제거. 데이터 손실 영향:
--   - staff_attendance DROP: 적재된 출근 동기 데이터 전부 소실.
--     단, 원천=구글시트(외부 SSOT) + sync EF 재실행으로 재구성 가능 → 영구 손실 아님.
--   ※ duty_roster(T-20260502)·staff·clinics·user_profiles 등 기존 테이블 미접촉.
--   ※ rollback 후 배정화면 '출근 N명' read 경로가 본 테이블을 참조 중이면 함께 원복 필요
--     (단, 본 마이그 단계에서는 read 전환 미적용 → 단독 rollback 안전).

BEGIN;

DROP TABLE IF EXISTS staff_attendance;

COMMIT;
