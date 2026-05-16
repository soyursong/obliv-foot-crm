-- rollback: T-20260515-foot-REFERRAL-NAME
ALTER TABLE customers DROP COLUMN IF EXISTS referral_name;
