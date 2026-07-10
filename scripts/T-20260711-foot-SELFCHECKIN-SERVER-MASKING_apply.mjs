import { applyMigration } from './lib/foot_migration_ledger.mjs';

const res = await applyMigration({
  version: '20260711120000',
  file: '20260711120000_selfcheckin_today_reservations_server_masking.sql',
  dryRun: false,
  createdBy: 'dev-foot:T-20260711-foot-SELFCHECKIN-SERVER-MASKING',
});
console.log('=== APPLY RESULT ===');
console.log(JSON.stringify(res, null, 2));
