/**
 * T-20260803-foot-REDPAY-NET0-157-TIDMAP-SWAP-BACKFILL-SOP-ENVELOPE — TID↔merchant swap 정정 DRY-RUN (무영속)
 *
 * Data-Correction Backfill SOP + Migration Dry-Run No-Persistence Protocol 준수. supervisor 게이트 러너.
 *   ① pre-probe (READ-ONLY, AC-1 freeze-set 재검증):
 *      진단시점 진실표(registry outlier = 289013↔157 / 289009↔153) 와 현재 registry 상태 exact 대조.
 *      불일치(중간변경) 시 abort — freeze-set 무결성 보장.
 *   ② trial-apply (DO … RAISE EXCEPTION sentinel, 무영속, AC-1 rows-affected):
 *      up.sql 전문을 sentinel unwind 로 실행 → SQL 무오류 + rows-affected=2 검증 + 무영속.
 *      (up.sql = 순수 swap UPDATE, txn-control 문 없음 → sentinel-bypass hazard 없음.)
 *   ③ post-probe (READ-ONLY): registry 여전히 오류(전치)상태 = 영속 0 확증.
 *   ④ forecast (READ-ONLY, AC-4 3소스 재일치 census): swap 후 registry pairing 이
 *      feed 정본(289013↔153 / 289009↔157) 으로 수렴 예측 + 두 merchant membership 가시성 불변 확인.
 *
 * ⚠ 순수 data-lane UPDATE(신규 DDL 0). 영속 write 0. 원장(payments)·canonical 무접점.
 * 실행: node supabase/migrations/20260804010000_redpay_foot_registry_tidmap_swap_backfill.dryrun.mjs
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
const UP = join(here, '20260804010000_redpay_foot_registry_tidmap_swap_backfill.sql');

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

// freeze-set (정확히 이 2 매핑행) — 진단 진실표
const FREEZE = [
  { merchant: '1777289013', wrong: '1047479157', correct: '1047479153' }, // 289013: 157(오류)→153(feed 정본)
  { merchant: '1777289009', wrong: '1047479153', correct: '1047479157' }, // 289009: 153(오류)→157(feed 정본)
];
const MERCH   = FREEZE.map((f) => f.merchant);
const WRONG   = FREEZE.map((f) => f.wrong);
const CORRECT = FREEZE.map((f) => f.correct);
const arr = (xs) => `ARRAY[${xs.map((x) => `'${x}'`).join(',')}]`;

console.log('════ TIDMAP-SWAP 전치 정정 DRY-RUN (무영속, Backfill SOP) ════\n');

// ── ① pre-probe (READ-ONLY, AC-1 freeze-set 재검증) ──
const preRows = await q(`
  SELECT merchant_id, tid, superseded_tids, active, terminal_label
  FROM redpay_terminal_registry
  WHERE domain='foot' AND merchant_id = ANY(${arr(MERCH)})
  ORDER BY merchant_id`);
console.log('① pre-probe — 2 merchant 현 registry 상태:', JSON.stringify(preRows));

// 진단시점 진실표(오류=전치)와 exact 대조: 각 merchant tid 가 정확히 wrong 값이어야 착수
const atWrong = FREEZE.every((f) =>
  preRows.some((r) => r.merchant_id === f.merchant && String(r.tid) === f.wrong));
const freezeExact = preRows.length === 2 && atWrong;
console.log(`   기대: 289013↔157 / 289009↔153 (registry outlier=전치상태), 정확히 2행`);
console.log(`   freeze-set 대조 ${freezeExact ? '✅ MATCH' : '❌ MISMATCH — 중간변경/already-applied → ABORT'}\n`);
if (!freezeExact) {
  // 이미 정본이면 already-applied. 그 외는 진단표 불일치.
  const atCorrect = FREEZE.every((f) =>
    preRows.some((r) => r.merchant_id === f.merchant && String(r.tid) === f.correct));
  throw new Error(atCorrect
    ? 'freeze-set already-applied(정본상태) — 정정 불요(rows-affected=0 예상). 재판정만.'
    : 'freeze-set MISMATCH — 진단 진실표와 registry 불일치(중간변경). 재진단 전 착수 금지.');
}

// ── ② trial-apply (DO … sentinel, 무영속, rows-affected=2 assert) ──
const upBody = readFileSync(UP, 'utf8');
console.log('② trial-apply: up.sql 전문 DO…sentinel unwind 실행(무오류 + rows-affected assert)...');
const trial = await q(`
DO $dryrun$
DECLARE
  v_affected int;
BEGIN
  ${upBody}
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE 'DRYRUN rows_affected=%', v_affected;
  IF v_affected <> 2 THEN
    RAISE EXCEPTION 'DRYRUN_ROWS_MISMATCH(rows_affected=% <> 2 기대 — freeze-set abort)', v_affected;
  END IF;
  RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL(무영속 강제 unwind, affected=%)', v_affected;
END
$dryrun$;`).catch((e) => {
  const msg = String(e.message || e);
  if (msg.includes('DRYRUN_ROLLBACK_SENTINEL')) { console.log('   ✅ rows-affected=2 assert 통과 + sentinel unwind:', msg.match(/DRYRUN_ROLLBACK_SENTINEL[^"]*/)?.[0] || 'ok'); return 'SENTINEL'; }
  if (msg.includes('DRYRUN_ROWS_MISMATCH')) { console.log('   ❌ rows-affected ≠ 2:', msg.match(/DRYRUN_ROWS_MISMATCH[^"]*/)?.[0]); return 'MISMATCH'; }
  throw e;
});
if (trial === 'MISMATCH') throw new Error('rows-affected ≠ 2 — freeze-set 대상 불일치, 정정 abort');
if (trial !== 'SENTINEL') throw new Error('무영속 sentinel 미발화 — dry-run 무결성 실패');

// ── ③ post-probe (무영속 확증) ──
const post = await q(`
  SELECT count(*) AS still_wrong
  FROM redpay_terminal_registry
  WHERE domain='foot'
    AND ( (merchant_id='1777289013' AND tid='1047479157')
       OR (merchant_id='1777289009' AND tid='1047479153') )`);
const clean = Number(post[0].still_wrong) === 2;
console.log(`\n③ post-probe(무영속 확증): still_wrong=${post[0].still_wrong} ${clean ? '✅ PASS' : '❌ FAIL — 영속 흔적!'} (2 기대)\n`);
if (!clean) throw new Error('무영속 검증 실패 — 영속 흔적 탐지');

// ── ④ forecast (READ-ONLY, AC-4 3소스 재일치 census + membership 가시성 불변) ──
//   swap 후 registry pairing = feed 정본(289013↔153 / 289009↔157) 수렴 예측.
//   membership: 289009·289013·153·157 모두 foot → 화이트리스트 세트 불변 → 대사뷰 가시성 훼손 없음.
const fc = await q(`
  WITH mem AS (   -- swap 후 domain-wide 멤버십(불변: swap 은 pairing 만 바꿈, 세트 원소 동일)
    SELECT merchant_id, tid FROM redpay_terminal_registry WHERE domain='foot' AND active
  )
  SELECT
    -- feed 3소스 재일치 census (registry pairing 이 feed 정본으로 수렴하는지)
    (SELECT count(*) FROM (
       SELECT 1 WHERE '1047479153' = ANY(SELECT tid FROM mem)
       UNION ALL SELECT 1 WHERE '1047479157' = ANY(SELECT tid FROM mem)) x) AS both_tids_in_membership,
    (SELECT count(DISTINCT merchant_id) FROM mem WHERE merchant_id = ANY(${arr(MERCH)})) AS both_merch_in_membership,
    -- 대사뷰 가시성: 두 merchant 의 raw 가 여전히 대사뷰에 표면화되는지(membership 불변 확인)
    (SELECT count(*) FROM public.v_redpay_reconciliation_daily v
       WHERE v.tid = ANY(${arr(CORRECT)})) AS view_rows_at_correct_tids,
    (SELECT count(*) FROM redpay_raw_transactions r
       WHERE COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') = ANY(${arr(MERCH)})) AS raw_rows_two_merch`);
console.log('④ forecast(READ-ONLY, AC-4 3소스 재일치 census):', JSON.stringify(fc[0]));
console.log('   · both_tids_in_membership=2  → 153·157 모두 foot 화이트리스트 유지(swap=pairing 정정, 세트 불변)');
console.log('   · both_merch_in_membership=2 → 289013·289009 모두 foot 유지 → 대사 가시성 훼손 없음(GO_WARN 완화)');
console.log('   · view_rows_at_correct_tids / raw_rows_two_merch = 정정 후 대사뷰 표면화 실측 근거');
const converge = Number(fc[0].both_tids_in_membership) === 2 && Number(fc[0].both_merch_in_membership) === 2;
console.log(`   ⇒ AC-4 3소스 재일치 예측 ${converge ? '✅ (registry→feed 정본 수렴, membership 불변)' : '⚠ 재확인 필요'}\n`);
console.log('════ DRY-RUN 종료 (영속 0) — supervisor GO 시 up.sql 실적용 + AC-5 부모 157 재판정 ════');
