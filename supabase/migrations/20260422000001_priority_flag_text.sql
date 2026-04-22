-- P0-1: Ensure priority_flag is TEXT, not BOOLEAN
-- The initial_schema created it as BOOLEAN, then 20260420000007_dashboard_fields.sql
-- re-added it as TEXT with CHECK constraint. This migration ensures idempotency
-- in case 20260420000007 did ADD COLUMN IF NOT EXISTS (which would skip if BOOLEAN already exists).

-- Drop the old column if it's BOOLEAN type and re-create as TEXT
DO $$
BEGIN
  -- Check if priority_flag exists and is boolean
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'check_ins'
      AND column_name = 'priority_flag'
      AND data_type = 'boolean'
  ) THEN
    ALTER TABLE check_ins DROP COLUMN priority_flag;
    ALTER TABLE check_ins ADD COLUMN priority_flag TEXT
      CHECK (priority_flag IS NULL OR priority_flag IN ('CP','#'));
  END IF;
END $$;
