/**
 * T-20260713-foot-PHONE-E164-CHK-UNENFORCED — BEFORE probe (read-only)
 * prod 제약 def(舊식) + ledger 20260713160000 미기록 확증 + enforcement 테스트용 required 컬럼 조사.
 * author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';

const cons = await query(`SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
  FROM pg_constraint
  WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk')
  ORDER BY conname;`);
console.log('=== BEFORE constraint defs (prod) ===');
console.log(JSON.stringify(cons, null, 2));

const led = await query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations
  WHERE version = '20260713160000';`);
console.log('=== ledger 20260713160000 (before) ===');
console.log(JSON.stringify(led, null, 2));

for (const t of ['customers', 'reservations']) {
  const cols = await query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${t}' AND is_nullable='NO' AND column_default IS NULL
    ORDER BY ordinal_position;`);
  console.log(`=== ${t}: NOT NULL & no-default cols ===`);
  console.log(JSON.stringify(cols, null, 2));
}
