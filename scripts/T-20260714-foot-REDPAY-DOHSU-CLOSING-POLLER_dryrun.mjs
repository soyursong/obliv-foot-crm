// T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER — center 컬럼 마이그 dry-run (MIG-GATE 증거)
// Migration Dry-Run No-Persistence Protocol 준수:
//   · dryrun.sql 은 BEGIN..ROLLBACK 자체 무영속. up.sql 에 txn-control 문 없음.
//   · 여기에 더해 독립 API 콜(별 트랜잭션)로 pre/post 실재를 재확인 = sentinel-bypass 차단.
//   · post-probe(별 콜)에서 center 컬럼이 남아있으면 = FAIL(영속됨) → 즉시 롤백 확인 필요.
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
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const colExistsSQL = `SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payment_reconciliation_log' AND column_name='center') AS exists;`;

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

(async () => {
  console.log('── PRE (독립 콜) — center 컬럼 부재 확인 ──');
  const pre = await q(colExistsSQL);
  const preExists = pre[0].exists;
  console.log('  center exists (pre):', preExists);

  console.log('── DRY-RUN (BEGIN..ROLLBACK, dryrun.sql) ──');
  const dryrun = fs.readFileSync('supabase/migrations/20260714170000_paylog_center_column.dryrun.sql', 'utf8');
  const res = await q(dryrun);
  console.log('  dryrun 실행 결과(last statement rows):', JSON.stringify(res).slice(0, 400));

  console.log('── POST (독립 콜) — center 컬럼 미영속 확인(MUST be false) ──');
  const post = await q(colExistsSQL);
  const postExists = post[0].exists;
  console.log('  center exists (post):', postExists);

  console.log('── 판정 ──');
  chk(preExists === false, 'PRE: center 컬럼 부재(적용 전 clean)');
  chk(postExists === false, 'POST: center 컬럼 미영속(dry-run 무영속 = No-Persistence 증명)');

  // 실제 backfill 회귀검증: 현재 로그 행수(적용 후 전량 foot 될 대상)
  const cnt = await q(`SELECT count(*)::int AS n FROM public.payment_reconciliation_log;`);
  console.log('  현재 payment_reconciliation_log 행수(적용 시 전량 center=foot backfill 대상):', cnt[0].n);

  console.log(pass ? '\n✅ DRYRUN PASS (무영속)' : '\n❌ DRYRUN FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
