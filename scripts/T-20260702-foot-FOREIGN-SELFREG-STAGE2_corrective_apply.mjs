import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from './lib/foot_migration_ledger.mjs';

// STAGE2 (d) legacy placeholder CORRECTIVE — pure data UPDATE, no schema_migrations entry (DDL 0).
// Must run AFTER schema migration (trigger derives phone_dummy=true). SOP v1.0 frozen 4-row + abort thresholds internal.
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'T-20260702-foot-FOREIGN-SELFREG-legacy-placeholder-phone-normalize.sql'), 'utf8');
const res = await query(sql);
console.log('=== CORRECTIVE APPLY RESULT ===');
console.log(JSON.stringify(res, null, 2));
