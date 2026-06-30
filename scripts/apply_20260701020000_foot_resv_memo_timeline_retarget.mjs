/**
 * T-20260630-dopamine-FOOTRESV-MEMO-PUSH-DROP — SoT 재타겟(timeline-only) + ADDITIVE provenance 적용.
 * (1) reservation_memo_history.source_system ADD COLUMN, (2) uq_rmh_resv_source partial unique,
 * (3) upsert_reservation_from_source CREATE OR REPLACE (reservations.memo 매핑 제거 + timeline 가드 INSERT).
 * 게이트: ADDITIVE 확정 → 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). supervisor DDL-diff only.
 * 사용: node scripts/apply_..._timeline_retarget.mjs            # 실제 적용(COMMIT)
 *       DRYRUN=1 node scripts/apply_..._timeline_retarget.mjs   # 트랜잭션 실행 후 ROLLBACK(검증)
 * rollback: supabase/migrations/20260701020000_foot_resv_memo_timeline_retarget_provenance.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
let SQL = readFileSync(join(__dir, '../supabase/migrations/20260701020000_foot_resv_memo_timeline_retarget_provenance.sql'), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
if (DRYRUN) {
  // 마지막 COMMIT; → ROLLBACK; 으로 치환 (트랜잭션 전체 실행 후 미반영)
  SQL = SQL.replace(/\nCOMMIT;\s*$/m, '\nROLLBACK;\n');
  if (!/ROLLBACK;/.test(SQL)) throw new Error('DRYRUN: COMMIT→ROLLBACK 치환 실패');
}

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

console.log(`🚀 ${DRYRUN ? '[DRYRUN]' : '[APPLY]'} memo timeline 재타겟 — T-20260630-FOOTRESV-MEMO-PUSH-DROP`);
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: SQL }) });
const body = await resp.json();
console.log('Status:', resp.status);
if (!resp.ok) { console.error('❌ 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
console.log(DRYRUN ? '✅ DRYRUN green (롤백됨, 미반영)' : '✅ 적용 완료');
