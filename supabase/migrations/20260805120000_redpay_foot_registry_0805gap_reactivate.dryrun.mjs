/**
 * T-20260805-foot-REDPAY-WHITELIST-EXPAND-0805GAP-REACTIVATE — 289002 재활성 DRY-RUN (무영속)
 *
 * Migration Dry-Run No-Persistence Protocol 준수 + G3/G4/G7 게이트:
 *   ① pre-probe / archive-first (READ-ONLY): 289002 before-image(active=false,tid=구479476,superseded=NULL) +
 *      superseded_tids 컬럼 실재 + 538233 registry 부재.
 *   ② trial-apply: up.sql 전문을 DO $dryrun$ … RAISE EXCEPTION sentinel 로 실행 → SQL 무오류 + rows-affected=1(G3) + 무영속.
 *                  (up.sql = 순수 UPDATE, txn-control 문 없음 → sentinel-bypass hazard 없음.)
 *   ③ post-probe (READ-ONLY): 289002 여전히 active=false / tid=구479476 (영속 0 확증).
 *   ④ forecast (READ-ONLY, ★view-accurate, AC-4): 재활성 후(active=true + tid=538233 편입) 소비뷰
 *      predicate(merchant 멤버십 AND tid 멤버십, 양쪽 active hard-filter) 하 4행 소급 표면화 예측 (0→4 / ₩290,000).
 *
 * ⚠ 순수 data-lane UPDATE(신규 DDL 0). 영속 write 0.
 * 실행: node supabase/migrations/20260805120000_redpay_foot_registry_0805gap_reactivate.dryrun.mjs
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
const UP = join(here, '20260805120000_redpay_foot_registry_0805gap_reactivate.sql');

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

const MERCH = '1777289002';
const OLD_TID = '1047479476';
const NEW_TID = '1047538233';

console.log('════ 0805GAP 289002 재활성 DRY-RUN (무영속) ════\n');

// ── ① pre-probe / archive-first before-image (READ-ONLY, G4) ──
const pre = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE domain='foot' AND merchant_id='${MERCH}' AND tid='${OLD_TID}' AND active=false) AS anchor_at_deactivated_oldtid,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE tid='${NEW_TID}' OR superseded_tids && ARRAY['${NEW_TID}']) AS new_tid_present`);
console.log('① pre-probe:', JSON.stringify(pre[0]));
console.log('   기대: has_superseded_col=1, anchor_at_deactivated_oldtid=1, new_tid_present=0');

const beforeImage = await q(`
  SELECT merchant_id, tid, superseded_tids, active, domain, terminal_label
  FROM redpay_terminal_registry WHERE merchant_id='${MERCH}'`);
console.log('   ★archive-first before-image(G4):', JSON.stringify(beforeImage));

// ── ② trial-apply (DO … RAISE EXCEPTION sentinel, 무영속) + rows-affected=1 assert (G3) ──
const upBody = readFileSync(UP, 'utf8');
console.log('\n② trial-apply: up.sql 전문 DO…sentinel unwind 실행(무오류 + rows-affected=1 G3)...');
const trial = await q(`
DO $dryrun$
DECLARE
  v_affected int;
  v_active boolean;
  v_tid text;
BEGIN
  ${upBody.replace(/\$dryrun\$/g, '$inner$')}
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  SELECT active, tid INTO v_active, v_tid FROM public.redpay_terminal_registry
    WHERE domain='foot' AND merchant_id='${MERCH}';
  RAISE NOTICE 'DRYRUN rows_affected=% active_in_txn=% tid_in_txn=%', v_affected, v_active, v_tid;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'DRYRUN_G3_FAIL rows_affected=% (기대 1)', v_affected;
  END IF;
  RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL(무영속 강제 unwind, affected=% active=% tid=%)', v_affected, v_active, v_tid;
END
$dryrun$;`).catch((e) => {
  const msg = String(e.message || e);
  if (msg.includes('DRYRUN_G3_FAIL')) { throw new Error('G3 위반 — ' + msg); }
  if (msg.includes('DRYRUN_ROLLBACK_SENTINEL')) { console.log('   ✅ sentinel unwind:', msg.match(/DRYRUN_ROLLBACK_SENTINEL[^"]*/)?.[0] || 'ok'); return 'SENTINEL'; }
  throw e;
});
if (trial !== 'SENTINEL') throw new Error('무영속 sentinel 미발화 — dry-run 무결성 실패');

// ── ③ post-probe (무영속 확증) ──
const post = await q(`
  SELECT active, tid,
    (superseded_tids IS NULL) AS superseded_still_null
  FROM redpay_terminal_registry WHERE domain='foot' AND merchant_id='${MERCH}'`);
console.log('\n③ post-probe(무영속 확증):', JSON.stringify(post[0]));
const clean = post[0].active === false && post[0].tid === OLD_TID && post[0].superseded_still_null === true;
console.log(`   무영속 ${clean ? '✅ PASS' : '❌ FAIL — 영속 흔적!'} (active=false, tid=구479476, superseded=NULL 기대)`);
if (!clean) throw new Error('무영속 검증 실패 — 영속 흔적 탐지');

// ── ④ forecast (READ-ONLY, ★view-accurate, AC-4): 재활성 후 4행 소급 표면화 예측 ──
//   재활성 시뮬 = merchant 멤버십에 289002 UNION + tid 멤버십에 538233 UNION.
const fc = await q(`
  WITH tid_after AS (
    SELECT tid FROM redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL
    UNION SELECT unnest(superseded_tids) FROM redpay_terminal_registry WHERE domain='foot' AND active AND superseded_tids IS NOT NULL
    UNION SELECT '${NEW_TID}'
  ),
  merch AS (
    SELECT merchant_id FROM redpay_terminal_registry WHERE domain='foot' AND active
    UNION SELECT '${MERCH}'
  )
  SELECT
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND r.tid='${NEW_TID}') AS gap_rows_raw,
    (SELECT COALESCE(sum((r.amount)::numeric),0) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND r.tid='${NEW_TID}') AS gap_amt_raw,
    (SELECT count(*) FROM public.v_redpay_reconciliation_daily v
       WHERE v.tid='${NEW_TID}') AS visible_now_in_view,
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE r.external_status='Y'
         AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IN (SELECT merchant_id FROM merch)
         AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM tid_after)
         AND COALESCE(r.tid, r.raw_payload->'data'->>'tid')='${NEW_TID}') AS visible_after_reactivate`);
console.log('\n④ forecast(READ-ONLY, view-accurate, 재활성 후 예측):', JSON.stringify(fc[0]));
console.log('   · gap_rows_raw/gap_amt_raw = raw 실재 gap (기대 4 / 290,000)');
console.log('   · visible_now_in_view = 재활성 前 뷰 표면화 (기대 0)');
console.log('   · visible_after_reactivate = 재활성 후 뷰 predicate 하 표면화 예측 (기대 4 = 완전 수렴)');
const converge = Number(fc[0].gap_rows_raw) === 4 && Number(fc[0].visible_now_in_view) === 0 && Number(fc[0].visible_after_reactivate) === 4;
console.log(`   ⇒ AC-4 수렴 예측 ${converge ? '✅ (0→4 / ₩290,000)' : '⚠ 재확인 필요'}\n`);
console.log('════ DRY-RUN 종료 (영속 0) ════');
