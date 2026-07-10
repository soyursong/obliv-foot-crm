import { query, ledgerVersions } from './lib/foot_migration_ledger.mjs';

console.log('=== PRE-FLIGHT (read-only) prod rxlomoozakkjesdqjtvd ===');

// 1) phone_dummy column presence
const col = await query(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' AND column_name='phone_dummy';`);
console.log('phone_dummy column:', JSON.stringify(col));

// 2) customers row count
const cnt = await query(`SELECT count(*)::int AS n FROM public.customers;`);
console.log('customers rows:', JSON.stringify(cnt));

// 3) ledger has 20260709120000?
const versions = await ledgerVersions();
console.log('ledger has 20260709120000:', versions.has('20260709120000'));

// 4) trigger/function presence
const trg = await query(`SELECT tgname FROM pg_trigger WHERE tgname='trg_customers_set_phone_dummy' AND NOT tgisinternal;`);
console.log('trigger present:', JSON.stringify(trg));
const fn = await query(`SELECT proname FROM pg_proc WHERE proname IN ('is_dummy_phone','customers_set_phone_dummy');`);
console.log('functions present:', JSON.stringify(fn));

// 5) frozen 4-row before-image (PK ∩ phone literal)
const legacy = await query(`SELECT id, phone, clinic_id FROM public.customers
  WHERE id IN (
    'd330baa7-45b0-44b8-9711-c76c8628f450',
    'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
    '06e744e0-b881-4dc0-b8ed-cec78fc73212',
    '5a64b5c5-6fbf-4929-ae95-14d525147e11'
  ) ORDER BY phone;`);
console.log('legacy 4-row current state:', JSON.stringify(legacy, null, 2));

const legacyMatch = await query(`SELECT count(*)::int AS n FROM public.customers
  WHERE id IN (
    'd330baa7-45b0-44b8-9711-c76c8628f450',
    'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
    '06e744e0-b881-4dc0-b8ed-cec78fc73212',
    '5a64b5c5-6fbf-4929-ae95-14d525147e11'
  ) AND phone IN ('0','000','000-0001-1111','000-0111-0000');`);
console.log('legacy freeze match (expect 4):', JSON.stringify(legacyMatch));
