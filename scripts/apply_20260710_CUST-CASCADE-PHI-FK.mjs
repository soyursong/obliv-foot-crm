/**
 * T-20260710-foot-CUST-CASCADE-PHI-FK — Phase2 apply / dry-run runner
 * foot prod: rxlomoozakkjesdqjtvd
 *
 *   dry-run(기본): node scripts/apply_20260710_CUST-CASCADE-PHI-FK.mjs
 *     → up.sql body 를 BEGIN..ROLLBACK 으로 셰도 실행 + 사후 confdeltype 관찰(무변경).
 *   apply:        APPLY=1 node scripts/apply_20260710_CUST-CASCADE-PHI-FK.mjs
 *     → ★supervisor DDL-diff / PHI DB-GATE 통과 후에만. blind apply 금지.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const APPLY = !!process.env.APPLY;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  const body = await resp.json();
  return { ok: resp.ok, body };
}

const MIG = join(__dir, '../supabase/migrations/20260710_foot_CUST-CASCADE-PHI-FK-HARDEN');
const upBody = readFileSync(`${MIG}_up.sql`, 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '')       // 외곽 트랜잭션 제거(래핑 위해)
  .replace(/^\s*COMMIT;\s*$/m, '');

const TARGETS = ['clinical_images','treatment_photos','health_q_results','patient_past_history',
  'patient_file_records','customer_treatment_memos','customer_consult_memos','customer_special_notes','consultation_notes'];
const STATE_SQL = `SELECT chld.relname AS t, con.confdeltype AS d
  FROM pg_constraint con
  JOIN pg_class chld ON chld.oid=con.conrelid
  JOIN pg_class par ON par.oid=con.confrelid
  JOIN pg_namespace ns ON ns.oid=chld.relnamespace
 WHERE con.contype='f' AND ns.nspname='public' AND par.relname='customers'
   AND chld.relname = ANY(ARRAY['${TARGETS.join("','")}']) ORDER BY chld.relname;`;

console.log(`\n===== T-20260710 CUST-CASCADE-PHI-FK — ${APPLY?'APPLY':'DRY-RUN(BEGIN..ROLLBACK)'} — foot prod =====`);
console.log(`ts=${new Date().toISOString()}\n`);

// before state
const before = await q(STATE_SQL);
if (!before.ok) { console.error('❌ before 조회 실패', JSON.stringify(before.body)); process.exit(1); }
const rule = { a:'NOACTION', r:'RESTRICT', c:'CASCADE', n:'SETNULL' };
console.log('[BEFORE] 대상 9 FK del_rule:');
for (const r of (before.body.result ?? before.body)) console.log(`   ${r.t.padEnd(28)} ${rule[r.d]||r.d}`);

if (APPLY) {
  console.log('\n▶ APPLY 실행 (up.sql — 자체 BEGIN..COMMIT + 가드/사후검증)');
  const upFull = readFileSync(`${MIG}_up.sql`, 'utf8');
  const res = await q(upFull);
  if (!res.ok) { console.error('❌ APPLY 실패:', JSON.stringify(res.body, null, 2)); process.exit(1); }
  const after = await q(STATE_SQL);
  console.log('\n[AFTER] 대상 9 FK del_rule:');
  for (const r of (after.body.result ?? after.body)) console.log(`   ${r.t.padEnd(28)} ${rule[r.d]||r.d}`);
  const bad = (after.body.result ?? after.body).filter(r => r.d !== 'r');
  console.log(bad.length ? `\n⚠ RESTRICT 아닌 FK 잔존: ${bad.map(r=>r.t).join(',')}` : '\n✅ APPLY 성공 — 대상 9 FK 전부 RESTRICT');
} else {
  // 셰도: BEGIN → up body → 상태 관찰 → ROLLBACK, 단일 쿼리로 원자 실행
  const shadow = `BEGIN;\n${upBody}\n-- 셰도 상태 관찰\nCREATE TEMP TABLE _shadow_state ON COMMIT DROP AS ${STATE_SQL.replace(/;$/,'')};\nROLLBACK;`;
  const res = await q(shadow);
  if (!res.ok) {
    console.error('\n❌ DRY-RUN 셰도 실패(가드 abort 포함 가능):\n', JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  console.log('\n✅ DRY-RUN 셰도 성공 — 가드0(orphan=0)·라이더(dangling=0)·[A]RESTRICT·[B]ADD FK·사후검증 전부 통과 후 ROLLBACK.');
  console.log('   (트랜잭션 롤백 완료 → prod 무변경. 실 apply 는 supervisor DDL-diff 게이트 후 APPLY=1)');
  const afterRb = await q(STATE_SQL);
  console.log('\n[ROLLBACK 후 재확인] 대상 FK del_rule (BEFORE와 동일해야 함):');
  for (const r of (afterRb.body.result ?? afterRb.body)) console.log(`   ${r.t.padEnd(28)} ${rule[r.d]||r.d}`);
}
console.log('');
