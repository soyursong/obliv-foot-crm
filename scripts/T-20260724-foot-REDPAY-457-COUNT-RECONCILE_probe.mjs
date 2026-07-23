// T-20260724-foot-REDPAY-457-COUNT-RECONCILE — READ-ONLY 관측 대사 probe
// ══════════════════════════════════════════════════════════════════════════
// 목적: 7/23 457/풋 결제 건수 정합 — 현장 재집계(승인24+취소1, net 10,779,980)
//       ↔ 시스템 레드페이 탭 count 대조. 분기 A(시점차이 확정) / B(진성 divergence).
// 스코프: mutation 0. SELECT only. write/DDL 없음.
// 인증컨텍스트: service_role (RLS bypass) — 진단 완전성 위해 전건 관측(cross-CRM
//   진단 인증컨텍스트 표준 준수: 0-row 를 "wipe"로 오독 금지, service_role 명시).
// PHI 위생: 산출물엔 count/금액/시각/소스경로만. 개별 환자 식별정보(name/phone/RRN) 제외.
//
// 3원 대조축:
//   (1) 레드페이 탭 뷰(v_redpay_reconciliation_daily) — FE 가 실제로 보는 숫자.
//       recon_status 별 집계 → "매칭-only 집계"인지 판별.
//   (2) redpay_raw_transactions 직접 count(풋 merchant 26-set, 7/23 KST window)
//       — 매칭 여부 무관 raw 실재. 웹훅 수신됐으나 미매칭인 건 여기서 드러남.
//   (3) payments(카드, 7/23 KST) — CRM 수납측. missing_at_van 규명용.
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CLOSE_DATE = '2026-07-23';
// KST(UTC+9) 7/23 00:00 ~ 7/24 00:00  ==  UTC 2026-07-22T15:00 ~ 2026-07-23T15:00
const KST_FROM_UTC = '2026-07-22T15:00:00.000Z';
const KST_TO_UTC   = '2026-07-23T15:00:00.000Z';

// 풋 merchant 26-set (redpay-foot-merchants.ts FOOT_MERCHANT_SET 미러)
const FOOT_MERCHANTS = [
  '1777285001','1777285003','1777285004','1777285005','1777285006','1777285007','1777285008',
  '1777288001','1777288003','1777288004','1777288005','1777288006','1777288008',
  '1777289001','1777289002','1777289003','1777289004','1777289005','1777289006','1777289007',
  '1777289008','1777289009','1777289010','1777289011','1777289012','1777289013',
];
const FOOT_TIDS = [
  '1047479255','1047479254','1047479261','1047479268','1047479262','1047479263','1047479264',
  '1047479469','1047479471','1047479472','1047479473','1047479474','1047479475','1047479483',
  '1047479476','1047479477','1047479478','1047479479','1047479480','1047479481','1047479482',
  '1047479153','1047479148','1047479155','1047479158','1047479157',
];

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) { console.error(`  ❌ HTTP ${r.status} ${path}\n    ${await r.text()}`); return null; }
  return r.json();
}
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const kst = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');

console.log('══════════════════════════════════════════════════════════════');
console.log('T-20260724-foot-REDPAY-457-COUNT-RECONCILE — READ-ONLY 관측 대사');
console.log(`대상: 457/풋 · close_date=${CLOSE_DATE} (KST) · clinic=${FOOT_CLINIC_ID}`);
console.log(`인증컨텍스트: service_role (RLS bypass, 전건 관측)`);
console.log(`현장 재집계값: 승인 24 + 취소 1 = 총 25건, net 10,779,980원`);
console.log('══════════════════════════════════════════════════════════════\n');

// ── 축1: 레드페이 탭 뷰 (FE 가 실제 보는 숫자) ────────────────────────────
console.log('── [축1] 레드페이 탭 뷰 v_redpay_reconciliation_daily (FE 표면값) ──');
const viewRows = await q(`v_redpay_reconciliation_daily?clinic_id=eq.${FOOT_CLINIC_ID}&close_date=eq.${CLOSE_DATE}&select=row_id,anchor,approved_at,external_status,tid,van_amount,crm_amount,recon_status,crm_created_at`);
if (viewRows) {
  const byStatus = {};
  let vanSum = 0, crmSum = 0, redpayAnchor = 0, crmAnchor = 0;
  for (const r of viewRows) {
    byStatus[r.recon_status] = (byStatus[r.recon_status] || 0) + 1;
    if (r.anchor === 'redpay') { redpayAnchor++; if (r.van_amount != null) vanSum += Number(r.van_amount); }
    else { crmAnchor++; if (r.crm_amount != null) crmSum += Number(r.crm_amount); }
  }
  console.log(`  뷰 총 행수: ${viewRows.length}  (redpay-anchor ${redpayAnchor} / crm-anchor ${crmAnchor})`);
  console.log(`  recon_status 분포:`);
  for (const [k, v] of Object.entries(byStatus)) console.log(`    · ${k}: ${v}건`);
  console.log(`  redpay-anchor van_amount 합: ${won(vanSum)}원`);
  console.log(`  crm-anchor(missing_at_van) crm_amount 합: ${won(crmSum)}원`);
  // FE 요약 카드가 세는 방식: sorted.length(=전체 뷰 행), matched, mismatch
  const matchedSet = new Set(['matched']);
  const matched = viewRows.filter(r => matchedSet.has(r.recon_status)).length;
  console.log(`  FE 요약카드: 레드페이수집 ${viewRows.length}건 / 매칭 ${matched}건 / 미매칭 ${viewRows.length - matched}건`);
}

