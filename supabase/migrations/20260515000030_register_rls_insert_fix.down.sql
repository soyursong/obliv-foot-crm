-- ============================================================
-- T-20260515-foot-RLS-REGISTER-BUG ROLLBACK
-- ============================================================
DROP POLICY IF EXISTS allow_insert_own_profile ON user_profiles;
