/**
 * T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE — P-A READ-only introspection (steps 1,2 + schema).
 * P-A.1 schema_migrations 20260713160000 원장 실재
 * P-A.2 pg_get_constraintdef verbatim (신규 정본식 vs 舊 82? 식)
 * + customers NOT NULL(무default) 컬럼 introspect (probe 준비)
 * author: dev-foot / 2026-07-18. READ-only.
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const tok = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const b = await r.json();
  if (!r.ok) { console.error('❌ SQL err', JSON.stringify(b)); process.exit(1); }
  return b.result ?? b;
}
const VER = '20260713160000';
console.log('══ P-A READ-only 실측 — PHONE-E164-BACKFILL-VALIDATE ══');
console.log('측정시각(UTC):', new Date().toISOString(), '\n');

console.log('── P-A.1) schema_migrations 원장 실재 ──');
const led = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VER}';`);
const found = Array.isArray(led) && led.length > 0;
console.log(`  원장 조회 결과: ${JSON.stringify(led)}`);
console.log(`  → P-A.1 = ${found ? '✅ PASS (원장 실재)' : '❌ FAIL (미기록=미적용)'}\n`);

console.log('── P-A.2) pg_get_constraintdef verbatim ──');
const cons = await q(`SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
  FROM pg_constraint WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk') ORDER BY 1;`);
let allNew = true;
for (const r of cons) {
  const oldGuard = /82\?0\?1/.test(r.def);
  const newBranch = /\(\?!82\)/.test(r.def);
  const isNew = newBranch && !oldGuard;
  if (!isNew) allNew = false;
  console.log(`  ${r.conname}: convalidated=${r.convalidated} oldGuard=${oldGuard} newCanonicalBranch=${newBranch}`);
  console.log(`    def: ${r.def}`);
}
console.log(`  → P-A.2 = ${allNew ? '✅ PASS (신규 정본식)' : '❌ FAIL (舊 82? 식 잔존)'}\n`);

console.log('── (probe 준비) customers NOT NULL·무default 컬럼 ──');
const cols = await q(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema='public' AND table_name='customers'
  AND is_nullable='NO' AND column_default IS NULL ORDER BY ordinal_position;`);
console.log('  ' + JSON.stringify(cols));
