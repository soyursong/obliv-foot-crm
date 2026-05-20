-- Rollback: T-20260520-foot-STAFF-DAILY-READ
-- daily_closings_staff_read 정책 제거
--
-- 주의: is_floor_staff() 함수는 제거하지 않음.
--   → check_ins_staff_update / check_ins_staff_insert / customers_staff_select /
--     customers_staff_update 등 다수 정책이 이 함수에 의존함.
--   → 함수 제거가 필요한 경우 20260520000060_check_ins_staff_update_rls.down.sql 단독 실행.
--
-- 롤백 후 daily_closings 정책 상태:
--   daily_closings_admin_all      → ALL   (유지)
--   daily_closings_finance_read   → SELECT consultant/coordinator (유지)
--   daily_closings_therapist_read → SELECT therapist (유지)
--   daily_closings_staff_read     → 제거됨 (staff/part_lead SELECT 차단으로 복귀)

DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;
