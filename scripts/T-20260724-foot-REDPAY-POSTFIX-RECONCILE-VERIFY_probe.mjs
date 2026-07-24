// T-20260724-foot-REDPAY-POSTFIX-RECONCILE-VERIFY — READ-ONLY 사후 최종 정합 검증
// ══════════════════════════════════════════════════════════════════════════
// 목적: 선결 fix 전부 deployed 상태에서 풋 레드페이 현장 실측 100% 수렴 확인.
//   선결: WHITELIST-EXPAND-0723GAP(풋2=1777285002 + TID5단말 편입, 7/23 재pull)
//         VIEW-PAYLOAD-SHAPE-FIX(탭 표면화) · 1805PLUS-RESIDUAL-CAPTURE-RC(잔여3 수렴)
//
// 스코프: READ-ONLY 엄수. SELECT only. write/DDL/upsert 0, db_change=false.
// 인증컨텍스트: service_role (RLS bypass) — 진단 완전성 위해 전건 관측(cross-CRM
//   진단 인증컨텍스트 표준: 0-row 를 "wipe"로 오독 금지, service_role 명시).
// PHI 위생: 산출물엔 count/금액/시각/approval_no/tid/merchant_id 만. name/phone/RRN 제외.
//
// AC1: 7/23 확정 1:1 대조 — raw + 레드페이 탭 뷰 → 현장 24승인+1취소/net10,779,980
//      과 approval_no 1:1. 도수 1건(approval_no=62071914, mid=1777276003) 제외(분리).
// AC2: 7/24 실시간 근사 대조 — 지금 시점 수신분 건수·net vs 현장 26/net9,049,200.
//      마감 전 시점차 명시 + 실시간 유입 정상(수신 0 아님) 확인.
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

// KST(UTC+9) → UTC window helpers
const D23_FROM = '2026-07-22T15:00:00.000Z'; // 7/23 00:00 KST
const D23_TO   = '2026-07-23T15:00:00.000Z'; // 7/24 00:00 KST
const D24_FROM = '2026-07-23T15:00:00.000Z'; // 7/24 00:00 KST
const D24_TO   = '2026-07-24T15:00:00.000Z'; // 7/25 00:00 KST

// 풋 merchant 27-set = SSOT 26-set + 0723GAP 신규편입 풋2 (1777285002)
const FOOT_MERCHANTS = new Set([
  '1777285001','1777285002','1777285003','1777285004','1777285005','1777285006','1777285007','1777285008',
  '1777288001','1777288003','1777288004','1777288005','1777288006','1777288008',
  '1777289001','1777289002','1777289003','1777289004','1777289005','1777289006','1777289007',
  '1777289008','1777289009','1777289010','1777289011','1777289012','1777289013',
]);
const BODY_MERCHANTS = new Set([
  '1777274001','1777275001','1777275002','1777275003','1777275004','1777275005','1777275006',
  '1777275007','1777275008','1777276001','1777276002','1777276003','1777276004','1777276005',
]);
// 도수 혼입 분리 대상 (본 대조에서 제외)
const DOSU_APPROVAL = '62071914';
const DOSU_MID = '1777276003';

// 승인/취소 판별 (뷰 refund_not_in_crm 기준과 동일: N/X/M = 취소·거절 계열)
const CANCEL_STATUS = new Set(['N', 'X', 'M']);
const isApproved = (s) => !CANCEL_STATUS.has(s);
// merchant_id 는 두 payload shape 모두 지원:
//   · 폴러 shape: raw_payload.merchant.id
//   · 웹훅 shape (VIEW-PAYLOAD-SHAPE-FIX): raw_payload.data.merchant_id (event envelope)
const midOf = (r) => {
  const p = r?.raw_payload;
  if (!p) return null;
  if (p.merchant?.id) return String(p.merchant.id);      // poller shape
  if (p.data?.merchant_id) return String(p.data.merchant_id); // webhook shape
  return null;
};
const centerOf = (mid) => (mid == null ? 'NULL' : FOOT_MERCHANTS.has(mid) ? 'foot' : BODY_MERCHANTS.has(mid) ? 'body' : 'other');

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const kst = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) { console.error(`  ❌ HTTP ${r.status} ${path}\n    ${await r.text()}`); return null; }
  return r.json();
}

