/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER Gate B — prod 상태 probe (read-only).
 * Management API 경유. consent_sensitive / v2 / v3 / waiting_board 실재 점검.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required');
async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  if (!resp.ok) { console.error('❌', JSON.stringify(body)); process.exit(1); }
  return body;
}
console.log('═══ Gate B probe (obliv-foot-crm '+PROJ_REF+') ═══\n');

console.log('[1] consent_sensitive 3컬럼:');
const cols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name IN ('consent_sensitive','consent_agreed_at','consent_version') ORDER BY column_name;`);
cols.forEach(c => console.log('   ✓', c.column_name, c.data_type));
if (!cols.length) console.log('   (부재)');

console.log('\n[2] resolve 함수 (v2/v3):');
const fns = await q(`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('fn_selfcheckin_upsert_customer_resolve_v2','fn_selfcheckin_upsert_customer_resolve_v3') ORDER BY p.proname;`);
fns.forEach(f => console.log('   ✓', f.proname, '| anon_exec='+f.anon_exec, 'auth_exec='+f.auth_exec, '\n       args:', f.args));
if (!fns.length) console.log('   (둘 다 부재)');

console.log('\n[3] waiting_board 테이블:');
const wb = await q(`SELECT to_regclass('public.waiting_board') AS tbl;`);
console.log('   존재:', wb[0]?.tbl ?? '(없음)');
if (wb[0]?.tbl) {
  const wbcols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='waiting_board' ORDER BY ordinal_position;`);
  console.log('   컬럼:', wbcols.map(c=>c.column_name).join(', '));
  const rls = await q(`SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='waiting_board';`);
  console.log('   RLS:', rls[0]?.rls);
  const pol = await q(`SELECT policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND tablename='waiting_board';`);
  pol.forEach(p=>console.log('   정책 ['+p.cmd+']', p.policyname, '→', p.roles));
  const trg = await q(`SELECT tgname FROM pg_trigger WHERE tgname='trg_sync_waiting_board' AND NOT tgisinternal;`);
  console.log('   트리거:', trg[0]?.tgname ?? '(없음)');
}
console.log('\n═══ probe 완료 ═══');
