// Dry-run: T-20260630 lifecycle 가드#5 보강 migration (20260630193000).
// 전체 migration 을 BEGIN…ROLLBACK 으로 실행 → 컴파일/함수 유효성만 검증, 영속0.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJ = 'rxlomoozakkjesdqjtvd';
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260630193000_foot_tm_edit_cancel_lifecycle_guard.sql'), 'utf8');
SQL = SQL.replace(/\nCOMMIT;\n/, '\nROLLBACK;\n');
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }) });
  return { ok: r.ok, status: r.status, body: await r.json() };
}
console.log('🧪 DRY-RUN (BEGIN … ROLLBACK): lifecycle 가드#5 migration compile/validity');
const res = await q(SQL);
console.log('HTTP', res.status, res.ok ? '✅ compiled (rolled back, no persist)' : '❌ FAILED');
if (!res.ok) { console.error(JSON.stringify(res.body, null, 2)); process.exit(1); }
