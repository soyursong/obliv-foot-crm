/**
 * DRY-RUN runner: T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL
 * No-Persistence Protocol — §DO(sentinel RAISE 강제 롤백) 실행 + §POST post-probe 무영속 실증.
 * 판정:
 *   §DO   → 'DRYRUN_SENTINEL_OK' 에러로 종료 = 모든 AC PASS + 무영속 롤백. 'AC-x FAIL'=검증실패. 그 외=오류.
 *   §POST → table_absent=true & helper_absent=true = prod 미변경(무영속) 확인.
 * READ/무영속 only. author: dev-foot / 2026-07-13.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t };
}

const doBlock = readFileSync('supabase/migrations/20260713170000_foot_staff_auth_action_audit.dryrun.sql', 'utf8');

console.log('=== §DO (무영속 적용 + AC 검증, sentinel 롤백) ===');
const doRes = await q(doBlock);
console.log(`HTTP ${doRes.status} ok=${doRes.ok}`);
console.log(doRes.body);
const sentinelOk = /DRYRUN_SENTINEL_OK/.test(doRes.body);
const acFail = /AC-\S* FAIL/.test(doRes.body);
console.log(`\n>> §DO verdict: ${sentinelOk ? 'PASS (all AC + no-persist rollback)' : acFail ? 'FAIL (검증 실패)' : 'ERROR (see body)'}`);

console.log('\n=== §POST (post-probe: prod 무영속 실증) ===');
const postSql = `
  SELECT
    (to_regclass('public.staff_auth_action_audit') IS NULL)                               AS table_absent_expected_true,
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='log_staff_auth_action')               AS helper_absent_expected_true,
    (position('log_staff_auth_action' IN pg_get_functiondef('public.admin_reset_user_password(uuid,text)'::regprocedure))=0)
                                                                                            AS reset_rpc_unpatched_expected_true;
`;
const postRes = await q(postSql);
console.log(`HTTP ${postRes.status} ok=${postRes.ok}`);
console.log(postRes.body);
let postOk = false;
try {
  const row = JSON.parse(postRes.body)[0];
  postOk = row.table_absent_expected_true === true
        && row.helper_absent_expected_true === true
        && row.reset_rpc_unpatched_expected_true === true;
} catch { /* body already printed */ }
console.log(`\n>> §POST verdict: ${postOk ? 'PASS (prod unchanged — no persistence)' : 'CHECK body'}`);

console.log(`\n=== OVERALL DRY-RUN: ${sentinelOk && postOk ? 'PASS ✅' : 'REVIEW ⚠'} ===`);
process.exit(sentinelOk && postOk ? 0 : 1);
