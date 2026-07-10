import { applyMigration } from './lib/foot_migration_ledger.mjs';

// T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC STAGE2 (a)+(b)+(c)
// supervisor DDL-diff sign-off complete (2026-07-11) + DA CONSULT-REPLY 58y8 GO (ADDITIVE, 대표게이트 면제).
// FIX-REQUEST MSG-20260711-083742-cduw.
const res = await applyMigration({
  version: '20260709120000',
  file: '20260709120000_foot_customers_phone_dummy_add_trigger.sql',
  dryRun: false,
  createdBy: 'dev-foot:T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC',
});
console.log('=== SCHEMA MIGRATION APPLY RESULT ===');
console.log(JSON.stringify(res, null, 2));
