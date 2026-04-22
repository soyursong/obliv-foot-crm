-- P0-5: Add 'staff' to user_profiles role CHECK constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin','manager','consultant','coordinator','therapist','technician','tm','staff'));