// ── 축2: redpay_raw_transactions 직접(매칭·필터 무관 raw 실재) ──────────────
//   ⚠ 뷰 필터(tid IN whitelist)로 걸러내지 말 것 — 실거래 raw 는 tid=NULL 로 적재됨.
//   clinic_id + approved_at(7/23 KST) 로만 잡고, merchant/tid 는 분포 관측만.
console.log('\n── [축2] redpay_raw_transactions 직접 count (foot clinic, 7/23 KST, 필터無) ──');
const footSet = new Set(FOOT_MERCHANTS);
const bodySet = new Set([ // body 14-band (cross-center 테스트 유입 식별용)
  '1777274001','1777275001','1777275002','1777275003','1777275004','1777275005','1777275006',
  '1777275007','1777275008','1777276001','1777276002','1777276003','1777276004','1777276005',
]);
const raw = await q(`redpay_raw_transactions?clinic_id=eq.${FOOT_CLINIC_ID}&approved_at=gte.${KST_FROM_UTC}&approved_at=lt.${KST_TO_UTC}&select=id,approved_at,external_status,tid,amount,matched_payment_id,raw_payload&order=approved_at.asc`);
if (raw) {
  const APPROVED = (s) => !['N', 'X', 'M'].includes(s);   // N/X/M = 취소/거절 계열(뷰 refund_not_in_crm 기준)
  const approved = raw.filter(r => APPROVED(r.external_status));
  const cancelled = raw.filter(r => !APPROVED(r.external_status));
  const apprSum = approved.reduce((a, r) => a + Number(r.amount || 0), 0);
  const cancSum = cancelled.reduce((a, r) => a + Number(r.amount || 0), 0);
  const matched = raw.filter(r => r.matched_payment_id != null).length;
  let mFoot = 0, mNull = 0, mBody = 0, mOther = 0, tidNull = 0;
  for (const r of raw) {
    const mid = r?.raw_payload?.merchant?.id ? String(r.raw_payload.merchant.id) : null;
    if (!mid) mNull++; else if (footSet.has(mid)) mFoot++; else if (bodySet.has(mid)) mBody++; else mOther++;
    if (r.tid == null) tidNull++;
  }
  console.log(`  raw 총 건수(foot clinic, 7/23 KST, 필터無): ${raw.length}건`);
  console.log(`  merchant_id 판정: foot=${mFoot} / NULL=${mNull} / body(타센터)=${mBody} / other=${mOther}`);
  console.log(`  tid=NULL: ${tidNull}건  ← 뷰의 'AND tid IN(whitelist)' + 'merchant IN(foot)' 가 이들을 구조적 드롭`);
  console.log(`  승인계열(status∉N/X/M): ${approved.length}건, 합 ${won(apprSum)}원`);
  console.log(`  취소계열(status∈N/X/M): ${cancelled.length}건, 합 ${won(cancSum)}원`);
  console.log(`  net(승인합+취소합): ${won(apprSum + cancSum)}원`);
  console.log(`  이 중 matched_payment_id 있음: ${matched}건 / 미매칭: ${raw.length - matched}건`);
  console.log(`  ── 시각순 raw 목록(PHI 제외: 시각/merchant/tid/status/금액/매칭) ──`);
  for (const r of raw) {
    const mid = r?.raw_payload?.merchant?.id ?? 'NULL';
    console.log(`    ${kst(r.approved_at)} · mid=${mid} · tid=${r.tid ?? 'NULL'} · ${r.external_status} · ${won(r.amount)}원 · ${r.matched_payment_id ? 'matched' : 'UNMATCHED'}`);
  }
}

// ── 축3: payments 카드결제(CRM 수납측, 7/23 KST) ──────────────────────────
console.log('\n── [축3] payments 카드결제 (CRM 수납측, 7/23 KST) ──');
const pays = await q(`payments?clinic_id=eq.${FOOT_CLINIC_ID}&method=eq.card&payment_type=eq.payment&created_at=gte.${KST_FROM_UTC}&created_at=lt.${KST_TO_UTC}&select=id,amount,status,created_at,reconciled_at,external_trxid&order=created_at.asc`);
if (pays) {
  const live = pays.filter(p => (p.status || '') !== 'deleted');
  const reconciled = live.filter(p => p.reconciled_at != null || p.external_trxid != null);
  const sum = live.reduce((a, p) => a + Number(p.amount || 0), 0);
  console.log(`  CRM 카드수납(비삭제): ${live.length}건, 합 ${won(sum)}원`);
  console.log(`  이 중 대사완료(reconciled_at 또는 external_trxid 있음): ${reconciled.length}건`);
  console.log(`  미대사(레드페이 매칭 안된 CRM 카드): ${live.length - reconciled.length}건`);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('판정 가이드:');
console.log('  A) 축2 raw = 승인24+취소1(net 10,779,980) 근사 → 18→24 시점차이 확정 · 관측정상');
console.log('  B) 축2 raw < 현장 → 진성 divergence. 진원 3층:');
console.log('     (b1) 웹훅/폴러 부분수신: raw 자체가 현장보다 적음(미적재)');
console.log('     (b2) payload merchant/tid=NULL: 수신됐어도 뷰 whitelist 필터가 드롭 → 탭 미표면');
console.log('     (b3) 탭 count 착시: 탭 숫자는 CRM측 missing_at_van 행 위주(실 VAN 수신 아님)');
console.log('══════════════════════════════════════════════════════════════');
