-- T-20260526-foot-COPAY-MINI-BUG AC-1 ROLLBACK
-- is_insurance_covered 원복 (false)

UPDATE services
SET is_insurance_covered = false
WHERE service_code IN (
  'AA154',
  'AA254',
  'AA155',
  'AA222',
  'AA157',
  'D620300HZ'
);
