/**
 * T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE — PROD(rxlomooz) APPLY 러너
 *
 * supervisor QA-PASS(MSG-20260722-140154-0ui9) 잔여 핸드오프:
 *   1) PROD apply up.sql (dev-foot 직접)
 *   2) apply-time prod ledger 권위 대조(schema_migrations) + POSTCHECK
 *      (pg_proc reemit_reschedule_for_ids 실존·시그니처·SECURITY DEFINER·grants=service_role only)
 *   3) applied_at 실시각 기록 → status: deployed
 *
 * 경로 = Supabase Management API /v1/projects/{ref}/database/query (기존 foot prod apply 패턴).
 * 실행: SUPABASE_ACCESS_TOKEN=... node scripts/T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE_prod_apply.mjs [--commit]
 *   (--commit 없으면 PREFLIGHT 만 수행하고 apply 안 함)
 */
import fs from 'node:fs';

const PROJ_REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const VERSION = '20260722120000';
const MIG_NAME = 'foot_reschedule_reemit_for_ids_job';
const UP_SQL_PATH = 'supabase/migrations/20260722120000_foot_reschedule_reemit_for_ids_job.sql';
const COMMIT = process.argv.includes('--commit');

function envFromFile(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    if (line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return null;
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || envFromFile('.env.local', 'SUPABASE_ACCESS_TOKEN');
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }

async function q(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    console.error('❌ query 실패:', resp.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

const PROBE_FN = `
SELECT count(*)::int AS n
  FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
 WHERE nsp.nspname='public' AND p.proname='reemit_reschedule_for_ids';`;

const LEDGER_MAX = `
SELECT max(version) AS max_version, count(*)::int AS n
  FROM supabase_migrations.schema_migrations;`;

const LEDGER_THIS = `
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version = '${VERSION}';`;

console.log(`🚀 T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE PROD apply (ref=${PROJ_REF}) mode=${COMMIT ? 'COMMIT' : 'PREFLIGHT-only'}  ${new Date().toISOString()}`);

// ── 1. PREFLIGHT ─────────────────────────────────────────────────────────────
console.log('\n[PREFLIGHT]');
const preFn = (await q(PROBE_FN)).result?.[0] ?? (await q(PROBE_FN))[0];
console.log('  · pg_proc reemit_reschedule_for_ids (pre) =', JSON.stringify(preFn));
const ledgerMax = await q(LEDGER_MAX);
console.log('  · schema_migrations max/n =', JSON.stringify(ledgerMax.result ?? ledgerMax));
const ledgerThis = await q(LEDGER_THIS);
console.log('  · schema_migrations[this version] =', JSON.stringify(ledgerThis.result ?? ledgerThis));

const preN = (preFn.n !== undefined) ? preFn.n : preFn[Object.keys(preFn)[0]];
const thisRows = (ledgerThis.result ?? ledgerThis);
if (Array.isArray(thisRows) && thisRows.length > 0) {
  console.error(`\n⚠️ ledger 에 이미 ${VERSION} 존재 — 이미 apply 됨? 중단.`);
  process.exit(2);
}
if (preN !== 0) {
  console.error(`\n⚠️ reemit_reschedule_for_ids 가 이미 prod 에 ${preN}건 존재 — ADDITIVE 신규 가정 위반. 중단.`);
  process.exit(2);
}
console.log('  ✅ PREFLIGHT: 함수 부재(0) + ledger 미등재 — ADDITIVE 신규 정합.');

if (!COMMIT) {
  console.log('\n🟡 PREFLIGHT-only (--commit 없음). apply 미수행.');
  process.exit(0);
}

// ── 2. APPLY up.sql (내장 BEGIN..COMMIT) ─────────────────────────────────────
console.log('\n[APPLY]');
const upSql = fs.readFileSync(UP_SQL_PATH, 'utf8');
await q(upSql);
const appliedAt = new Date().toISOString();
console.log(`  ✅ up.sql 적용 완료  applied_at=${appliedAt}`);

// ── 3. LEDGER 기록 (권위 대조 = schema_migrations 등재) ──────────────────────
const ledgerInsert = `
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('${VERSION}', '${MIG_NAME}',
  ARRAY['-- T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE reemit_reschedule_for_ids (ADDITIVE fn) applied via mgmt-API ${appliedAt}'])
ON CONFLICT (version) DO NOTHING;`;
await q(ledgerInsert);
console.log('  ✅ schema_migrations ledger 등재 (ON CONFLICT DO NOTHING)');

// ── 4. POSTCHECK ─────────────────────────────────────────────────────────────
console.log('\n[POSTCHECK]');
const POST = `
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid)      AS args,
  pg_get_function_result(p.oid)                  AS result_type,
  p.prosecdef                                    AS security_definer,
  p.proconfig                                    AS config,
  (SELECT array_agg(g.grantee ORDER BY g.grantee)
     FROM information_schema.role_routine_grants g
    WHERE g.specific_schema='public'
      AND g.routine_name='reemit_reschedule_for_ids'
      AND g.privilege_type='EXECUTE')            AS execute_grantees
FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
WHERE nsp.nspname='public' AND p.proname='reemit_reschedule_for_ids';`;
const post = await q(POST);
const rows = post.result ?? post;
console.log(JSON.stringify(rows, null, 2));

const r = Array.isArray(rows) ? rows[0] : null;
let pass = true;
const check = (cond, label) => { console.log(`  ${cond ? '✅' : '❌'} ${label}`); if (!cond) pass = false; };
check(!!r, '함수 실존(pg_proc 1건)');
if (r) {
  check(/uuid\[\].*text.*boolean/i.test(r.args), `시그니처 = (${r.args})`);
  check(r.security_definer === true, 'SECURITY DEFINER = true');
  const cfg = (r.config || []).join(',');
  check(/search_path=public/.test(cfg) && /pg_temp/.test(cfg), `search_path 하드닝 = ${cfg}`);
  const grantees = (r.execute_grantees || []).filter(Boolean);
  check(grantees.length === 1 && grantees[0] === 'service_role',
        `EXECUTE grants = [${grantees.join(', ')}] (service_role only)`);
}

console.log(pass ? `\n🟢 PROD APPLY + POSTCHECK PASS  applied_at=${appliedAt}` : '\n🔴 POSTCHECK FAIL');
if (pass) { console.log(`APPLIED_AT=${appliedAt}`); }
process.exit(pass ? 0 : 1);
