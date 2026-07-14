/**
 * T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — axis A
 *   clinics.hira_institution_name ADDITIVE 컬럼 + jongno-foot populate(= name, company_name 옵션B 승계).
 * 게이트: ADDITIVE(신규 NULLABLE + data-only) + DA z2af 승계 → §3.1 CEO 면제, supervisor DDL-diff.
 * 사용: node scripts/apply_20260714180000_clinics_hira_institution_name_axis.mjs            # 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260714180000_clinics_hira_institution_name_axis.mjs   # BEGIN..ROLLBACK 검증
 * rollback: supabase/migrations/20260714180000_clinics_hira_institution_name_axis.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260714180000_clinics_hira_institution_name_axis.sql'), 'utf8');

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

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} clinics.hira_institution_name axis`);
const r = await q(SQL);
console.log('Status:', r.status, JSON.stringify(r.body));
if (!r.ok) process.exit(1);

// 사후 확인 (DRYRUN 시엔 컬럼 미영속 기대)
const post = await q(`SELECT slug, name, hira_institution_name FROM clinics ORDER BY slug`);
console.log('post-state:', JSON.stringify(post.body));
const col = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='clinics' AND column_name='hira_institution_name'`);
console.log('column meta:', JSON.stringify(col.body));
