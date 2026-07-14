// T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT — 뷰+role dry-run (MIG-GATE 증거)
// Migration Dry-Run No-Persistence Protocol 준수:
//   · dryrun.sql = BEGIN..ROLLBACK 자체 무영속. up.sql 에 txn-control 문 없음.
//   · 보안 assertion(A~D)은 dryrun.sql DO 블록에서 실패 시 RAISE EXCEPTION → 배치 abort(여기서 FAIL 감지).
//   · 독립 API 콜(별 트랜잭션)로 pre/post 실재 재확인 = sentinel-bypass 차단.
//   · post-probe(별 콜)에서 뷰/role 이 남아있으면 = FAIL(영속됨).
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(text); e.http = r.status; throw e; }
  return JSON.parse(text);
}

const existSQL = `SELECT
  EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_redpay_reconciliation_body') AS view_e,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='body_recon_ro') AS role_e;`;

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

(async () => {
  console.log('── PRE (독립 콜) — 뷰/role 부재 확인 ──');
  const pre = await q(existSQL);
  console.log('  view exists (pre):', pre[0].view_e, '| role exists (pre):', pre[0].role_e);

  console.log('── DRY-RUN (BEGIN..ROLLBACK + 보안 assertion, dryrun.sql) ──');
  const dryrun = fs.readFileSync('supabase/migrations/20260714210000_redpay_body_recon_view_grant.dryrun.sql', 'utf8');
  let assertPass = false;
  try {
    const res = await q(dryrun);
    assertPass = true; // DO 블록이 RAISE 안 했으면 A~D 통과
    console.log('  dryrun 실행 결과(post-probe rows):', JSON.stringify(res).slice(0, 500));
  } catch (e) {
    if (/DRYRUN-FAIL/.test(e.message)) {
      console.log('  ❌ 보안 assertion 실패:', e.message.slice(0, 300));
    } else {
      console.log('  ❌ dryrun 오류:', e.message.slice(0, 300));
    }
  }

  console.log('── POST (독립 콜) — 뷰/role 미영속 확인(MUST false) ──');
  const post = await q(existSQL);
  console.log('  view exists (post):', post[0].view_e, '| role exists (post):', post[0].role_e);

  console.log('── 판정 ──');
  chk(pre[0].view_e === false && pre[0].role_e === false, 'PRE: 뷰/role 부재(적용 전 clean)');
  chk(assertPass === true, 'ASSERT: A(리터럴)·B(center미노출)·C(body노출/foot미도달)·D(grant격리) 전부 통과');
  chk(post[0].view_e === false, 'POST: 뷰 미영속(No-Persistence)');
  chk(post[0].role_e === false, 'POST: role 미영속(No-Persistence)');

  console.log(pass ? '\n✅ DRYRUN PASS (무영속 + 격리 assertion 통과)' : '\n❌ DRYRUN FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
