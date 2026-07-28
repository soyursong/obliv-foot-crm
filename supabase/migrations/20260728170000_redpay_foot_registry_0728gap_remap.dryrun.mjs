/**
 * T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 0728 GAP superseded-remap DRY-RUN (무영속)
 *
 * Migration Dry-Run No-Persistence Protocol 준수:
 *   ① pre-probe (READ-ONLY): superseded_tids 컬럼 실재 + 2 merchant 현재 tid=479xxx / superseded=NULL.
 *   ② trial-apply: up.sql 전문을 BEGIN … ROLLBACK(sentinel) 로 실행 → SQL 무오류 + rows-affected + 무영속.
 *   ③ post-probe (READ-ONLY): 2 merchant tid 여전히 479xxx (영속 0 확증).
 *   ④ forecast (READ-ONLY): 신 2 TID 편입 시 7/27~28 gap 소급 표면화 예측(뷰 semantics = r.tid membership).
 *
 * ⚠ 순수 data-lane UPDATE(신규 DDL 0). 영속 write 0. PENDING DA GO — GO 전까지 실행 보류.
 * 실행: node supabase/migrations/20260728170000_redpay_foot_registry_0728gap_remap.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
const UP = join(here, '20260728170000_redpay_foot_registry_0728gap_remap.sql');

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

const MERCH = ['1777289006', '1777288008'];
const NEW_TIDS = ['1047538239', '1047538246'];
const OLD_TIDS = ['1047479480', '1047479475'];
const arr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(',')}]`;

console.log('════ 0728GAP superseded-remap DRY-RUN (무영속) ════\n');

// ── ① pre-probe (READ-ONLY) ──
const pre = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE domain='foot' AND merchant_id = ANY(${arr(MERCH)})
         AND tid = ANY(${arr(OLD_TIDS)}) AND active) AS two_at_old_tid,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE tid = ANY(${arr(NEW_TIDS)})
          OR superseded_tids && ${arr(NEW_TIDS)}) AS new_tids_present`);
console.log('① pre-probe:', JSON.stringify(pre[0]));
console.log('   기대: has_superseded_col=1, two_at_old_tid=2, new_tids_present=0\n');

const preRows = await q(`
  SELECT merchant_id, tid, superseded_tids
  FROM redpay_terminal_registry
  WHERE domain='foot' AND merchant_id = ANY(${arr(MERCH)})
  ORDER BY merchant_id`);
console.log('   2 merchant 현 상태:', JSON.stringify(preRows));

// ── ② trial-apply (BEGIN … ROLLBACK sentinel, 무영속) ──
const upBody = readFileSync(UP, 'utf8');
console.log('\n② trial-apply: up.sql 전문 BEGIN…ROLLBACK 실행(무오류 + rows-affected)...');
const trial = await q(`
DO $dryrun$
DECLARE
  v_affected int;
  v_new int;
BEGIN
  ${upBody.replace(/\$dryrun\$/g, '$inner$')}
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  SELECT count(*) INTO v_new FROM public.redpay_terminal_registry
    WHERE domain='foot' AND tid = ANY(${arr(NEW_TIDS)});
  RAISE NOTICE 'DRYRUN rows_affected=% new_tid_rows_in_txn=%', v_affected, v_new;
  RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL(무영속 강제 unwind, affected=% new=%)', v_affected, v_new;
END
$dryrun$;`).catch((e) => {
  const msg = String(e.message || e);
  if (msg.includes('DRYRUN_ROLLBACK_SENTINEL')) { console.log('   ✅ sentinel unwind:', msg.match(/DRYRUN_ROLLBACK_SENTINEL[^"]*/)?.[0] || 'ok'); return 'SENTINEL'; }
  throw e;
});
if (trial !== 'SENTINEL') throw new Error('무영속 sentinel 미발화 — dry-run 무결성 실패');

// ── ③ post-probe (무영속 확증) ──
const post = await q(`
  SELECT
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE domain='foot' AND merchant_id = ANY(${arr(MERCH)})
         AND tid = ANY(${arr(OLD_TIDS)})) AS still_old_tid,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE tid = ANY(${arr(NEW_TIDS)})) AS new_tid_persisted`);
console.log('\n③ post-probe(무영속 확증):', JSON.stringify(post[0]));
const clean = Number(post[0].still_old_tid) === 2 && Number(post[0].new_tid_persisted) === 0;
console.log(`   무영속 ${clean ? '✅ PASS' : '❌ FAIL — 영속 흔적!'} (still_old_tid=2, new_tid_persisted=0 기대)\n`);
if (!clean) throw new Error('무영속 검증 실패 — 영속 흔적 탐지');

// ── ④ forecast (READ-ONLY): 신 TID 편입 후 소급 표면화 예측 (뷰 semantics = r.tid membership) ──
const fc = await q(`
  WITH tid_after AS (
    SELECT tid FROM redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL
    UNION SELECT unnest(superseded_tids) FROM redpay_terminal_registry WHERE domain='foot' AND active AND superseded_tids IS NOT NULL
    UNION SELECT unnest(${arr(NEW_TIDS)})
  )
  SELECT
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND r.tid = ANY(${arr(NEW_TIDS)})) AS gap_rows_now,
    (SELECT COALESCE(sum((r.amount)::numeric),0) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND r.tid = ANY(${arr(NEW_TIDS)})) AS gap_amt,
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND r.tid = ANY(${arr(NEW_TIDS)})
         AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM tid_after)) AS visible_after_remap`);
console.log('④ forecast(READ-ONLY, remap 후 예측):', JSON.stringify(fc[0]));
console.log('   · gap_rows_now/gap_amt = 현재 미표면화 raw gap (239 raw10 + 246 raw2 = 12 예상)');
console.log('   · visible_after_remap = remap 후 tid-membership 하 표면화 예측 (= gap_rows_now 면 완전수렴)');
const converge = Number(fc[0].gap_rows_now) > 0 && Number(fc[0].gap_rows_now) === Number(fc[0].visible_after_remap);
console.log(`   ⇒ AC-3 수렴 예측 ${converge ? `✅ (${fc[0].gap_rows_now}→${fc[0].visible_after_remap} 완전수렴)` : '⚠ 재확인 필요'}\n`);
console.log('════ DRY-RUN 종료 (영속 0) ════');
