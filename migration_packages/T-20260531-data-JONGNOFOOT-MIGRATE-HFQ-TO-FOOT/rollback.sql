-- ============================================================================
-- T-20260531-data-JONGNOFOOT-MIGRATE-HFQ-TO-FOOT  ·  AC-7 ROLLBACK
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd
-- Reverses migrate.sql EXACTLY by the migration tag [MIGRATE-HFQ-FOOT-20260531].
-- Order: check_ins first (FK child) → customers (parent).
-- Idempotent. Touches ONLY tagged rows — no pre-existing prod data affected.
-- ============================================================================

BEGIN;

-- child first
DELETE FROM check_ins
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND notes LIKE '%[MIGRATE-HFQ-FOOT-20260531]%';

-- parent (only customers we inserted; 5 pre-existing prod customers were NOT
-- tagged → untouched). check_ins that referenced those 5 are deleted above.
DELETE FROM customers
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND memo LIKE '%[MIGRATE-HFQ-FOOT-20260531]%';

-- verification: both should be 0 after rollback
SELECT 'customers tagged remaining' AS what, count(*) AS n
  FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND memo LIKE '%[MIGRATE-HFQ-FOOT-20260531]%'
UNION ALL
SELECT 'check_ins tagged remaining', count(*)
  FROM check_ins
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND notes LIKE '%[MIGRATE-HFQ-FOOT-20260531]%';

-- COMMIT;   -- ← uncomment to apply rollback after confirming counts = 0
ROLLBACK;    -- default-safe
