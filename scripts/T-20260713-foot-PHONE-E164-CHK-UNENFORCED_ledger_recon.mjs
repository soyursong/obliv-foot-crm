/**
 * T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Migration Ledger Reconciliation (read-only).
 * schema_migrations 원장 ↔ 마이그 파일 ↔ prod 제약 실재 3자 대조.
 *   - 원장: 20260713160000 이 아직 미기록(=미적용) 이어야 함(apply 는 DA-final pin 후).
 *   - 파일: 20260713160000_foot_phone_e164_chk_expr_fix.{sql,rollback,dryrun} 3종 존재.
 *   - prod: 제약이 아직 舊 `82?` 음성가드(NOT VALID) 여야 함(dry-run 무영속).
 * author: dev-foot / 2026-07-13.
 */
import { readFileSync, existsSync } from 'node:fs';
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
  if (!r.ok) { console.error('❌', JSON.stringify(b)); process.exit(1); }
  return b;
}
const VER = '20260713160000';
console.log('══ Migration Ledger Reconciliation — PHONE-E164-CHK-UNENFORCED (Step1) ══\n');

// 1) 파일 3종 존재
const base = `supabase/migrations/${VER}_foot_phone_e164_chk_expr_fix`;
const files = { up: `${base}.sql`, rollback: `${base}.rollback.sql`, dryrun: `${base}.dryrun.sql` };
console.log('── 1) 파일 존재 ──');
for (const [k, f] of Object.entries(files)) console.log(`  ${existsSync(f) ? '✅' : '❌'} ${k}: ${f}`);

// 2) schema_migrations 원장 — 미기록(미적용) 기대
console.log('\n── 2) schema_migrations 원장 (미적용 기대) ──');
const led = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VER}';`);
const ledRows = led.result ?? led;
console.log(`  원장 기록: ${JSON.stringify(ledRows)}  → ${(!ledRows || ledRows.length === 0) ? '✅ 미적용(예상대로, apply=DA-final 후)' : '⚠ 이미 기록됨'}`);

// 3) prod 제약 실재 — 舊 82? 음성가드 (NOT VALID) 기대
console.log('\n── 3) prod 제약 실재 (舊 82? 음성가드 · NOT VALID 기대) ──');
const cons = await q(`SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
  FROM pg_constraint WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk') ORDER BY 1;`);
const rows = cons.result ?? cons;
for (const r of rows) {
  const oldGuard = /82\?0\?1/.test(r.def);
  const newBranch = /\(\?!82\)/.test(r.def);
  console.log(`  ${r.conname}: notValid=${!r.convalidated} oldGuard=${oldGuard} newBranch=${newBranch}` +
    ` → ${(oldGuard && !newBranch && !r.convalidated) ? '✅ 舊식 유지(무영속)' : '⚠ 예상과 다름'}`);
  console.log(`    def: ${r.def}`);
}
console.log('\n══ 완료 — 3자 정합: 파일3종 존재 · 원장 미적용 · prod 舊식 유지 = dry-run 무영속 실증 ══');
