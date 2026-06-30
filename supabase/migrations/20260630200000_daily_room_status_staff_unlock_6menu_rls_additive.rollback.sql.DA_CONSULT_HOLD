-- ROLLBACK — T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP Phase2 daily_room_status ADDITIVE
-- 추가한 정책 1개만 제거 → 기존 2 write 정책(admin_manager_write, staff_own_write)은 무손상 잔존.
-- coordinator/consultant/therapist 만 토글 거부 상태(=apply 전)로 복귀. 데이터 손실 0.

BEGIN;

DROP POLICY IF EXISTS daily_room_status_staff_unlock_6menu ON public.daily_room_status;

COMMIT;
