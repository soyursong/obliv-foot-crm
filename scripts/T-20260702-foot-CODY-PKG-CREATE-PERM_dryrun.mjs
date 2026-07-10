/**
 * T-20260702-foot-CODY-PKG-CREATE-PERM — in-txn DRY-RUN (비파괴)
 * BEGIN → DELETE(app → auth.users cascade) → post-count SELECT → ROLLBACK.
 * pre-count guard(=1) + post-count(=0, in-txn) + rollback 후 총계 불변(=47) 검증.
 * 산출: db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_dryrun.log
 */
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];
const TARGET_ID = 'd4c83d20-e8d6-4918-97ce-2cce68d444ae';
const T = `'${TARGET_ID}'`;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`SQL → ${r.status} ${await r.text()}`);
  return r.json();
}

const lines = [];
const out = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };

out('═══ T-20260702 계정삭제 DRY-RUN (in-txn ROLLBACK) ═══');
out('stamp: 20260710 / target:', TARGET_ID, 'kyh3858@hanmail.net');

// PRE
const pre = await sql(`SELECT
  (SELECT count(*)::int FROM public.user_profiles WHERE id=${T}) AS up_target,
  (SELECT count(*)::int FROM auth.users          WHERE id=${T}) AS au_target,
  (SELECT count(*)::int FROM auth.identities      WHERE user_id=${T}) AS id_target,
  (SELECT count(*)::int FROM auth.one_time_tokens WHERE user_id=${T}) AS ott_target,
  (SELECT count(*)::int FROM public.user_profiles) AS up_total,
  (SELECT count(*)::int FROM auth.users) AS au_total;`);
const P = pre[0];
out('\n[PRE-COUNT]');
out('  user_profiles(target) =', P.up_target, '(guard: =1)');
out('  auth.users(target)    =', P.au_target, '(guard: =1)');
out('  auth.identities(target)=', P.id_target);
out('  auth.one_time_tokens(target)=', P.ott_target);
out('  user_profiles TOTAL   =', P.up_total);
out('  auth.users TOTAL      =', P.au_total);
const preOK = P.up_target === 1 && P.au_target === 1;
out('  PRE guard:', preOK ? '✅ (target 정확히 1행)' : '❌ ABORT');
if (!preOK) { fs.writeFileSync('db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_dryrun.log', lines.join('\n')); process.exit(2); }

// DRY-RUN TX: delete + post-count + ROLLBACK (마지막 SELECT 결과가 반환됨)
const post = await sql(`BEGIN;
DELETE FROM public.user_profiles WHERE id=${T};
DELETE FROM auth.users WHERE id=${T};
SELECT
  (SELECT count(*)::int FROM public.user_profiles WHERE id=${T}) AS up_target,
  (SELECT count(*)::int FROM auth.users          WHERE id=${T}) AS au_target,
  (SELECT count(*)::int FROM auth.identities      WHERE user_id=${T}) AS id_target,
  (SELECT count(*)::int FROM auth.one_time_tokens WHERE user_id=${T}) AS ott_target,
  (SELECT count(*)::int FROM public.user_profiles) AS up_total,
  (SELECT count(*)::int FROM auth.users) AS au_total;
ROLLBACK;`);
const Q = post[0];
out('\n[IN-TXN POST-COUNT] (DELETE app→auth.users cascade, ROLLBACK 직전)');
out('  user_profiles(target) =', Q.up_target, '(기대: 0)');
out('  auth.users(target)    =', Q.au_target, '(기대: 0)');
out('  auth.identities(target)=', Q.id_target, '(기대: 0, CASCADE)');
out('  auth.one_time_tokens(target)=', Q.ott_target, '(기대: 0, CASCADE)');
out('  user_profiles TOTAL   =', Q.up_total, `(기대: ${P.up_total - 1}, diff=1)`);
out('  auth.users TOTAL      =', Q.au_total, `(기대: ${P.au_total - 1}, diff=1)`);
const postOK = Q.up_target === 0 && Q.au_target === 0 && Q.id_target === 0 && Q.ott_target === 0
  && Q.up_total === P.up_total - 1 && Q.au_total === P.au_total - 1;
out('  POST(in-txn):', postOK ? '✅ 삭제·cascade·freeze diff=1 모두 부합' : '❌ 기대 불일치');

// ROLLBACK 검증: 총계 불변 (비파괴 증명)
const after = await sql(`SELECT
  (SELECT count(*)::int FROM public.user_profiles) AS up_total,
  (SELECT count(*)::int FROM auth.users) AS au_total,
  (SELECT count(*)::int FROM public.user_profiles WHERE id=${T}) AS up_target;`);
const A = after[0];
out('\n[ROLLBACK 후 재확인] (비파괴 증명)');
out('  user_profiles TOTAL   =', A.up_total, `(기대: ${P.up_total} 불변)`);
out('  auth.users TOTAL      =', A.au_total, `(기대: ${P.au_total} 불변)`);
out('  user_profiles(target) =', A.up_target, '(기대: 1 여전 존재)');
const rollbackOK = A.up_total === P.up_total && A.au_total === P.au_total && A.up_target === 1;
out('  ROLLBACK:', rollbackOK ? '✅ 총계 불변·target 잔존 → DRY-RUN 비파괴 확인' : '❌ 데이터 변경됨! 즉시 조사');

out('\n═══ DRY-RUN 결과:', (preOK && postOK && rollbackOK) ? '✅ PASS (apply 준비완료, 게이트 통과 후 실행)' : '❌ FAIL', '═══');
fs.writeFileSync('db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_dryrun.log', lines.join('\n') + '\n');
console.log('\n로그 저장 → db-gate/T-20260702-foot-CODY-PKG-CREATE-PERM_dryrun.log');
if (!(preOK && postOK && rollbackOK)) process.exit(2);
