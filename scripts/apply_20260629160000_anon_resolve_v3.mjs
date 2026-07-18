/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER Gate B — resolve_v3 (ADDITIVE) prod 적용.
 * 동형 러너(apply_20260628200000_waiting_board_projection.mjs 패턴, Management API).
 * 흐름: probe-before → [DRY_RUN=1 이면 COMMIT→ROLLBACK 셰도(미persist) 후 종료] → apply → probe-after.
 * rollback: supabase/migrations/20260629160000_anon_upsert_customer_resolve_v3.rollback.sql
 * 실행:  dry-run: DRY_RUN=1 node scripts/apply_20260629160000_anon_resolve_v3.mjs
 *        apply:            node scripts/apply_20260629160000_anon_resolve_v3.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const VERSION = '20260629160000';
const SQL = readFileSync(join(__dir, `../supabase/migrations/${VERSION}_anon_upsert_customer_resolve_v3.sql`), 'utf8');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const DRY_RUN = !!process.env.DRY_RUN;
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required');
async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌ query 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
  return body;
}
const PROBE = `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec, array_to_string(p.proacl,' | ') AS proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v3';`;

console.log('═══ resolve_v3 적용 ('+PROJ_REF+')  mode:', DRY_RUN ? 'DRY-RUN(셰도)' : 'APPLY', '═══\n');
console.log('── probe-before ──');
let b = await q(PROBE);
if (b.length) console.log('  v3:', 'anon_exec='+b[0].anon_exec, 'auth_exec='+b[0].auth_exec, '\n  proacl:', b[0].proacl);
else console.log('  v3: (부재)');

if (DRY_RUN) {
  console.log('\n── [DRY-RUN] 내장 COMMIT→ROLLBACK 셰도 (prod 미persist) ──');
  const shadow = SQL.replace(/\bCOMMIT\s*;/i, 'ROLLBACK;');
  await q(shadow);
  console.log('  ✅ 셰도 apply 성공 (DO 가드 통과·문법·GRANT 유효) → ROLLBACK.');
  console.log('\nDRY_RUN=1 — 실제 적용하지 않고 종료.');
  process.exit(0);
}
console.log('\n── apply ──');
await q(SQL);
console.log('✅ apply 완료\n');
console.log('── probe-after ──');
let a = await q(PROBE);
console.log('  v3:', 'anon_exec='+a[0].anon_exec, 'auth_exec='+a[0].auth_exec, '\n  proacl:', a[0].proacl);
if (a[0].anon_exec !== true) { console.error('❌ anon EXECUTE 미부여 — 조사 필요'); process.exit(1); }
console.log('\n✅ 완료 — anon EXECUTE 확인.');
