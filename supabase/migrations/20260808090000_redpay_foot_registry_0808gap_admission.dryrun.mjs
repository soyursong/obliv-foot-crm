/**
 * T-20260808-foot-REDPAY-WHITELIST-EXPAND-0808GAP — 288002 신규 admission DRY-RUN (무영속)
 *
 * Migration Dry-Run No-Persistence Protocol 준수 + VG1/VG2/G3/G4 + AC-5(VG3) 게이트:
 *   ① pre-probe / archive-first (READ-ONLY): 288002 registry 부재(신규 INSERT 검증) + tid 538234 전역 부재 +
 *      ★VG1 baseline 재-freeze: 현 foot(active) 카운트(DA 확정 27/27/42 drift, CONSULT 시점 26에서 +1) + superseded 컬럼 실재.
 *      ★VG2: active foot 최근행 = 288007(0806GAP interim seed) 확인 → 27번째가 288007 이 아니면 seed 전 flag(재-CONSULT).
 *   ② trial-apply: up.sql 의 DO$$…$$ 블록을 DO $dryrun$ … RAISE EXCEPTION sentinel 로 실행
 *                  → SQL 무오류 + INSERT rows-affected=1(G3) + 무영속.
 *                  (up.sql = DO$$…$$ INSERT + 별도 schema_migrations INSERT. txn-control 문 없음 → sentinel-bypass hazard 없음.
 *                   내부 DO$$…$$ 는 dollar-tag 충돌 회피 위해 $inner$ 로 치환. schema_migrations INSERT 행은 dry-run 에서 제외.)
 *   ③ post-probe (READ-ONLY): 288002 여전히 registry 부재 (영속 0 확증).
 *   ④ forecast (READ-ONLY, ★AC-5 REVISED/VG3): raw @tid=1047538234 external_status=Y 현 적재 = 0.
 *      ★★ raw 0 = '소급 0' 아님 — 신규 미등록 merchant → admit 前 poller filterToFootScope drop 이라 아직 미캡처일 뿐.
 *      DA 08-09 feed-probe 정본: upstream RedPay feed 에 ₩260,000/3txn 실재(원문 amt=₩0 SUPERSEDE).
 *      ∴ GO-token 후 런북: env merchant-add → registry INSERT → ★daily_full 재폴링 8/06~8/09 → 뷰 0→3 / ₩0→₩260,000 소급.
 *      forecast 는 (a) 현 raw 적재 0(admit 前 예상) 확인 + (b) registry INSERT 후 28/28/43 카운트 예측(VG1).
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

// ── ① pre-probe / archive-first (READ-ONLY, G4 + ★VG1 baseline 재-freeze) ──
const EXPECT_BASELINE = 27;  // ★VG1(DA 확정): CONSULT 26 → 現 27(+1, 288007 0806GAP interim seed 개연) → INSERT 後 28.
const SIBLING_0806 = '1777288007';  // ★VG2: 27번째 interim = 288007(0806GAP) 이어야 함(double-INSERT 아님).
const pre = await q(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
       WHERE table_name='redpay_terminal_registry' AND column_name='superseded_tids') AS has_superseded_col,
    (SELECT count(*) FROM redpay_terminal_registry WHERE merchant_id='${MERCH}') AS merchant_present,
    (SELECT count(*) FROM redpay_terminal_registry
       WHERE tid='${NEW_TID}' OR superseded_tids && ARRAY['${NEW_TID}']) AS new_tid_present,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active) AS foot_active_rows,
    (SELECT count(*) FROM redpay_terminal_registry WHERE domain='foot' AND active AND merchant_id='${SIBLING_0806}') AS sibling_0806_present`);
console.log('① pre-probe(VG1 baseline 재-freeze):', JSON.stringify(pre[0]));
console.log(`   기대: has_superseded_col=1, merchant_present=0(신규), new_tid_present=0(순수 신규), foot_active_rows=${EXPECT_BASELINE}(VG1 drift), sibling_0806_present=1(VG2)`);
// ★G3 하드가드(BLOCKING): 288002 still-absent 재-assert (seed 직전 불변).
if (Number(pre[0].merchant_present) !== 0) throw new Error('PRE_FAIL(VG1) — 288002 이미 존재. 신규 admission 아님(double-INSERT/remap 재검토·재-CONSULT).');
if (Number(pre[0].new_tid_present) !== 0) throw new Error('PRE_FAIL — tid 538234 가 이미 registry 에 존재(remap 후보). 신규 INSERT 재검토.');
// ★VG1 baseline drift: 27 이 아니면 소프트 경고(추가 drift = 또 다른 interim seed 개연). 27/27/42 재-freeze 는 seed 직전 supervisor 확정.
if (Number(pre[0].foot_active_rows) !== EXPECT_BASELINE) {
  console.log(`   ⚠ VG1 baseline drift 재발 — foot_active_rows=${pre[0].foot_active_rows} ≠ 기대 ${EXPECT_BASELINE}. INSERT 後 예측 카운트는 (현재+1)=${Number(pre[0].foot_active_rows) + 1}. baseline 재-freeze 후 진행(추가 interim seed 여부 supervisor 확인).`);
}
// ★VG2: 27번째 interim = 288007(0806GAP) 확인. ≠ 이면 재-CONSULT(DA 재발 트리거).
if (Number(pre[0].sibling_0806_present) !== 1) {
  console.log(`   ⚠ VG2 flag — 288007(0806GAP interim) 부재 또는 다중. 27번째 drift 원인이 288007 이 아님 → seed 전 재-CONSULT 권고(DA 재발 트리거).`);
} else {
  console.log('   ✅ VG2: 27번째 interim = 288007(0806GAP) 확인(288002 double-INSERT 아님).');
}
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
console.log('\n④ forecast(READ-ONLY, ★AC-5 REVISED/VG3):', JSON.stringify(fc[0]));
console.log('   · raw_ingested_now = 현 raw 적재(★기대 0 — admit 前 poller drop → 아직 미캡처. ≠ 소급 0)');
console.log('   · raw_amt_now = 현 raw 매출합 (기대 ₩0 — admit 前 미적재. upstream feed 실재분은 DA feed-probe ₩260,000)');
console.log('   · visible_now_in_view = 현 뷰 표면화 (기대 0 — 재폴링 前)');
console.log(`   · foot_active_now = 현 registry(VG1 기대 27 → INSERT 후 28)`);
console.log('   ─────────────────────────────────────────────────────────');
console.log('   ★AC-5 REVISED(DA 08-09 확정): amt≠₩0 → ₩260,000/3txn 소급분 존재(원문 "소급 0" SUPERSEDE).');
console.log('     raw 現 0 은 "소급 대상 0" 이 아니라 "admit 前이라 아직 안 내려옴"(신규 미등록 merchant filterToFootScope drop).');
if (Number(fc[0].raw_ingested_now) === 0) {
  console.log('     ✅ 기대대로 raw 미캡처(0) — GO-token 후 런북으로 소급 표면화:');
} else {
  console.log(`     ⚠ raw 이미 ${fc[0].raw_ingested_now}건 적재(₩${fc[0].raw_amt_now}) — 예상 밖 조기 적재. 재폴링 시 멱등 upsert 로 중복 0.`);
}
console.log('     ① env merchant-add: ~/.env.redpay-foot REDPAY_MERCHANT_WHITELIST += 1777288002 (env-override-first, 0806 C4-bis)');
console.log('     ② registry INSERT (본 seed, GO-token 후)');
console.log('     ③ ★daily_full 재폴링 8/06~8/09 (VG3):');
console.log('        REDPAY_POLL_MODE=daily_full REDPAY_DAILY_FROM=2026-08-06 REDPAY_DAILY_TO=2026-08-09 (dry-run 선행)');
console.log('        → redpay_raw_transactions 3행 재적재 → 뷰 0→3 / ₩0→₩260,000 소급 표면화(0806GAP 과 동형).');
console.log('\n════ DRY-RUN 종료 (영속 0) ════');