console.log('══════════════════════════════════════════════════════════════');
console.log('T-20260724-foot-REDPAY-POSTFIX-RECONCILE-VERIFY — READ-ONLY 관측 대사');
console.log(`대상: 457/풋 · clinic=${FOOT_CLINIC_ID} · 인증컨텍스트: service_role`);
console.log(`실행시각(KST): ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
console.log('현장 실측 기준값:');
console.log('  7/23(완결): 승인 24 + 취소 1 / net 10,779,980 (승인합 10,780,984 − 취소 1,004)');
console.log('              도수 혼입 1건(approval_no=62071914, mid=1777276003) 분리 상태');
console.log('  7/24(진행중): 승인 26 / net 9,049,200 (point-in-time, 마감 전)');
console.log('══════════════════════════════════════════════════════════════');

// ══════════════════════════════════════════════════════════════════════════
// AC1 — 7/23 확정 1:1 대조
// ══════════════════════════════════════════════════════════════════════════
async function reconcileDay(label, from, to, isConfirmed) {
  console.log(`\n\n████ ${label} ████`);

  // ── raw (필터無, foot clinic) ──────────────────────────────────────────
  const raw = await q(`redpay_raw_transactions?clinic_id=eq.${FOOT_CLINIC_ID}&approved_at=gte.${from}&approved_at=lt.${to}&select=id,approved_at,external_status,approval_no,tid,root_trxid,amount,matched_payment_id,raw_payload&order=approved_at.asc`);
  if (!raw) return null;

  // 센터 분해 + 도수 혼입 분리
  const foot = [], body = [], other = [], nul = [];
  let dosuHit = null;
  for (const r of raw) {
    const mid = midOf(r);
    const c = centerOf(mid);
    if (String(r.approval_no) === DOSU_APPROVAL || mid === DOSU_MID) { dosuHit = { r, mid }; }
    if (c === 'foot') foot.push(r);
    else if (c === 'body') body.push(r);
    else if (c === 'other') other.push(r);
    else nul.push(r);
  }

  console.log(`\n── [raw] redpay_raw_transactions (foot clinic, ${label.split(' ')[0]} KST, 필터無) ──`);
  console.log(`  raw 총 ${raw.length}건 → 센터분해: foot=${foot.length} / body(도수·타센터)=${body.length} / other=${other.length} / NULL=${nul.length}`);
  if (body.length) {
    console.log(`  ⓘ body-merchant(도수 혼입/타센터) ${body.length}건 = 풋 집계 제외(분리):`);
    for (const r of body) console.log(`     - ${kst(r.approved_at)} · mid=${midOf(r)} · appr=${r.approval_no ?? 'NULL'} · ${r.external_status} · ${won(r.amount)}원`);
  }
  if (dosuHit) {
    console.log(`  ✓ 도수 분리 대상 확인: approval_no=${dosuHit.r.approval_no} · mid=${dosuHit.mid} · ${won(dosuHit.r.amount)}원 · center=${centerOf(dosuHit.mid)} → 풋 집계 제외 OK`);
  } else {
    console.log(`  ⚠ 도수 분리 대상(appr=${DOSU_APPROVAL}/mid=${DOSU_MID}) 이 이 window raw 에 없음 (이미 별도 분리됐거나 다른 날짜)`);
  }

  // 풋 승인/취소 집계
  const fAppr = foot.filter(r => isApproved(r.external_status));
  const fCanc = foot.filter(r => !isApproved(r.external_status));
  const apprSum = fAppr.reduce((a, r) => a + Number(r.amount || 0), 0);
  const cancSumAbs = fCanc.reduce((a, r) => a + Math.abs(Number(r.amount || 0)), 0);
  const cancSumRaw = fCanc.reduce((a, r) => a + Number(r.amount || 0), 0);
  // net = 승인합 − 취소합(절대값). raw amount 부호는 상황따라 다르므로 둘 다 표기.
  const netAbs = apprSum - cancSumAbs;
  const netRaw = apprSum + cancSumRaw;

  console.log(`\n── [풋 raw 집계] (도수·타센터 분리 후) ──`);
  console.log(`  풋 승인계열: ${fAppr.length}건 / 합 ${won(apprSum)}원`);
  console.log(`  풋 취소계열: ${fCanc.length}건 / |합| ${won(cancSumAbs)}원 (raw합 ${won(cancSumRaw)})`);
  console.log(`  풋 net(승인−|취소|): ${won(netAbs)}원   [raw부호합: ${won(netRaw)}]`);
  const tidNull = foot.filter(r => r.tid == null).length;
  const matched = foot.filter(r => r.matched_payment_id != null).length;
  console.log(`  풋 tid=NULL: ${tidNull}건 / matched_payment_id 보유: ${matched}건 / 미매칭: ${foot.length - matched}건`);

  // approval_no 1:1 목록
  console.log(`\n── [풋 approval_no 1:1 목록] (시각순, PHI 제외) ──`);
  console.log(`  #  승인시각(KST)   approval_no   tid          mid          status  금액        매칭`);
  foot.forEach((r, i) => {
    const flag = isApproved(r.external_status) ? '승인' : '취소';
    console.log(`  ${String(i + 1).padStart(2)} ${kst(r.approved_at)}  ${String(r.approval_no ?? 'NULL').padEnd(11)} ${String(r.tid ?? 'NULL').padEnd(12)} ${String(midOf(r) ?? 'NULL').padEnd(12)} ${r.external_status.padEnd(4)} ${flag} ${won(r.amount).padStart(11)}  ${r.matched_payment_id ? 'M' : '-'}`);
  });

  // ── 레드페이 탭 뷰 ─────────────────────────────────────────────────────
  const dateStr = from === D23_FROM ? '2026-07-23' : '2026-07-24';
  const viewRows = await q(`v_redpay_reconciliation_daily?clinic_id=eq.${FOOT_CLINIC_ID}&close_date=eq.${dateStr}&select=row_id,anchor,approved_at,external_status,tid,van_amount,crm_amount,recon_status`);
  console.log(`\n── [레드페이 탭 뷰] v_redpay_reconciliation_daily (close_date=${dateStr}) ──`);
  if (viewRows) {
    const byStatus = {};
    let vanSum = 0, redpayAnchor = 0, crmAnchor = 0;
    for (const r of viewRows) {
      byStatus[r.recon_status] = (byStatus[r.recon_status] || 0) + 1;
      if (r.anchor === 'redpay') { redpayAnchor++; if (r.van_amount != null) vanSum += Number(r.van_amount); }
      else crmAnchor++;
    }
    console.log(`  뷰 총 행수: ${viewRows.length} (redpay-anchor ${redpayAnchor} / crm-anchor ${crmAnchor})`);
    console.log(`  recon_status 분포: ${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(' / ')}`);
    console.log(`  redpay-anchor van_amount 합: ${won(vanSum)}원`);
  }

  return { rawCount: raw.length, foot, fAppr, fCanc, apprSum, cancSumAbs, netAbs, body, dosuHit, viewRows };
}

