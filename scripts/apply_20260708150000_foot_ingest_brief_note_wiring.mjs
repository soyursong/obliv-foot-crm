/**
 * T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH — 간략메모(brief_note) → 풋CRM 배선 적용.
 *   upsert_reservation_from_source RPC 를 18-arg(p_brief_note 末尾) 으로 재구현.
 *   17-arg 명시 DROP → 18-arg CREATE (오버로드 충돌 차단). INSERT + ON CONFLICT COALESCE 보존.
 * 게이트: ADDITIVE 확정(스키마 무변경, brief_note 컬럼 旣존 20260624100000) → 대표게이트 면제
 *   (autonomy §3.1 ADDITIVE+DA GO / DA GO+ADDITIVE MSG-tjrg). supervisor DDL-diff only.
 * 사용: node scripts/apply_20260708150000_foot_ingest_brief_note_wiring.mjs            # 실제 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_20260708150000_foot_ingest_brief_note_wiring.mjs   # 트랜잭션 실행 후 ROLLBACK(검증)
 * rollback: supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.sql'), 'utf8');

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

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} brief_note 배선 — T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH`);
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: SQL }) });
const body = await resp.json();
console.log('Status:', resp.status);
if (!resp.ok) { console.error('❌ 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
console.log(DRYRUN ? '✅ DRYRUN green (롤백됨, 미반영)' : '✅ 적용 완료');
