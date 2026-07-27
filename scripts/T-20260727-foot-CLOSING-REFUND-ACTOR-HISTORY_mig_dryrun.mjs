/**
 * T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY — MIG-GATE dry-run (no-persistence + post-probe)
 * 전략: 20260727210000_..._package_payments_created_by.dryrun.sql(BEGIN..assert..ROLLBACK)을 prod에
 *   실행 → 무영속 검증. 이후 별 트랜잭션(post-probe)에서 created_by 컬럼/인덱스 부재 + RPC 미변경 재확인
 *   (Migration Dry-Run No-Persistence Protocol: sentinel-bypass 차단).
 * author: dev-foot / 2026-07-27
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
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

const dryrunSql = readFileSync('supabase/migrations/20260727210000_foot_package_payments_created_by.dryrun.sql', 'utf8');

(async () => {
  // 1) dry-run 실행 — BEGIN..assert..ROLLBACK. assertion 통과 시 NOTICE, 실패 시 DRYRUN-FAIL RAISE.
  console.log('── STEP 1: dry-run (no-persistence, BEGIN..assert..ROLLBACK) ──');
  const dr = await q(dryrunSql);
  console.log('HTTP', dr.status, dr.ok ? 'OK' : 'ERR');
  console.log(dr.body.slice(0, 800));
  if (!dr.ok) {
    // RAISE EXCEPTION(DRYRUN-FAIL) 또는 구문오류. DRYRUN-FAIL 이면 assertion 실패로 abort.
    console.error('❌ dry-run failed (see body).');
    process.exit(1);
  }

  // 2) post-probe — 별 트랜잭션에서 무영속 확인
  console.log('\n── STEP 2: post-probe (무영속 재확인) ──');
  const col = JSON.parse((await q(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='package_payments' AND column_name='created_by';`
  )).body);
  const idx = JSON.parse((await q(
    `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND tablename='package_payments' AND indexname='idx_package_payments_created_by';`
  )).body);
  const rpc = JSON.parse((await q(
    `SELECT count(*)::int AS n FROM pg_proc WHERE proname='refund_package_payment' AND prosrc LIKE '%created_by%';`
  )).body);
  console.log('package_payments.created_by col count (expect 0):', col[0].n);
  console.log('idx_package_payments_created_by count (expect 0):', idx[0].n);
  console.log('refund_package_payment has created_by in body (expect 0):', rpc[0].n);

  const persisted = col[0].n !== 0 || idx[0].n !== 0 || rpc[0].n !== 0;
  if (persisted) {
    console.error('\n❌ POST-PROBE FAIL: dry-run 이 prod 에 영속됨 (sentinel-bypass hazard). 즉시 rollback 필요.');
    process.exit(2);
  }
  console.log('\n✅ DRYRUN-PASS + POST-PROBE clean (무영속 확정). 대상 컬럼/인덱스/RPC 미변경.');
})();
