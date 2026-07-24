// T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG — READ-ONLY 진단 probe
// ══════════════════════════════════════════════════════════════════════════
// 목적: 7/23 18:05+ (웹훅 커버 구간) divergence 완전분해.
//   현장 실측: 승인 9 / 취소 1   ↔   장첸 DB: 승인 7 / 취소 2
//   → 취소 +1 (over-count, 도수 오염 가설 ③) · 승인 -2 (under-count, 표면화탈락 ②)
// 스코프: mutation 0. SELECT only. write/DDL 없음. db_change=false.
// 인증컨텍스트: service_role (RLS bypass) — 전건 관측(진단 인증컨텍스트 표준 준수).
// PHI 위생: 산출물엔 count/금액/시각/TID/merchant/소스경로만. name/phone/RRN 제외.
//
// AC 축:
//   [축1] 취소 over-count: 18:05+ 취소 2건 TID·merchant 나열 → 실 도메인귀속(풋/도수) 대조
//         → 도수 TID 가 풋 457 count 포함되는지 확정 + 오염경로 층(a/b/c) 지목.
//   [축2] 승인 under-count -2: TID별 귀속 → cause(a) 뷰 payload-shape 탈락 /
//         cause(b) 신규TID whitelist밖 / 기타.
//   [축3] rc-report: 18:05+ = 현장 승인9/취소1 = DB(승인7+탈락2)/(취소1+도수1). 잔여델타 0 목표.
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CLOSE_DATE = '2026-07-23';
// 18:05 KST(UTC+9) 7/23  ==  UTC 2026-07-23T09:05:00Z ; 7/23 KST 종료 == UTC 2026-07-23T15:00:00Z
const W_FROM_UTC = '2026-07-23T09:05:00.000Z';
const W_TO_UTC   = '2026-07-23T15:00:00.000Z';

// 뷰가 요구하는 풋 whitelist (recon_daily_view.sql 하드코딩 미러) — merchant 26 AND tid 26
const FOOT_MERCHANTS = new Set([
  '1777285001','1777285003','1777285004','1777285005','1777285006','1777285007','1777285008',
  '1777288001','1777288003','1777288004','1777288005','1777288006','1777288008',
  '1777289001','1777289002','1777289003','1777289004','1777289005','1777289006','1777289007',
  '1777289008','1777289009','1777289010','1777289011','1777289012','1777289013',
]);
const FOOT_TIDS = new Set([
  '1047479255','1047479254','1047479261','1047479268','1047479262','1047479263','1047479264',
  '1047479469','1047479471','1047479472','1047479473','1047479474','1047479475','1047479483',
  '1047479476','1047479477','1047479478','1047479479','1047479480','1047479481','1047479482',
  '1047479153','1047479148','1047479155','1047479158','1047479157',
]);
const BODY_MERCHANTS = new Set([
  '1777274001','1777275001','1777275002','1777275003','1777275004','1777275005','1777275006',
  '1777275007','1777275008','1777276001','1777276002','1777276003','1777276004','1777276005',
]);
// WHITELIST-EXPAND-0723GAP 신규 TID 5 + merchant 1 (아직 뷰 하드코딩에 미편입 = 탈락 후보)
const EXPAND_TIDS = new Set(['1047535845','1047535842','1047535837','1047535835','1047535797','1047535843']);
const EXPAND_MERCHANTS = new Set(['1777285002']);

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) { console.error(`  ❌ HTTP ${r.status} ${path}\n    ${await r.text()}`); return null; }
  return r.json();
}
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const kst = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-');
const domainOf = (mid) => mid == null ? 'NULL' : FOOT_MERCHANTS.has(mid) ? 'FOOT' : BODY_MERCHANTS.has(mid) ? 'BODY(도수)' : EXPAND_MERCHANTS.has(mid) ? 'FOOT-EXPAND' : 'OTHER';
const tidClass = (tid) => tid == null ? 'NULL' : FOOT_TIDS.has(tid) ? 'foot26' : EXPAND_TIDS.has(tid) ? 'expand(신규)' : 'other';
const inView = (mid, tid) => FOOT_MERCHANTS.has(mid) && FOOT_TIDS.has(tid); // 뷰 Part A 조건: merchant∧tid

console.log('══════════════════════════════════════════════════════════════');
console.log('T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG — READ-ONLY 진단');
console.log(`대상: 457/풋 · ${CLOSE_DATE} 18:05+ KST · clinic=${FOOT_CLINIC_ID}`);
console.log(`window UTC: ${W_FROM_UTC} ~ ${W_TO_UTC}`);
console.log(`인증컨텍스트: service_role (RLS bypass, 전건)`);
console.log(`현장 실측: 승인 9 / 취소 1  ↔  장첸 DB: 승인 7 / 취소 2`);
console.log('══════════════════════════════════════════════════════════════\n');

