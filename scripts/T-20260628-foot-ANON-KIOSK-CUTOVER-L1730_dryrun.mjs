/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER L1730 (DA-ow58) — update_personal_info ADDITIVE dry-run
 *
 * No-Persistence Protocol (sentinel-bypass 차단):
 *   up.sql 의 txn 제어문(BEGIN/COMMIT)을 strip → 러너 제어 트랜잭션에서 실행 → in-txn introspection
 *   (15-arg 생성 확인) → ROLLBACK → post-probe(무영속 검증: 15-arg 부재 + 13-arg 잔존).
 *   COMMIT 가 남아있으면 prod 에 영속되므로 반드시 strip.
 *
 * 실행: node scripts/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_dryrun.mjs
 * 산출: db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_dryrun.json
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const MIG_PATH = 'supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.sql';
const rawSql = readFileSync(join(REPO, MIG_PATH), 'utf8');
// txn 제어문 strip (라인 단위 standalone BEGIN;/COMMIT;)
const strippedSql = rawSql
  .split('\n')
  .filter((l) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(l))
  .join('\n');

const FN = 'fn_selfcheckin_update_personal_info';
// pg_get_function_identity_arguments 는 파라미터명+타입을 반환. 시그니처 판별은 신규 파라미터 존재로.
const is15 = (a) => a.includes('p_sms_opt_in') && a.includes('p_customer_email');
const is13 = (a) => a.includes('p_consent_version') && !a.includes('p_sms_opt_in');
const has = (arr, pred) => arr.some(pred);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const sigs = async () => {
  const { rows } = await client.query(
    `SELECT lower(pg_get_function_identity_arguments(p.oid)) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1 ORDER BY 1`,
    [FN],
  );
  return rows.map((r) => r.args);
};

const evidence = { ticket: 'T-20260628-foot-ANON-KIOSK-CUTOVER', mig: MIG_PATH, steps: [] };
const step = (k, v) => { evidence.steps.push({ [k]: v }); console.log(k, '→', JSON.stringify(v)); };

try {
  await client.connect();

  // strip 검증: COMMIT 가 남아있지 않음
  const hasTxnCtl = /^\s*(BEGIN|COMMIT)\s*;\s*$/im.test(strippedSql);
  step('txn_control_stripped', { ok: !hasTxnCtl });
  if (hasTxnCtl) throw new Error('txn control not stripped — abort (sentinel-bypass hazard)');

  const before = await sigs();
  step('signatures_before', before);
  const has13Before = has(before, is13);
  const has15Before = has(before, is15);
  step('precondition', { has13Before, has15Before });

  // ── 러너 제어 트랜잭션에서 dry-run ──
  await client.query('BEGIN');
  let applyOk = true, applyErr = null;
  try {
    await client.query(strippedSql);
  } catch (e) {
    applyOk = false; applyErr = e.message;
  }
  step('apply_in_txn', { ok: applyOk, error: applyErr });

  const inTxn = await sigs();
  step('signatures_in_txn', inTxn);
  const has15InTxn = has(inTxn, is15);
  const has13InTxn = has(inTxn, is13);
  step('in_txn_assert', { has15InTxn, dropped_old_13: !has13InTxn });

  await client.query('ROLLBACK');
  step('rolled_back', true);

  // ── post-probe: 무영속 검증 (fresh 쿼리) ──
  const after = await sigs();
  step('signatures_after_rollback', after);
  const persisted15 = has(after, is15);
  const restored13 = has(after, is13);
  step('no_persistence_assert', { persisted15_MUST_be_false: persisted15, restored13 });

  const PASS =
    !hasTxnCtl && applyOk && has15InTxn && !has13InTxn && !persisted15 && restored13;
  evidence.verdict = PASS ? 'PASS' : 'FAIL';
  step('verdict', evidence.verdict);

  mkdirSync(join(REPO, 'db-gate'), { recursive: true });
  writeFileSync(
    join(REPO, 'db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_dryrun.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log('\n=== DRY-RUN', evidence.verdict, '===');
  process.exit(PASS ? 0 : 1);
} catch (e) {
  console.error('dry-run error:', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  process.exit(1);
} finally {
  await client.end();
}
