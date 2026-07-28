/**
 * T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE — AC-5 (b) 양방향 diff 역방향 probe (READ-ONLY)
 *
 * 원 요청(최필경 총괄 req2 보강, MSG-20260728-172749-jcdq / 세부분리 MSG-9g7f / merchant_id 정밀화 MSG-1plw):
 *   단방향(27개→registry)만으론 불완전. 역방향도 산출한다.
 *   방향 (b): 현 registry(허용목록)에는 있으나 실측 27개에 없는 TID → (b-1)/(b-2) 분리 판정.
 *     (b-1) 타센터 대역 혼입 [★오염 — 풋 매출 과대계상]:
 *           raw_payload.data.merchant_id 가 도수/피부/롱래스팅 대역이면 타센터.
 *           발견 시 목록·건수·금액만 회신 + 별건 DA CONSULT (본 티켓 제거 금지).
 *           전례: 7/23 조회 필터해제 시 도수TID 1047479115 딸림(웹훅 정상차단) → 실검증 의무.
 *     (b-2) 휴면 단말 [오염 아님 — 명단 위생]:
 *           merchant_id 가 풋 대역(1777285/288/289)이지만 7/15~7/28 거래 0.
 *           OL HARD guard(AC-3) 적용 → 본 티켓 제거 금지, 목록만 회신.
 *
 * merchant_id 대역 판정 기준 (총괄 정본 MSG-1plw, 정밀 prefix — range 아님):
 *   풋   = 1777285* / 1777288* / 1777289*
 *   도수 = 1777274* / 1777275* / 1777276*
 *   피부 = 1777277* / 1777279* / 1777280* / 1777281*   (⚠ 1777278* 미관측)
 *   롱래 = 1777282* / 1777284*                          (⚠ 1777283* 미관측)
 *
 * ⚠ SELECT-only. write 0. Supabase Management API READ. 무영속. 추측 금지 — merchant_id 는 raw 실측.
 * 실행: node scripts/T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE_ac5b_probe.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

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

// ── 레드페이 조회 실측 27-set (총괄 req2, 457-23-00938 풋, 7/15~7/28) ──────────────
const TIDS27 = [
  '1047479153', '1047479158', '1047479471', '1047479472', '1047479473',
  '1047479474', '1047479475', '1047479477', '1047479478', '1047479479',
  '1047479480', '1047479481', '1047479483',
  '1047535797', '1047535835', '1047535837', '1047535842', '1047535843', '1047535845',
  '1047538231', '1047538235', '1047538236', '1047538237', '1047538239',
  '1047538241', '1047538245', '1047538246',
];
const SET27 = new Set(TIDS27);

// merchant_id 대역 판정 (정밀 prefix, MSG-1plw) ─ SQL CASE 로 동일 재사용
const BAND_CASE = (col) => `
  CASE
    WHEN ${col} IS NULL THEN 'unknown(merchant_id NULL)'
    WHEN ${col} LIKE '1777285%' OR ${col} LIKE '1777288%' OR ${col} LIKE '1777289%' THEN 'foot'
    WHEN ${col} LIKE '1777274%' OR ${col} LIKE '1777275%' OR ${col} LIKE '1777276%' THEN 'body(도수)'
    WHEN ${col} LIKE '1777277%' OR ${col} LIKE '1777279%' OR ${col} LIKE '1777280%' OR ${col} LIKE '1777281%' THEN 'derm(피부)'
    WHEN ${col} LIKE '1777282%' OR ${col} LIKE '1777284%' THEN 'longlast(롱래)'
    ELSE 'other(미분류)'
  END`;

// 뷰 resolver 정합 (0725GAP / AC-1 probe 계승)
const RTID = `COALESCE(r.tid, r.raw_payload->'data'->>'tid')`;
const RMID = `COALESCE(r.raw_payload->'merchant'->>'id',   r.raw_payload->'data'->>'merchant_id')`;
const RNAME = `COALESCE(r.raw_payload->'merchant'->>'name', r.raw_payload->'data'->>'merchant_name')`;
const RBIZ = `COALESCE(r.raw_payload->'merchant'->>'bizNo', r.raw_payload->'data'->>'business_no')`;
const RAMT = `COALESCE(r.raw_payload->>'amount', r.raw_payload->'data'->>'amount')::numeric`;

console.log('=== T-20260728 REDPAY TID27 reconcile — AC-5 (b) 역방향 diff READ-ONLY probe ===');
console.log(`실측 27-set 기준. 방향(b) = registry(허용목록) admit ∖ 27-set → (b-1 타센터 / b-2 휴면) 분리\n`);

// ── QB0: registry admit 전체(active tid ∪ unnest(superseded_tids)) + merchant_id ───────
const admitRows = await q(`
  WITH admitted AS (
    SELECT tid AS admit_tid, merchant_id, terminal_label, 'active_tid' AS admit_via
    FROM public.redpay_terminal_registry WHERE domain='foot' AND active
    UNION
    SELECT unnest(superseded_tids) AS admit_tid, merchant_id, terminal_label, 'superseded_tids' AS admit_via
    FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND superseded_tids IS NOT NULL
  )
  SELECT admit_tid, merchant_id, terminal_label, admit_via,
         ${BAND_CASE('merchant_id')} AS reg_band
  FROM admitted
  ORDER BY admit_tid;`);
console.log(`QB0 [registry admit 전체(active tid ∪ superseded_tids): ${admitRows.length}개 TID]`);

// 방향(b) = admit ∖ 27-set
const regOnly = admitRows.filter((a) => !SET27.has(a.admit_tid));
console.log(`\n방향(b) 후보 = admit ${admitRows.length} ∖ 27-set = ${regOnly.length}개 (registry엔 있으나 실측27엔 없음)`);
console.table(regOnly);

const REGONLY_TIDS = regOnly.map((a) => a.admit_tid);
const REGONLY_IN = REGONLY_TIDS.length ? `'${REGONLY_TIDS.join("','")}'` : `''`;

// ── QB1: 각 (b) TID 의 raw 실측 merchant_id/biz_no + 거래(7/15~28 윈도우 + 전기간) ────────
const rawMeasure = REGONLY_TIDS.length ? await q(`
  SELECT
    ${RTID}  AS resolved_tid,
    ${RMID}  AS raw_merchant_id,
    ${RNAME} AS raw_merchant_name,
    ${RBIZ}  AS raw_biz_no,
    ${BAND_CASE(RMID)} AS raw_band,
    count(*)                                                                   AS trx_all,
    sum(${RAMT})                                                               AS amt_all,
    count(*) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                     BETWEEN '2026-07-15' AND '2026-07-28')                    AS trx_win,
    sum(${RAMT}) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                     BETWEEN '2026-07-15' AND '2026-07-28')                    AS amt_win,
    max(r.approved_at)                                                         AS last_approved
  FROM public.redpay_raw_transactions r
  WHERE ${RTID} IN (${REGONLY_IN})
  GROUP BY 1,2,3,4
  ORDER BY 1;`) : [];
console.log('\nQB1 [(b) TID raw 실측 merchant_id/band + 거래(win 7/15~28 · 전기간)]');
console.table(rawMeasure);

// ── QB2: ★광역 오염 스캔 — 457 biz 하의 raw 전 TID 中 non-foot band (admission-bypass 포함) ──
//    (b-1) 전례(1047479115 도수) 재현 — 등록/미등록 무관, 실 raw 에 non-foot merchant 혼입 전수.
const contamScan = await q(`
  SELECT
    ${RTID}  AS resolved_tid,
    ${RMID}  AS raw_merchant_id,
    ${RNAME} AS raw_merchant_name,
    ${RBIZ}  AS raw_biz_no,
    ${BAND_CASE(RMID)} AS raw_band,
    count(*) AS trx_all,
    count(*) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                     BETWEEN '2026-07-15' AND '2026-07-28') AS trx_win,
    sum(${RAMT}) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                     BETWEEN '2026-07-15' AND '2026-07-28') AS amt_win,
    max(r.approved_at) AS last_approved
  FROM public.redpay_raw_transactions r
  WHERE ${BAND_CASE(RMID)} <> 'foot'
  GROUP BY 1,2,3,4,5
  ORDER BY raw_band, resolved_tid;`);
console.log('\nQB2 [★광역 오염 스캔 — raw 전체 中 non-foot merchant_id band (admission-bypass 포함)]');
console.table(contamScan);

// ── QB2b: 위 non-foot TID 가 FOOT 정합 뷰에 표면화되는가 (풋 매출 혼입 실측) ──────────────
const nonFootTids = [...new Set(contamScan.map((c) => c.resolved_tid))];
const viewSurface = nonFootTids.length ? await q(`
  SELECT tid, count(*) AS rows_in_foot_view, sum(van_amount) AS amt
  FROM public.v_redpay_reconciliation_daily
  WHERE tid IN ('${nonFootTids.join("','")}')
  GROUP BY tid ORDER BY tid;`) : [];
console.log('\nQB2b [non-foot TID 의 FOOT 뷰(v_redpay_reconciliation_daily) 표면화 — 0행=격리]');
console.table(viewSurface.length ? viewSurface : [{ note: '풋 뷰 표면화 0행 — 전건 격리(풋 매출 미혼입)' }]);

// ── QB3: registry 행 자체에 non-foot merchant_id 오염이 있는가 (SSOT 위생) ───────────────
const regContam = await q(`
  SELECT merchant_id, tid, terminal_label, ${BAND_CASE('merchant_id')} AS reg_band
  FROM public.redpay_terminal_registry
  WHERE domain='foot'
    AND NOT (merchant_id LIKE '1777285%' OR merchant_id LIKE '1777288%' OR merchant_id LIKE '1777289%')
  ORDER BY merchant_id;`);
console.log('\nQB3 [registry(domain=foot) 행 中 non-foot merchant_id (SSOT 오염 여부)]');
console.table(regContam.length ? regContam : [{ note: 'non-foot merchant_id 행 0건 — SSOT 위생 clean' }]);

// ── 판정 요약 ──────────────────────────────────────────────────────────────────
const winMap = Object.fromEntries(rawMeasure.map((r) => [r.resolved_tid, { band: r.raw_band, win: Number(r.trx_win || 0), amtWin: Number(r.amt_win || 0), mid: r.raw_merchant_id }]));

// (b) 분류: raw band 우선(실측), raw 미출현 시 registry band 폴백
const classify = regOnly.map((a) => {
  const m = winMap[a.admit_tid];
  const band = m?.band || a.reg_band; // raw 실측 우선
  const trxWin = m?.win ?? 0;
  const amtWin = m?.amtWin ?? 0;
  const mid = m?.mid || a.merchant_id;
  let verdict;
  if (band !== 'foot' && !band.startsWith('unknown')) {
    verdict = 'b-1 타센터혼입[★오염]';
  } else if (band === 'foot') {
    verdict = trxWin === 0 ? 'b-2 휴면[명단위생]' : 'b-? foot·거래존재(재확인)';
  } else {
    verdict = `미판정(${band})`;
  }
  return { tid: a.admit_tid, admit_via: a.admit_via, reg_band: a.reg_band, raw_band: m?.band || '(raw 미출현)', merchant_id: mid, trx_win: trxWin, amt_win: amtWin, verdict };
});
console.log('\n=== ★ AC-5 (b) 양방향 diff 역방향 판정표 ===');
console.table(classify);

const b1 = classify.filter((c) => c.verdict.startsWith('b-1'));
const b2 = classify.filter((c) => c.verdict.startsWith('b-2'));

console.log('\n=== ★ 판정 요약 ===');
console.log(`(b) registry-only TID 총: ${regOnly.length}건`);
console.log(`  ↳ (b-1) 타센터 혼입 [★오염, 풋 매출 과대계상 위험]: ${b1.length}건 ${b1.length ? '⛔ 별건 DA CONSULT + planner FOLLOWUP' : '✅ 없음'}`);
if (b1.length) console.log(`       ${b1.map((c) => `${c.tid}(${c.raw_band},${c.trx_win}건/₩${c.amt_win})`).join(', ')}`);
console.log(`  ↳ (b-2) 휴면 단말 [오염 아님, 명단 위생·OL HARD guard 적용]: ${b2.length}건`);
if (b2.length) console.log(`       ${b2.map((c) => c.tid).join(', ')}`);
console.log(`\n광역 오염 스캔(QB2): raw 전체 中 non-foot band TID = ${contamScan.length}건`);
if (contamScan.length) {
  const surfaced = viewSurface.filter((v) => Number(v.rows_in_foot_view) > 0);
  console.log(`  → 풋 뷰 표면화: ${surfaced.length}건 ${surfaced.length ? '⛔ 풋 매출 혼입!' : '✅ 전건 격리(풋 매출 미혼입 — 뷰 merchant_id 이중게이트)'}`);
  console.log(`  → 목록: ${contamScan.map((c) => `${c.resolved_tid}(${c.raw_band},win ${c.trx_win}건/₩${c.amt_win})`).join(', ')}`);
}
console.log(`registry SSOT 오염(QB3): non-foot merchant_id 행 = ${regContam.length}건 ${regContam.length ? '⛔' : '✅ 없음'}`);