// ── [축A] redpay_raw_transactions 직접 (18:05+, 필터無 = 오염·탈락 전건 관측) ──
console.log('── [축A] redpay_raw_transactions 18:05+ (foot clinic, 필터無 전건) ──');
const raw = await q(`redpay_raw_transactions?clinic_id=eq.${FOOT_CLINIC_ID}&approved_at=gte.${W_FROM_UTC}&approved_at=lt.${W_TO_UTC}&select=id,approved_at,external_status,external_trxid,tid,amount,approval_no,matched_payment_id,raw_payload&order=approved_at.asc`);
const CANCEL = (s) => ['N','X','M'].includes(s);
let rawRows = [];
if (raw) {
  console.log(`  raw 총 건수(18:05+, 필터無): ${raw.length}건\n`);
  console.log('  # | 시각 | domain(merchant) | tid[class] | status | 금액 | approval_no | matched | 뷰포함?');
  console.log('  ' + '-'.repeat(110));
  for (const [i, r] of raw.entries()) {
    const mid = r?.raw_payload?.merchant?.id ? String(r.raw_payload.merchant.id) : null;
    const shown = inView(mid, r.tid);
    rawRows.push({ ...r, mid, shown });
    console.log(`  ${String(i+1).padStart(2)} | ${kst(r.approved_at)} | ${domainOf(mid).padEnd(11)} (${mid ?? 'NULL'}) | ${(r.tid ?? 'NULL')}[${tidClass(r.tid)}] | ${CANCEL(r.external_status)?'취소('+r.external_status+')':'승인('+r.external_status+')'} | ${won(r.amount)} | ${r.approval_no ?? '-'} | ${r.matched_payment_id?'Y':'-'} | ${shown?'✅뷰':'❌드롭'}`);
  }
  const appr = rawRows.filter(r => !CANCEL(r.external_status));
  const canc = rawRows.filter(r => CANCEL(r.external_status));
  console.log(`\n  [raw 집계] 승인계열 ${appr.length} / 취소계열 ${canc.length}`);
  console.log(`  [raw 도메인] foot=${rawRows.filter(r=>r.mid&&FOOT_MERCHANTS.has(r.mid)).length} / body(도수)=${rawRows.filter(r=>r.mid&&BODY_MERCHANTS.has(r.mid)).length} / expand=${rawRows.filter(r=>r.mid&&EXPAND_MERCHANTS.has(r.mid)).length} / NULL=${rawRows.filter(r=>!r.mid).length} / other=${rawRows.filter(r=>r.mid&&!FOOT_MERCHANTS.has(r.mid)&&!BODY_MERCHANTS.has(r.mid)&&!EXPAND_MERCHANTS.has(r.mid)).length}`);
}

// ── [축B] 뷰 v_redpay_reconciliation_daily 18:05+ (FE 표면값) ──
console.log('\n── [축B] v_redpay_reconciliation_daily 18:05+ (FE 표면값) ──');
const view = await q(`v_redpay_reconciliation_daily?clinic_id=eq.${FOOT_CLINIC_ID}&close_date=eq.${CLOSE_DATE}&anchor=eq.redpay&approved_at=gte.${W_FROM_UTC}&approved_at=lt.${W_TO_UTC}&select=row_id,approved_at,external_status,tid,van_amount,approval_no,recon_status,matched_payment_id&order=approved_at.asc`);
if (view) {
  const vAppr = view.filter(r => !CANCEL(r.external_status));
  const vCanc = view.filter(r => CANCEL(r.external_status));
  console.log(`  뷰 redpay-anchor 행수(18:05+): ${view.length}  (승인 ${vAppr.length} / 취소 ${vCanc.length})`);
  const byStatus = {};
  for (const r of view) byStatus[r.recon_status] = (byStatus[r.recon_status]||0)+1;
  console.log(`  recon_status: ${Object.entries(byStatus).map(([k,v])=>k+'='+v).join(' / ')}`);
  console.log('  ── 뷰 취소행(refund_not_in_crm 등) 상세 ──');
  for (const r of vCanc) console.log(`    ${kst(r.approved_at)} · tid=${r.tid} · ${r.external_status} · ${won(r.van_amount)} · appr_no=${r.approval_no} · ${r.recon_status}`);
}

// ── [축C] 취소 over-count 분해: 18:05+ 취소 raw 전건 도메인 대조 ──
console.log('\n── [축C] 취소 over-count 분해 (18:05+ 취소 raw 전건) ──');
const cancRaw = rawRows.filter(r => CANCEL(r.external_status));
console.log(`  18:05+ 취소 raw: ${cancRaw.length}건`);
for (const r of cancRaw) {
  console.log(`    · 시각 ${kst(r.approved_at)} | domain=${domainOf(r.mid)} mid=${r.mid} | tid=${r.tid}[${tidClass(r.tid)}] | ${won(r.amount)} | appr_no=${r.approval_no} | 뷰포함=${r.shown?'✅(풋457 count 포함)':'❌(뷰 드롭)'}`);
}

// ── [축D] 승인 under-count 분해: 18:05+ 승인 raw 중 뷰 드롭된 건 ──
console.log('\n── [축D] 승인 under-count 분해 (18:05+ 승인 raw 중 뷰 드롭) ──');
const apprRaw = rawRows.filter(r => !CANCEL(r.external_status));
const dropped = apprRaw.filter(r => !r.shown && r.mid && (FOOT_MERCHANTS.has(r.mid) || EXPAND_MERCHANTS.has(r.mid)));
console.log(`  18:05+ 승인 raw ${apprRaw.length}건 중 뷰 드롭(풋귀속인데 미표면) ${dropped.length}건:`);
for (const r of dropped) {
  const cause = (!FOOT_MERCHANTS.has(r.mid) && EXPAND_MERCHANTS.has(r.mid)) ? 'cause(b) merchant 신규(285002 whitelist밖)'
    : (r.tid == null) ? 'cause(a) tid=NULL payload-shape (VIEW-PAYLOAD-SHAPE-FIX)'
    : (!FOOT_TIDS.has(r.tid) && EXPAND_TIDS.has(r.tid)) ? 'cause(b) tid 신규(whitelist밖, TID-WHITELIST-EXPAND)'
    : (!FOOT_TIDS.has(r.tid)) ? 'cause(b) tid other(whitelist밖)' : '기타';
  console.log(`    · 시각 ${kst(r.approved_at)} | mid=${r.mid}(${domainOf(r.mid)}) | tid=${r.tid}[${tidClass(r.tid)}] | ${won(r.amount)} | → ${cause}`);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('진단 종료 (READ-ONLY, mutation 0)');
console.log('══════════════════════════════════════════════════════════════');
