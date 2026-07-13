/**
 * DRY-RUN runner: T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD
 * No-Persistence Protocol — DO 블록(sentinel RAISE 강제 롤백) 실행 + post-probe 로 prod 무영속 실증.
 * 판정:
 *   §DO  → 'DRYRUN_SENTINEL_OK' 에러로 종료 = 모든 AC PASS + 무영속 롤백. 'AC-x FAIL'=회귀. 그 외=오류.
 *   §POST→ old_case_still_present=true & new_clause_present=false = prod 미변경(무영속) 확인.
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

const full = readFileSync('supabase/migrations/20260713150000_foot_rpc_upsert_name_never_downgrade_guard.dryrun.sql', 'utf8');
// split §DO (DO $dry$...$dry$;) from §POST (trailing SELECT)
const doEnd = full.indexOf('$dry$;') + '$dry$;'.length;
const doBlock = full.slice(0, doEnd);
const postBlock = full.slice(doEnd).split('-- §POST').pop().replace(/^[^\n]*\n/, ''); // strip comment header lines
const postSql = full.slice(full.indexOf('SELECT', doEnd));

console.log('=== §DO (무영속 적용 + AC 검증, sentinel 롤백) ===');
const doRes = await q(doBlock);
console.log(`HTTP ${doRes.status} ok=${doRes.ok}`);
console.log(doRes.body);
const sentinelOk = /DRYRUN_SENTINEL_OK/.test(doRes.body);
const acFail = /AC-\S* FAIL|AC-scope3 FAIL/.test(doRes.body);
console.log(`\n>> §DO verdict: ${sentinelOk ? 'PASS (all AC + no-persist rollback)' : acFail ? 'FAIL (functional regression)' : 'ERROR (see body)'}`);

console.log('\n=== §POST (post-probe: prod 무영속 실증) ===');
const postRes = await q(postSql);
console.log(`HTTP ${postRes.status} ok=${postRes.ok}`);
console.log(postRes.body);
let postOk = false;
try {
  const rows = JSON.parse(postRes.body);
  const row = rows[0];
  postOk = row.old_case_still_present_expected_true === true && row.new_clause_present_expected_false === false;
} catch (e) {}
console.log(`\n>> §POST verdict: ${postOk ? 'PASS (prod unchanged — no persistence)' : 'CHECK body'}`);

console.log(`\n=== OVERALL DRY-RUN: ${sentinelOk && postOk ? 'PASS ✅' : 'REVIEW ⚠'} ===`);
