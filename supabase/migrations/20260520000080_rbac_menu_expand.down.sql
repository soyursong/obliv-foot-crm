-- T-20260520-foot-RBAC-MENU-EXPAND 롤백
-- daily_closings therapist SELECT 정책 제거

DROP POLICY IF EXISTS daily_closings_therapist_read ON daily_closings;

-- FE 롤백: AdminLayout.tsx / App.tsx / Closing.tsx 변경 수동 되돌리기 필요.
-- git revert 커밋 해시 참고.
