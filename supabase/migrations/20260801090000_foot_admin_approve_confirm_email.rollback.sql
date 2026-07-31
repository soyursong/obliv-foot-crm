-- ROLLBACK: T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY
--   admin_approve_and_confirm_user RPC 제거(신규 함수이므로 DROP 안전).
--   ⚠ 이 RPC 가 이미 세팅한 email_confirmed_at 값은 롤백하지 않음(계정 활성 상태 보존 —
--      되돌리면 활성 계정이 다시 로그인 불가가 되어 파괴적). 함수 surface 만 제거.
BEGIN;
DROP FUNCTION IF EXISTS public.admin_approve_and_confirm_user(UUID);
COMMIT;
