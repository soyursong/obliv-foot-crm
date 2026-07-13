/**
 * DRY-RUN runner: T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1
 * No-Persistence Protocol — DO 블록(sentinel RAISE 강제 롤백) 실행 + post-probe 로 prod 무영속 실증.
 * 판정:
 *   §DO  → 'DRYRUN_SENTINEL_OK' 에러로 종료 = accept/reject/guard 全 PASS + 무영속 롤백.
 *          'ACCEPT-FAIL'/'REJECT-FAIL'/'GUARD-FAIL' = 기능 결함. 그 외 = DDL 오류.
 *   §POST→ old_guard_still_present=true & new_intl_branch_present=false = prod 미변경(무영속) 확인.
 * READ/무영속 only. author: dev-foot / 2026-07-13.
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const tok = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

const full = readFileSync('supabase/migrations/20260713160000_foot_phone_e164_chk_expr_fix.dryrun.sql', 'utf8');
const doEnd = full.indexOf('$dry$;') + '$dry$;'.length;
const doBlock = full.slice(0, doEnd);
const postSql = full.slice(full.indexOf('SELECT', doEnd));

console.log('=== §DO (무영속 적용 + accept/reject 검증, sentinel 롤백) ===');
const doRes = await q(doBlock);
console.log(`HTTP ${doRes.status} ok=${doRes.ok}`);
console.log(doRes.body);
const sentinelOk = /DRYRUN_SENTINEL_OK/.test(doRes.body);
const funcFail = /ACCEPT-FAIL|REJECT-FAIL|GUARD-FAIL/.test(doRes.body);
console.log(`\n>> §DO verdict: ${sentinelOk ? 'PASS (all accept/reject/guard + no-persist rollback)' : funcFail ? 'FAIL (functional defect)' : 'ERROR (see body)'}`);

console.log('\n=== §POST (post-probe: prod 무영속 실증) ===');
const postRes = await q(postSql);
console.log(`HTTP ${postRes.status} ok=${postRes.ok}`);
console.log(postRes.body);
let postOk = false;
try {
  const rows = JSON.parse(postRes.body);
  const row = Array.isArray(rows) ? rows[0] : (rows.result?.[0] ?? rows);
  postOk = row.old_guard_still_present_expected_true === true && row.new_intl_branch_present_expected_false === false;
} catch (e) {}
console.log(`\n>> §POST verdict: ${postOk ? 'PASS (prod unchanged — no persistence)' : 'CHECK body'}`);

console.log(`\n=== OVERALL DRY-RUN: ${sentinelOk && postOk ? 'PASS ✅' : 'REVIEW ⚠'} ===`);
process.exit(sentinelOk && postOk ? 0 : 1);
