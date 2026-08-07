/**
 * T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP — 288002 신규 admission DRY-RUN (무영속)
 *
 * Migration Dry-Run No-Persistence Protocol 준수 + G3/G4/G7 게이트:
 *   ① pre-probe / archive-first (READ-ONLY): 288002 registry 부재(신규 INSERT 검증) + tid 538234 전역 부재 +
 *      현 foot(active) 카운트 baseline(26/26/41) + superseded 컬럼 실재.
 *   ② trial-apply: up.sql 의 DO$$…$$ 블록을 DO $dryrun$ … RAISE EXCEPTION sentinel 로 실행
 *                  → SQL 무오류 + INSERT rows-affected=1(G3) + 무영속.
 *                  (up.sql = DO$$…$$ INSERT + 별도 schema_migrations INSERT. txn-control 문 없음 → sentinel-bypass hazard 없음.
 *                   내부 DO$$…$$ 는 dollar-tag 충돌 회피 위해 $inner$ 로 치환. schema_migrations INSERT 행은 dry-run 에서 제외.)
 *   ③ post-probe (READ-ONLY): 288002 여전히 registry 부재 (영속 0 확증).
 *   ④ forecast (READ-ONLY, ★AC-5): raw @tid=1047538234 external_status=Y 현 적재 = 0(신규 미등록 → poller drop) & amt=₩0.
 *      ★본 건은 raw 미적재 + 매출 ₩0 → 소급 대상 0. forward-capture only(별도 재폴링 불요).
 *      forecast 는 (a) 현 raw 적재 0 확인 + (b) registry INSERT 후 27/27/42 카운트 예측.
 *
 * ⚠ 순수 data-lane INSERT(신규 DDL 0). 영속 write 0.
 * 실행: node supabase/migrations/20260808090000_redpay_foot_registry_0808gap_admission.dryrun.mjs
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
const UP = join(here, '20260808090000_redpay_foot_registry_0808gap_admission.sql');

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

const MERCH = '1777288002';
const NEW_TID = '1047538234';

console.log('════ 0808GAP 288002 신규 admission DRY-RUN (무영속) ════\n');

// ── ① pre-probe / archive-first (READ-ONLY, G4) ──
const pre = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry WHERE merchant_id='${MERCH}') AS merchant_present,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE tid='${NEW_TID}' OR superseded_tids && ARRAY['${NEW_TID}']) AS new_tid_present,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active) AS foot_active_rows`);
console.log('① pre-probe:', JSON.stringify(pre[0]));
console.log('   기대: has_superseded_col=1, merchant_present=0(신규), new_tid_present=0(순수 신규), foot_active_rows=26');
if (Number(pre[0].merchant_present) !== 0) throw new Error('PRE_FAIL — 288002 이미 존재. 신규 admission 아님(remap 재검토).');
if (Number(pre[0].new_tid_present) !== 0) throw new Error('PRE_FAIL — tid 538234 가 이미 registry 에 존재(remap 후보). 신규 INSERT 재검토.');
console.log('   ★archive-first: 신규 INSERT → before-image 없음(삭제로 원상복구, rollback=DELETE).');

// ── ② trial-apply (DO … RAISE EXCEPTION sentinel, 무영속) + INSERT rows-affected=1 assert (G3) ──
const upRaw = readFileSync(UP, 'utf8');
// up.sql 의 DO $$ … $$ 블록만 추출(schema_migrations INSERT/주석 제외) + 내부 dollar-tag $inner$ 치환.
const doBlock = upRaw.match(/DO \$\$[\s\S]*?END \$\$;/);
if (!doBlock) throw new Error('up.sql DO$$ 블록 파싱 실패');
const inner = doBlock[0].replace(/DO \$\$/, 'DO $inner$').replace(/END \$\$;/, 'END $inner$;');
console.log('\n② trial-apply: up.sql DO블록 sentinel unwind 실행(무오류 + INSERT rows-affected=1 G3)...');
const trial = await q(`
DO $dryrun$
DECLARE
  v_after int;
BEGIN
  ${inner}
  SELECT count(*) INTO v_after FROM public.redpay_terminal_registry WHERE merchant_id='${MERCH}';
  RAISE NOTICE 'DRYRUN merchant_present_in_txn=%', v_after;
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'DRYRUN_G3_FAIL merchant_present_in_txn=% (기대 1)', v_after;
  END IF;
  RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL(무영속 강제 unwind, present=%)', v_after;
END
$dryrun$;`).catch((e) => {
  const msg = String(e.message || e);
  if (msg.includes('DRYRUN_G3_FAIL')) { throw new Error('G3 위반 — ' + msg); }
  if (msg.includes('DRYRUN_ROLLBACK_SENTINEL')) { console.log('   ✅ sentinel unwind:', msg.match(/DRYRUN_ROLLBACK_SENTINEL[^"]*/)?.[0] || 'ok'); return 'SENTINEL'; }
  throw e;
});
if (trial !== 'SENTINEL') throw new Error('무영속 sentinel 미발화 — dry-run 무결성 실패');

// ── ③ post-probe (무영속 확증) ──
const post = await q(`SELECT count(*) AS merchant_present FROM redpay_terminal_registry WHERE merchant_id='${MERCH}'`);
console.log('\n③ post-probe(무영속 확증):', JSON.stringify(post[0]), '(기대 merchant_present=0)');
if (Number(post[0].merchant_present) !== 0) throw new Error('무영속 검증 실패 — 영속 흔적 탐지(288002 잔존).');
console.log('   무영속 ✅ PASS');

// ── ④ forecast (READ-ONLY, AC-5): raw 적재 현황 + INSERT 후 카운트 예측 ──
const fc = await q(`
  SELECT
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND (r.tid='${NEW_TID}'
         OR COALESCE(r.raw_payload->'merchant'->>'id','')='${MERCH}')) AS raw_ingested_now,
    (SELECT COALESCE(SUM(r.amount),0) FROM redpay_raw_transactions r
       WHERE r.external_status='Y' AND (r.tid='${NEW_TID}'
         OR COALESCE(r.raw_payload->'merchant'->>'id','')='${MERCH}')) AS raw_amt_now,
    (SELECT count(*) FROM public.v_redpay_reconciliation_daily v WHERE v.tid='${NEW_TID}') AS visible_now_in_view,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active) AS foot_active_now`);
console.log('\n④ forecast(READ-ONLY, AC-5):', JSON.stringify(fc[0]));
console.log('   · raw_ingested_now = 현 raw 적재(★기대 0 — 신규 미등록 merchant → poller drop → 미적재)');
console.log('   · raw_amt_now = 현 raw 매출합 (기대 ₩0 — 티켓 amt=₩0)');
console.log('   · visible_now_in_view = 현 뷰 표면화 (기대 0)');
console.log('   · foot_active_now = 현 registry(기대 26 → INSERT 후 27)');
if (Number(fc[0].raw_ingested_now) === 0) {
  console.log('   ★AC-5 확정: raw 미적재(0) + amt=₩0 → 즉시 소급할 매출 없음 = 소급 대상 0.');
  console.log('     admission = forward-capture enablement only. 별도 daily_full 재폴링 불요(0806GAP 과 상이).');
  console.log('     향후 이 단말 실거래(amt>0) 발생 시 merchant admit 로 정상 캡처·표면화.');
} else {
  console.log(`   raw 이미 ${fc[0].raw_ingested_now}건 적재(₩${fc[0].raw_amt_now}) → admission 후 poller daily_full(8/05~8/08) 재폴링으로 뷰 소급.`);
}
console.log('\n════ DRY-RUN 종료 (영속 0) ════');
