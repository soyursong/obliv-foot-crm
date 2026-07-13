/**
 * T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE — 이슈1 seed
 *   clinics hira_unit_value=95.6 / hira_unit_value_year=2026 (foot 의원급) + governed default 제거.
 * 게이트: 비파괴(ADDITIVE·seed UPDATE, DROP DEFAULT) + DA GO + CRM-PREGATE 총괄 선승인.
 * 사용: node scripts/apply_20260714110000_clinics_hira_unit_value_2026_governed.mjs            # 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260714110000_clinics_hira_unit_value_2026_governed.mjs   # BEGIN..ROLLBACK 검증
 * rollback: supabase/migrations/20260714110000_clinics_hira_unit_value_2026_governed.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260714110000_clinics_hira_unit_value_2026_governed.sql'), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
if (DRYRUN) {
  SQL = SQL.replace(/\nCOMMIT;\s*$/m, '\nROLLBACK;\n');
  if (!/ROLLBACK;/.test(SQL)) throw new Error('DRYRUN: COMMIT→ROLLBACK 치환 실패');
}

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  return { ok: resp.ok, status: resp.status, body: await resp.json() };
}

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} clinics hira_unit_value 2026 seed`);
const r = await q(SQL);
console.log('Status:', r.status, JSON.stringify(r.body));
if (!r.ok) process.exit(1);

// 사후 무영속/영속 확인
const chk = await q(`SELECT slug, hira_unit_value, hira_unit_value_year FROM clinics WHERE slug IN ('jongno-foot','songdo-foot') ORDER BY slug`);
console.log('post-state:', JSON.stringify(chk.body));
const def = await q(`SELECT column_name, column_default FROM information_schema.columns WHERE table_name='clinics' AND column_name IN ('hira_unit_value','hira_unit_value_year')`);
console.log('column defaults:', JSON.stringify(def.body));
