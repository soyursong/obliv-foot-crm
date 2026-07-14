// T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH — refund_package_payment 신규 함수 dry-run (MIG-GATE 증거)
// Migration Dry-Run No-Persistence Protocol 준수:
//   · up.sql 에 txn-control 문 없음 → dryrun.sql = BEGIN..ROLLBACK 자체 무영속.
//   · txn 내부 DO $chk$ = 함수/시그니처/SECDEF 실검증, 실패 시 RAISE 'DRYRUN-FAIL' → abort.
//   · pre/post 실재는 독립 API 콜(별 트랜잭션)로 재확인 = sentinel-bypass 차단.
//   · post-probe(별 콜)에서 함수가 남아있으면 = FAIL(영속됨).
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

const existSQL = `SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='refund_package_payment'
) AS fn_e;`;

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

(async () => {
  console.log('── PRE (독립 콜) — 함수 부재 확인(신규 함수, 적용 전 clean) ──');
  const pre = await q(existSQL);
  console.log('  refund_package_payment exists (pre):', pre[0].fn_e);

  console.log('── DRY-RUN (BEGIN..ROLLBACK + 시그니처/SECDEF assertion, dryrun.sql) ──');
  const dryrun = fs.readFileSync('supabase/migrations/20260714200000_foot_refund_package_payment_rpc.dryrun.sql', 'utf8');
  let assertPass = false;
  try {
    await q(dryrun);
    assertPass = true; // DO $chk$ 가 RAISE 안 했으면 시그니처/SECDEF 통과
    console.log('  dryrun 실행 완료 (DRYRUN-OK, RAISE 없음)');
  } catch (e) {
    if (/DRYRUN-FAIL/.test(e.message)) {
      console.log('  ❌ assertion 실패:', e.message.slice(0, 300));
    } else {
      console.log('  ❌ dryrun 오류:', e.message.slice(0, 300));
    }
  }

  console.log('── POST (독립 콜) — 함수 미영속 확인(MUST false = No-Persistence) ──');
  const post = await q(existSQL);
  console.log('  refund_package_payment exists (post):', post[0].fn_e);

  console.log('── 판정 ──');
  chk(pre[0].fn_e === false, 'PRE: 함수 부재(신규 = 적용 전 clean)');
  chk(assertPass === true, 'ASSERT: 함수 생성 + 시그니처(p_payment_id uuid, p_method text) + SECURITY DEFINER 통과');
  chk(post[0].fn_e === false, 'POST: 함수 미영속(No-Persistence, sentinel-bypass 차단)');

  console.log(pass ? '\n✅ DRYRUN PASS (무영속 + 시그니처/SECDEF assertion 통과)' : '\n❌ DRYRUN FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