const r23 = await reconcileDay('7/23 (하루 완결) — AC1 확정 1:1 대조', D23_FROM, D23_TO, true);

// ── AC1 판정 ────────────────────────────────────────────────────────────
console.log('\n\n══════════ AC1 판정 (7/23 현장 vs 시스템) ══════════');
if (r23) {
  const FIELD_APPR = 24, FIELD_CANC = 1, FIELD_NET = 10779980, FIELD_APPRSUM = 10780984, FIELD_CANCSUM = 1004;
  const dAppr = r23.fAppr.length - FIELD_APPR;
  const dCanc = r23.fCanc.length - FIELD_CANC;
  const dApprSum = r23.apprSum - FIELD_APPRSUM;
  const dCancSum = r23.cancSumAbs - FIELD_CANCSUM;
  const dNet = r23.netAbs - FIELD_NET;
  console.log(`  항목          현장          시스템(풋raw)   델타`);
  console.log(`  승인 건수     ${String(FIELD_APPR).padStart(6)}        ${String(r23.fAppr.length).padStart(6)}         ${dAppr === 0 ? '✅ 0' : (dAppr > 0 ? '+' : '') + dAppr}`);
  console.log(`  취소 건수     ${String(FIELD_CANC).padStart(6)}        ${String(r23.fCanc.length).padStart(6)}         ${dCanc === 0 ? '✅ 0' : (dCanc > 0 ? '+' : '') + dCanc}`);
  console.log(`  승인 합       ${won(FIELD_APPRSUM).padStart(11)}   ${won(r23.apprSum).padStart(11)}    ${dApprSum === 0 ? '✅ 0' : won(dApprSum)}`);
  console.log(`  취소 합       ${won(FIELD_CANCSUM).padStart(11)}   ${won(r23.cancSumAbs).padStart(11)}    ${dCancSum === 0 ? '✅ 0' : won(dCancSum)}`);
  console.log(`  net           ${won(FIELD_NET).padStart(11)}   ${won(r23.netAbs).padStart(11)}    ${dNet === 0 ? '✅ 0' : won(dNet)}`);
  const allMatch = dAppr === 0 && dCanc === 0 && dNet === 0;
  console.log(`\n  ▶ AC1 판정: ${allMatch ? '✅ 100% 수렴 확정 → 다음 단계 가능' : '❌ 불일치 — 아래 갭 분해 참조'}`);
  if (!allMatch) {
    console.log('  갭 분해 소스:');
    if (dAppr !== 0 || dCanc !== 0) console.log(`    · 건수 델타 → whitelist(신규merchant 미편입) / 도수분리 오차 / webhook 부분수신 점검`);
    if (dNet !== 0) console.log(`    · 금액 델타 ${won(dNet)} → 취소부호/부분취소/도수혼입 잔류 점검`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AC2 — 7/24 실시간 근사 대조
// ══════════════════════════════════════════════════════════════════════════
const r24 = await reconcileDay('7/24 (진행중, 근사) — AC2 실시간 대조', D24_FROM, D24_TO, false);

console.log('\n\n══════════ AC2 판정 (7/24 현장 point-in-time vs 시스템 현재) ══════════');
if (r24) {
  const FIELD_APPR_24 = 26, FIELD_NET_24 = 9049200;
  console.log(`  ⓘ 현장값(승인26/net9,049,200)은 7/24 진행중(마감 전) point-in-time 스냅샷.`);
  console.log(`  ⓘ 본 probe 실행은 7/25 → 7/24 는 이미 마감. 시스템은 현장 스냅샷 이후 유입분까지 포함 → 시스템 ≥ 현장 이 정상.`);
  console.log(`  항목          현장(진행중)   시스템(풋raw, 현재)`);
  console.log(`  승인 건수     ${String(FIELD_APPR_24).padStart(6)}         ${String(r24.fAppr.length).padStart(6)}`);
  console.log(`  net           ${won(FIELD_NET_24).padStart(11)}    ${won(r24.netAbs).padStart(11)}`);
  const liveOk = r24.foot.length > 0;
  const monotone = r24.fAppr.length >= FIELD_APPR_24;
  console.log(`\n  ▶ 실시간 유입 정상(수신>0): ${liveOk ? '✅ ' + r24.foot.length + '건 수신' : '❌ 0건 — 웹훅/폴러 중단 의심'}`);
  console.log(`  ▶ 시점차 정합(시스템≥현장): ${monotone ? '✅ ' + r24.fAppr.length + ' ≥ ' + FIELD_APPR_24 + ' (스냅샷 이후 유입 반영)' : '⚠ 시스템 < 현장 — 역전, 미적재 의심'}`);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('probe 종료 — READ-ONLY (write/DDL/upsert 0). db_change=false.');
console.log('══════════════════════════════════════════════════════════════');
