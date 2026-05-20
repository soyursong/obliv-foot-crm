-- T-20260520-foot-SLOT-MOVE-REVERT: reservations UPDATE 권한 — staff/therapist/technician 추가
--
-- Root Cause:
--   20260426000000_rls_role_separation.sql 에서 reservations UPDATE 권한이
--   admin/manager · coordinator 이상 · consultant 이상에게만 부여됨.
--   therapist · technician · tm · staff 역할은 SELECT 만 가능.
--
--   슬롯 드래그 시 executeSlotDrag() → supabase UPDATE(reservation_time)
--   → RLS 차단 → silent 0-row (error: null) → 낙관적 업데이트 유지
--   → 이후 fetchTimelineReservations() 호출(Realtime·60s poll)로 DB 값 덮어쓰기
--   → 클라이언트에서 슬롯이 되돌아오는 것처럼 보임.
--
--   관리자 계정은 reservations_admin_all 정책으로 통과 → 정상. 스태프 전원 실패.
--
-- Fix:
--   is_approved_user() (승인된 모든 사용자) 대상 UPDATE 정책 추가.
--   기존 coordinator/consultant/admin 정책과 OR 결합 → 충돌 없음.
--   모든 승인된 직원이 dashboard 에서 reservation_time 을 변경할 수 있게 됨.
--
-- Rollback: 20260521000050_reservations_staff_update_rls.down.sql
-- Ticket:   T-20260520-foot-SLOT-MOVE-REVERT
-- Applied:  2026-05-21

CREATE POLICY reservations_staff_update ON reservations
  FOR UPDATE TO authenticated
  USING (is_approved_user())
  WITH CHECK (is_approved_user());
