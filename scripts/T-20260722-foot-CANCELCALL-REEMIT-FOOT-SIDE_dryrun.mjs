/**
 * T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE — DRY-RUN 러너 (No-Persistence Protocol)
 *
 * 실행: node scripts/T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE_dryrun.mjs
 *
 * 프로토콜:
 *   1) up.sql 은 COMMIT 포함 → dryrun.sql 은 COMMIT 제거 + 외부 BEGIN..ROLLBACK 로 무영속.
 *   2) dryrun.sql 실행 = txn 내부 assertion(함수/속성/접근통제/게이트/dry/emit/멱등/batch_tag guard).
 *      DRYRUN-FAIL RAISE 시 즉시 실패.
 *   3) post-probe: 별 트랜잭션에서 pg_proc 부재 재확인(신규 함수가 롤백돼 실제 영속 0).
 * 대상 DB = DEV(kcdqtyivtqcjmcrdjkqi). prod(rxlomooz) 는 supervisor QA GO 후 apply.
 */
import pg from 'pg';
import fs from 'node:fs';
const { Client } = pg;

function readEnv(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    if (line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return null;
}

const conn = readEnv('.env.dev-isolation.local', 'DEV_SUPABASE_POOLER_SESSION');
if (!conn) { console.error('❌ DEV_SUPABASE_POOLER_SESSION 없음 (.env.dev-isolation.local)'); process.exit(1); }

const SQL = fs.readFileSync('supabase/migrations/20260722120000_foot_reschedule_reemit_for_ids_job.dryrun.sql', 'utf8');

const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const notices = [];
client.on('notice', (n) => { notices.push(n.message); });

let ok = true;
try {
  await client.connect();
  console.log(`✅ DEV DB 연결  ${new Date().toISOString()}`);

  // ── (2) dryrun.sql 실행 (내장 BEGIN..ROLLBACK = 무영속) ──
  try {
    await client.query(SQL);
    console.log('✅ dryrun.sql 실행 완료 (txn ROLLBACK — 무영속)');
  } catch (e) {
    ok = false;
    console.error('❌ dryrun assertion 실패:', e.message);
  }
  for (const m of notices) console.log('   · NOTICE:', m);
  if (ok && !notices.some((m) => m.includes('DRYRUN-OK'))) {
    ok = false; console.error('❌ DRYRUN-OK NOTICE 미발생 — assertion 미도달 의심');
  }

  // ── (3) post-probe: 무영속 재확인 (별 트랜잭션, 함수가 prod 에 남지 않았는지) ──
  const probe = await client.query(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='public' AND p.proname='reemit_reschedule_for_ids'`);
  const n = probe.rows[0].n;
  if (n !== 0) {
    ok = false;
    console.error(`❌ POST-PROBE 실패: reemit_reschedule_for_ids 가 ${n}건 영속됨 (무영속 위반)`);
  } else {
    console.log('✅ POST-PROBE: reemit_reschedule_for_ids 미영속 (pg_proc 0건) — No-Persistence 확인');
  }
} finally {
  await client.end();
}
console.log(ok ? '\n🟢 DRY-RUN PASS' : '\n🔴 DRY-RUN FAIL');
process.exit(ok ? 0 : 1);
