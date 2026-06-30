// Dry-run: T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL superset migration.
// 전체 migration 을 트랜잭션 안에서 실행 → ROLLBACK. 컴파일/DDL/함수 유효성만 검증, 영속0.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJ = 'rxlomoozakkjesdqjtvd';
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.sql'), 'utf8');
// COMMIT → ROLLBACK 로 치환(영속 차단). 마지막 COMMIT 1개만 존재.
SQL = SQL.replace(/\nCOMMIT;\n/, '\nROLLBACK;\n');
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }) });
  return { ok: r.ok, status: r.status, body: await r.json() };
}
console.log('🧪 DRY-RUN (BEGIN … ROLLBACK): superset migration compile/validity check');
const res = await q(SQL);
console.log('HTTP', res.status, res.ok ? '✅ compiled (rolled back, no persist)' : '❌ FAILED');
if (!res.ok) { console.error(JSON.stringify(res.body, null, 2)); process.exit(1); }
// 확인: rollback 후 prod 함수는 여전히 8-arg(미변경) 이어야 함.
const sig = await q("SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='upsert_reservation_from_source' AND n.nspname='public';");
console.log('post-rollback signatures (기대: 8-arg 그대로):', JSON.stringify(sig.body));
