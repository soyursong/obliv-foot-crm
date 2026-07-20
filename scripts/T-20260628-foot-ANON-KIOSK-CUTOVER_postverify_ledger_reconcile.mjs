/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER — PART A post-verify + ledger forward-doc reconcile
 *
 * 배경(2026-07-21):
 *   supervisor FIX-REQUEST 는 prod=13-arg(미적용) 전제로 GO 를 내렸으나, 실 prod 조회 결과
 *   fn_selfcheckin_update_personal_info 는 이미 15-arg(p_sms_opt_in/p_customer_email) 로 영속.
 *   → db-gate/..._applied.json 근거: 2026-07-20T21:48:01.760Z 에 L1730_apply.mjs --apply 로 旣적용.
 *   그러나 out-of-band(직접 pg/API) 적용이라 supabase_migrations.schema_migrations 에 20260719160000 미기록(ledger divergence).
 *
 * 본 스크립트(Management API 경유 — 로컬에 prod DB_PASSWORD 부재):
 *   (1) POSTCHECK — 15-arg 영속 + p_sms_opt_in/p_customer_email 존재 + GRANT(anon/auth EXECUTE) 재확인 (fresh, 2026-07-21)
 *   (2) prod fn body ↔ SSOT 파일 정합(핵심 마커) 확인
 *   (3) Ledger forward-doc reconcile — 20260719160000 미존재 시에만 ADDITIVE INSERT (prod 실재=정본, 종이원장 수렴)
 *   (4) applied_at(실적용 시각=7/20 21:48:01.760Z, 旣evidence 계승) + fresh POSTCHECK evidence 산출
 *
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/..._postverify_ledger_reconcile.mjs [--reconcile-ledger]
 *   (--reconcile-ledger 없으면 verify-only, ledger INSERT 미실행)
 * 산출: db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER_postverify_20260721.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const REF = 'rxlomoozakkjesdqjtvd';
const DO_RECONCILE = process.argv.includes('--reconcile-ledger');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || ENV.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 부재'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`query failed ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

const FN = 'fn_selfcheckin_update_personal_info';
const MIG_VERSION = '20260719160000';
const MIG_NAME = 'selfcheckin_update_personal_info_contact_additive';
const MIG_PATH = `supabase/migrations/${MIG_VERSION}_${MIG_NAME}.sql`;

const evidence = {
  ticket: 'T-20260628-foot-ANON-KIOSK-CUTOVER',
  part: 'A (DB migrate prod apply)',
  mig: MIG_PATH,
  note: 'prod 실재 = 이미 15-arg 영속(2026-07-20T21:48:01.760Z 旣적용). 본 실행 = fresh POSTCHECK + ledger forward-doc reconcile.',
  applied_at_original: '2026-07-20T21:48:01.760Z',
  steps: [],
};
const step = (k, v) => { evidence.steps.push({ [k]: v }); console.log(k, '→', JSON.stringify(v)); };

try {
  // (1) POSTCHECK — signature
  const sigs = await q(
    `SELECT lower(pg_get_function_identity_arguments(p.oid)) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='${FN}' ORDER BY 1`,
  );
  const args = sigs.map((r) => r.args);
  const has15 = args.some((a) => a.includes('p_sms_opt_in') && a.includes('p_customer_email'));
  const has13only = args.some((a) => a.includes('p_consent_version') && !a.includes('p_sms_opt_in'));
  step('postcheck_signatures', args);
  step('postcheck_arg_presence', {
    persisted15_MUST_be_true: has15,
    p_sms_opt_in: args.some((a) => a.includes('p_sms_opt_in')),
    p_customer_email: args.some((a) => a.includes('p_customer_email')),
    stale_13arg_present: has13only,
  });

  // (1b) POSTCHECK — grants
  const g = await q(
    `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='${FN}'
        AND pg_get_function_identity_arguments(p.oid) ILIKE '%p_sms_opt_in%'`,
  );
  step('postcheck_grant', g[0] || null);

  // (2) prod body ↔ SSOT 핵심 마커 정합
  const def = await q(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='${FN}'`,
  );
  const body = def[0]?.def || '';
  const bodyOk = body.includes('sms_opt_in_at')
    && body.includes('NULLIF(btrim(p_customer_email)')
    && body.includes('SECURITY DEFINER');
  step('body_ssot_markers', {
    sms_opt_in_at: body.includes('sms_opt_in_at'),
    customer_email_coalesce_nullif_btrim: body.includes('NULLIF(btrim(p_customer_email)'),
    security_definer: body.includes('SECURITY DEFINER'),
    ok: bodyOk,
  });

  // (3) Ledger forward-doc reconcile
  const led = await q(
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${MIG_VERSION}'`,
  );
  const ledgerPresentBefore = led.length > 0;
  step('ledger_before', { present: ledgerPresentBefore, rows: led });

  if (!ledgerPresentBefore && DO_RECONCILE) {
    const migSql = readFileSync(join(REPO, MIG_PATH), 'utf8');
    // BEGIN/COMMIT 제거한 inner SQL 을 statements[0] 로 forward-doc (prod 실재=정본, 재적용 아님)
    const inner = migSql
      .split('\n')
      .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
      .join('\n');
    // $MIG$ 태그(본문 $$ 와 비충돌)로 dollar-quote
    const insertSql =
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) ` +
      `SELECT '${MIG_VERSION}', '${MIG_NAME}', ARRAY[$MIG$${inner}$MIG$] ` +
      `WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${MIG_VERSION}')`;
    await q(insertSql);
    const ledAfter = await q(
      `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${MIG_VERSION}'`,
    );
    step('ledger_forward_doc_insert', { done: true, rows: ledAfter });
  } else if (!ledgerPresentBefore) {
    step('ledger_forward_doc_insert', { done: false, reason: 'verify-only (pass --reconcile-ledger to insert)' });
  } else {
    step('ledger_forward_doc_insert', { done: false, reason: 'already present' });
  }

  const PASS = has15 && !has13only && g[0]?.anon_exec && g[0]?.auth_exec && bodyOk;
  evidence.verdict = PASS ? 'PASS' : 'FAIL';
  step('verdict', evidence.verdict);

  mkdirSync(join(REPO, 'db-gate'), { recursive: true });
  const out = join(REPO, 'db-gate/T-20260628-foot-ANON-KIOSK-CUTOVER_postverify_20260721.json');
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log('\n=== POSTVERIFY', evidence.verdict, '=== →', out);
  process.exit(PASS ? 0 : 1);
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
