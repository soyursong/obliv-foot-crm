/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER L1730 (DA-ow58) — update_personal_info ADDITIVE PROD apply
 *
 * DDL-ATOMIC v1.7:
 *   (1) precheck 시그니처(13-arg 존재 / 15-arg 부재)
 *   (2) 실적용 — 마이그 파일 자체 BEGIN..COMMIT(원자적 단일 txn) 그대로 실행 → COMMIT 영속
 *   (3) applied_at 캡처(서버 now())
 *   (4) POSTCHECK — 15-arg 영속 확인 + 13-arg drop 확인 + GRANT(anon/authenticated EXECUTE) 확인
 *   (5) rollback 유효성 검증 — 폐기용 txn 내에서 rollback.sql(strip) 실행 → 13-arg 복원 확인 → ROLLBACK
 *       (prod 는 15-arg 유지, 롤백 SQL 이 실제로 canonical 13-arg 을 복원함만 증명)
 *
 * 실행: node scripts/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_apply.mjs --apply
 *   (--apply 없으면 precheck 만)
 * 산출: db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_applied.json
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const DO_APPLY = process.argv.includes('--apply');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const MIG_PATH = 'supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.sql';
const RB_PATH = 'supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.rollback.sql';
const migSql = readFileSync(join(REPO, MIG_PATH), 'utf8');
const rbRaw = readFileSync(join(REPO, RB_PATH), 'utf8');
// rollback 은 폐기 txn 안에서 돌리므로 자체 BEGIN/COMMIT strip (러너 txn 제어)
const rbStripped = rbRaw
  .split('\n')
  .filter((l) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(l))
  .join('\n');

const FN = 'fn_selfcheckin_update_personal_info';
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

// 15-arg oid 기준 GRANT 확인
const grants = async () => {
  const { rows } = await client.query(
    `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1
        AND pg_get_function_identity_arguments(p.oid) ILIKE '%p_sms_opt_in%'`,
    [FN],
  );
  return rows[0] || null;
};

const evidence = { ticket: 'T-20260628-foot-ANON-KIOSK-CUTOVER', mig: MIG_PATH, mode: DO_APPLY ? 'APPLY' : 'PRECHECK', steps: [] };
const step = (k, v) => { evidence.steps.push({ [k]: v }); console.log(k, '→', JSON.stringify(v)); };

try {
  await client.connect();

  const before = await sigs();
  step('signatures_before', before);
  const has13Before = has(before, is13);
  const has15Before = has(before, is15);
  step('precondition', { has13Before, has15Before });

  if (!has13Before && !has15Before) throw new Error('function absent — abort (unexpected prod state)');

  if (!DO_APPLY) {
    step('note', 'PRECHECK only — pass --apply to persist');
    writeFileSync(join(REPO, 'db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_precheck.json'), JSON.stringify(evidence, null, 2));
    process.exit(0);
  }

  // ── 실적용 (마이그 파일 자체 BEGIN..COMMIT = 원자적) ──
  const { rows: t0 } = await client.query('SELECT now() AS ts');
  await client.query(migSql);
  const { rows: t1 } = await client.query('SELECT now() AS ts');
  const appliedAt = t1[0].ts;
  step('applied', { ok: true, applied_at: appliedAt, apply_started: t0[0].ts });

  // ── POSTCHECK (fresh 쿼리, COMMIT 이후 영속 확인) ──
  const after = await sigs();
  step('signatures_after', after);
  const persisted15 = has(after, is15);
  const dropped13 = !has(after, is13);
  step('postcheck_signature', { persisted15_MUST_be_true: persisted15, dropped_old_13: dropped13 });

  const g = await grants();
  step('postcheck_grant', g);

  // ── rollback 유효성 (폐기 txn — prod 15-arg 유지) ──
  await client.query('BEGIN');
  let rbOk = true, rbErr = null;
  try { await client.query(rbStripped); } catch (e) { rbOk = false; rbErr = e.message; }
  const rbSigs = await sigs();
  const rbRestored13 = has(rbSigs, is13) && !has(rbSigs, is15);
  await client.query('ROLLBACK');
  step('rollback_validity', { apply_ok: rbOk, error: rbErr, restores_13arg: rbRestored13 });

  // prod 가 여전히 15-arg 인지 (롤백 검증 txn 이 prod 를 훼손하지 않았음)
  const finalSigs = await sigs();
  step('final_prod_signature', { still_15arg: has(finalSigs, is15), args: finalSigs });

  const PASS = persisted15 && dropped13 && g && g.anon_exec && g.auth_exec && rbOk && rbRestored13 && has(finalSigs, is15);
  evidence.verdict = PASS ? 'PASS' : 'FAIL';
  evidence.applied_at = appliedAt;
  step('verdict', evidence.verdict);

  mkdirSync(join(REPO, 'db-gate'), { recursive: true });
  writeFileSync(join(REPO, 'db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER-L1730_applied.json'), JSON.stringify(evidence, null, 2));
  console.log('\n=== APPLY', evidence.verdict, '===');
  process.exit(PASS ? 0 : 1);
} catch (e) {
  console.error('apply error:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
