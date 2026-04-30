-- T-20260430-foot-CUSTOMERS-STANDARDIZE 롤백
DROP FUNCTION IF EXISTS get_or_create_unified_customer_id(TEXT);
DROP INDEX IF EXISTS idx_customers_inflow_channel;
DROP INDEX IF EXISTS idx_customers_campaign_ref;
DROP INDEX IF EXISTS idx_customers_unified_id;
ALTER TABLE customers
  DROP COLUMN IF EXISTS inflow_source,
  DROP COLUMN IF EXISTS inflow_channel,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS adsubject_name,
  DROP COLUMN IF EXISTS adset_name,
  DROP COLUMN IF EXISTS campaign_name,
  DROP COLUMN IF EXISTS product,
  DROP COLUMN IF EXISTS medium,
  DROP COLUMN IF EXISTS clinic,
  DROP COLUMN IF EXISTS hospital,
  DROP COLUMN IF EXISTS campaign_ref,
  DROP COLUMN IF EXISTS ad_id,
  DROP COLUMN IF EXISTS adset_id,
  DROP COLUMN IF EXISTS campaign_id,
  DROP COLUMN IF EXISTS unified_customer_id;
