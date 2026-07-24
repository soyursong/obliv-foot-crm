/**
 * T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — Opt-B′ DRY-RUN (무영속)
 *
 * Migration Dry-Run No-Persistence Protocol 준수:
 *   ① pre-probe (READ-ONLY): 현 registry 상태 + 7/23 raw 가시성.
 *   ② trial-apply: up.sql 전문을 BEGIN … ROLLBACK 로 실행 → SQL 무오류 검증 + 무영속.
 *   ③ post-probe (READ-ONLY): superseded_tids 컬럼·285002 행 부재 재확인(무영속 확증).
 *   ④ forecast (READ-ONLY): Opt-B′ 결과 tid-membership(32-set) 하에서 7/23 foot 가시행 예측
 *      → historical(구 TID) 무탈락 확인. 신 TID 실적재는 배포 후 AC-2 재pull 로 회복.
 *
 * ⚠ 영속 write 0. 실행: node supabase/migrations/20260724170000_redpay_foot_registry_0723gap_optbprime.dryrun.mjs
 */
import { readFileSync } from 'node:fs';

const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const UP = '/Users/domas/GitHub/obliv-foot-crm/supabase/migrations/20260724170000_redpay_foot_registry_0723gap_optbprime.sql';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const GAP_MERCH = ['1777285001', '1777285002', '1777285003', '1777285005', '1777285006', '1777285007'];
// Opt-B′ 결과 예상 tid-membership: 원 26 TID(5 swap) ∪ 신 6 TID.
const NEW_TIDS = ['1047535845', '1047535843', '1047535842', '1047535837', '1047535835', '1047535797'];

console.log('════ 0723GAP Opt-B′ DRY-RUN (무영속) ════\n');

// ── ① pre-probe (READ-ONLY) ──
const pre = await q(`
  SELECT
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active) AS foot_active,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND merchant_id='1777285002') AS has_285002`);
console.log('① pre-probe:', JSON.stringify(pre[0]));
console.log('   기대: foot_active=26, has_superseded_col=0, has_285002=0\n');

const preTids = await q(`
  SELECT merchant_id, tid
  FROM redpay_terminal_registry
  WHERE domain='foot' AND merchant_id = ANY(ARRAY[${GAP_MERCH.map((m) => `'${m}'`).join(',')}])
  ORDER BY merchant_id`);
console.log('   gap merchant 현 tid:', JSON.stringify(preTids));

// ── ② trial-apply (BEGIN … ROLLBACK, 무영속) ──
const upBody = readFileSync(UP, 'utf8');
console.log('\n② trial-apply: up.sql 전문 BEGIN…ROLLBACK 실행(무오류 검증)...');
await q(`BEGIN;\n${upBody}\nROLLBACK;`);
console.log('   ✅ 무오류 실행 + ROLLBACK 완료(영속 0).');

// ── ③ post-probe (무영속 확증) ──
const post = await q(`
  SELECT
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active) AS foot_active,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND merchant_id='1777285002') AS has_285002`);
console.log('\n③ post-probe(무영속 확증):', JSON.stringify(post[0]));
const clean = post[0].foot_active === 26 && Number(post[0].has_superseded_col) === 0 && Number(post[0].has_285002) === 0;
console.log(`   무영속 ${clean ? '✅ PASS' : '❌ FAIL — 영속 흔적!'}(foot=26, col=0, 285002=0 기대)\n`);

// ── ④ forecast (READ-ONLY): Opt-B′ 결과 하 7/23 foot 가시행 예측 ──
const fc = await q(`
  WITH foot27 AS (
    SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active
    UNION SELECT '1777285002'
  ),
  tid32 AS (
    SELECT tid FROM redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL
    UNION SELECT unnest(ARRAY[${NEW_TIDS.map((t) => `'${t}'`).join(',')}])
  )
  SELECT
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-07-23'
         AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id')
             IN (SELECT merchant_id FROM foot27)) AS raw_0723_foot_merchant,
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-07-23'
         AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id')
             IN (SELECT merchant_id FROM foot27)
         AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM tid32)) AS visible_optbprime,
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id')
             IN ('1777285001','1777285003','1777285005','1777285006','1777285007')
         AND r.tid IN ('1047479255','1047479254','1047479268','1047479262','1047479263')) AS historical_old_tid_rows`);
console.log('④ forecast(READ-ONLY, Opt-B′ 결과 예측):', JSON.stringify(fc[0]));
console.log('   · raw_0723_foot_merchant = 현 raw 중 7/23 foot merchant 행(신 TID 미적재 상태)');
console.log('   · visible_optbprime = Opt-B′ tid-membership(32-set) 하 가시행');
console.log('   · historical_old_tid_rows = 구 TID historical(7/11~14) 보존행 → superseded UNION 으로 무탈락 확증');
console.log('\n   ⇒ 신 TID(1047535xxx) 실행 회복분은 배포 후 AC-2 daily_full 7/23 재pull 로 적재.');
console.log('\n════ DRY-RUN 종료 ════');
