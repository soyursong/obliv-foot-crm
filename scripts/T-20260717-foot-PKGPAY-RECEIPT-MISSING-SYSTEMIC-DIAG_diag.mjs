/**
 * T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG — READ-ONLY 진단
 *   *** READ-ONLY. NO INSERT / NO UPDATE / NO DELETE. SELECT only. ***
 *
 * 배경(F-4857 forensic 승격): 회수1(total_sessions<=1) 패키지에 귀속된 영수증/추가결제 결제가
 *   payments INSERT + packages.paid_amount 직접가산만 하고 package_payments 를 만들지 않는다.
 *   그런데 loadCustomerOutstanding(footBilling.ts)은 pkg_due 를
 *     pkg_due = total_amount − Σsigned(package_payments WHERE fee_kind='package')
 *   로 파생 — package_payments 만 읽고 paid_amount 를 무시한다.
 *   → 회수1 패키지(total_amount>0)는 결제가 되었어도 package_payments 가 비어 pkg_due=total_amount
 *      의 phantom 미수로 표시된다.
 *
 * 버그경로(2 write-path, 코드 식별):
 *   (1) CustomerChartPage.tsx:918-946  memo='영수증 업로드(회수1·단건)'   (영수증 업로드)
 *   (2) Packages.tsx:1822-1848         memo='패키지 추가결제(회수1·단건)' (패키지관리 추가결제)
 *
 * 본 스크립트는 "단일 count 금지" 지침대로 지문을 계층화(L0 loose → L2 tight 교집합)해
 *   phantom 미수 후보 규모 + 대상 지문 스냅샷을 산출한다. 정정/백필은 후속 티켓(백필 SOP 게이트).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const ymd = (t) => (t ? String(t).slice(0, 10) : '-');

// 버그경로 서명 memo (정확일치)
const SIG_RECEIPT = '영수증 업로드(회수1·단건)';
const SIG_PKGADD = '패키지 추가결제(회수1·단건)';
const SIG_MEMOS = [SIG_RECEIPT, SIG_PKGADD];

async function fetchAll(table, columns, filter) {
  const out = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

console.log('=== T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG (READ-ONLY) ===');
console.log('실행시각:', new Date().toISOString());

// ── 0) 전체 packages 로드 (파생 미수 = loadCustomerOutstanding 과 동일 grain: active 만) ──
const pkgs = await fetchAll(
  'packages',
  'id,customer_id,clinic_id,package_name,status,total_sessions,total_amount,consultation_fee,paid_amount,contract_date,created_at',
);
const activePkgs = pkgs.filter((p) => p.status === 'active');
console.log(`\n[0] packages 총 ${pkgs.length} / active ${activePkgs.length}`);

// ── 1) package_payments 전량 (fee_kind='package' net 산출용) ──
const pps = await fetchAll('package_payments', 'package_id,amount,payment_type,fee_kind');
const netPkgByPkg = new Map(); // package_id → Σsigned(fee_kind='package')
const ppCountByPkg = new Map();
for (const r of pps) {
  ppCountByPkg.set(r.package_id, (ppCountByPkg.get(r.package_id) ?? 0) + 1);
  const fk = r.fee_kind ?? 'package';
  if (fk !== 'package') continue;
  const signed = r.payment_type === 'refund' ? -(r.amount ?? 0) : (r.amount ?? 0);
  netPkgByPkg.set(r.package_id, (netPkgByPkg.get(r.package_id) ?? 0) + signed);
}

// ── 2) 버그경로 서명 payments (memo 정확일치) — 고객·패키지 귀속 증거 ──
const sigPays = await fetchAll(
  'payments',
  'id,customer_id,amount,method,payment_type,status,deleted_at,memo,created_at',
  (q) => q.in('memo', SIG_MEMOS),
);
const activeSig = sigPays.filter((p) => (p.status ?? 'active') === 'active' && !p.deleted_at);
const sigByCust = new Map(); // customer_id → [payments]
for (const p of activeSig) {
  if (!p.customer_id) continue;
  const arr = sigByCust.get(p.customer_id) ?? []; arr.push(p); sigByCust.set(p.customer_id, arr);
}
console.log(`[1] 버그경로 서명 payments: ${sigPays.length} (active ${activeSig.length})`);
console.log(`    - '${SIG_RECEIPT}' : ${activeSig.filter((p) => p.memo === SIG_RECEIPT).length}`);
console.log(`    - '${SIG_PKGADD}'  : ${activeSig.filter((p) => p.memo === SIG_PKGADD).length}`);

// ── 3) 계층 지문 분류 ──────────────────────────────────────────────────────
// L0 (loose·단독 근거 금지): active + total_amount>0 + Σpackage_payments(pkg)=0 → pkg_due>0
// L1 : L0 ∩ 회수1(total_sessions<=1)   (isSinglePaymentByCount)
// L2 (tight 교집합·백필 대상): L1 ∩ paid_amount>0 ∩ 고객이 버그서명 payments 보유
const L0 = [], L1 = [], L2 = [];
let sumDueL0 = 0, sumDueL1 = 0, sumDueL2 = 0;
for (const p of activePkgs) {
  const total = p.total_amount ?? 0;
  const netPkg = netPkgByPkg.get(p.id) ?? 0;
  const pkgDue = Math.round(total - netPkg);
  if (!(pkgDue > 0)) continue;           // 미수 없음
  if (netPkg !== 0) continue;            // package_payments 가 있으면 phantom 아님(정상 부분납)
  // 여기까지: package_payments 비어있고 pkg_due>0
  L0.push(p); sumDueL0 += pkgDue;
  const isSingle = (p.total_sessions ?? 0) <= 1;
  if (!isSingle) continue;
  L1.push(p); sumDueL1 += pkgDue;
  const sigForCust = sigByCust.get(p.customer_id) ?? [];
  const hasPaid = (p.paid_amount ?? 0) > 0;
  // 버그서명 결제가 존재 + paid_amount>0 → 버그경로로 실제 결제됨(phantom 확정)
  if (hasPaid && sigForCust.length > 0) {
    L2.push({ pkg: p, sig: sigForCust, netPkg });
    sumDueL2 += pkgDue;
  }
}

console.log('\n[2] 계층 지문 규모 (단일 count 금지 — 교집합 계층화)');
console.log(`  L0 loose  (active·total>0·package_payments empty·pkg_due>0)         : ${L0.length} pkg / phantom합 ${won(sumDueL0)}원`);
console.log(`            ↑ 단독 근거 금지: '정말 미납' + '버그 phantom' 혼재`);
console.log(`  L1 회수1  (L0 ∩ total_sessions<=1 = isSinglePaymentByCount)         : ${L1.length} pkg / ${won(sumDueL1)}원`);
console.log(`  L2 TIGHT  (L1 ∩ paid_amount>0 ∩ 고객 버그서명 payments 보유)        : ${L2.length} pkg / ${won(sumDueL2)}원  ← phantom 미수 확정·백필 대상`);

// L1 중 L2 제외분(회수1인데 서명/paid_amount 증거 부족) 잔차 — 별도 분류(오탐 방지)
const l2ids = new Set(L2.map((x) => x.pkg.id));
const L1_resid = L1.filter((p) => !l2ids.has(p.id));
console.log(`  L1\\L2 잔차(회수1·phantom형이나 버그서명 미보유=수동/미납 의심) : ${L1_resid.length} pkg (백필 제외·개별확인)`);

// 서명 payments 는 있으나 매칭 phantom pkg 가 없는 케이스(이미 정상/삭제/환불상쇄) — 역방향 점검
const custWithPhantom = new Set(L2.map((x) => x.pkg.customer_id));
const sigCustNoPhantom = [...sigByCust.keys()].filter((c) => !custWithPhantom.has(c));
console.log(`\n[3] 역방향: 버그서명 payments 보유 고객 ${sigByCust.size}명 中 phantom pkg 없음 ${sigCustNoPhantom.length}명`);
console.log(`    (패키지 삭제/비활성·환불상쇄·이미 정합 → 백필 불요, 참고용)`);

// ── 4) L2 대상 지문 스냅샷 ──────────────────────────────────────────────────
const custIds = [...new Set(L2.map((x) => x.pkg.customer_id).filter(Boolean))];
const custNames = new Map();
for (let i = 0; i < custIds.length; i += 200) {
  const { data } = await sb.from('customers').select('id,name,chart_number').in('id', custIds.slice(i, i + 200));
  (data || []).forEach((c) => custNames.set(c.id, c));
}

console.log('\n[4] L2 phantom 미수 확정 지문 스냅샷 (백필 대상 후보)');
console.log('chart | 고객 | pkg_id | pkg명 | 회차 | total | paid_amt | pkg_due(phantom) | 서명결제(memo/amt/type) | 계약일');
const snapshot = [];
for (const { pkg: p, sig } of L2.sort((a, b) => (custNames.get(a.pkg.customer_id)?.chart_number || '').localeCompare(custNames.get(b.pkg.customer_id)?.chart_number || ''))) {
  const c = custNames.get(p.customer_id) || {};
  const total = p.total_amount ?? 0;
  const pkgDue = Math.round(total - (netPkgByPkg.get(p.id) ?? 0));
  const sigDesc = sig.map((s) => `${s.memo.includes('영수증') ? '영수증' : '추가결제'}/${won(s.amount)}/${s.payment_type}`).join(' + ');
  console.log(`${c.chart_number || '-'} | ${c.name || '(이름없음)'} | ${p.id.slice(0, 8)} | ${p.package_name} | ${p.total_sessions} | ${won(total)} | ${won(p.paid_amount)} | ${won(pkgDue)} | ${sigDesc} | ${ymd(p.contract_date)}`);
  snapshot.push({
    chart_number: c.chart_number, customer_id: p.customer_id, customer_name: c.name,
    package_id: p.id, package_name: p.package_name, total_sessions: p.total_sessions,
    total_amount: total, paid_amount: p.paid_amount, phantom_pkg_due: pkgDue,
    package_payments_count: ppCountByPkg.get(p.id) ?? 0,
    signature_payments: sig.map((s) => ({ id: s.id, memo: s.memo, amount: s.amount, payment_type: s.payment_type, created_at: s.created_at })),
    contract_date: p.contract_date, created_at: p.created_at,
  });
}

// paid_amount vs total_amount 정합(완납 여부) 요약
const fullPaid = L2.filter((x) => (x.pkg.paid_amount ?? 0) >= (x.pkg.total_amount ?? 0)).length;
console.log(`\n[5] L2 정합 요약: paid_amount>=total_amount(완납) ${fullPaid}/${L2.length}`);
console.log(`    phantom 미수 총액(L2 pkg_due 합): ${won(sumDueL2)}원`);

// 스냅샷 파일 저장 (READ-ONLY 산출물 — DB write 아님)
const outPath = new URL('./T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG_SNAPSHOT.json', import.meta.url);
readFileSync; // noop guard
const { writeFileSync } = await import('node:fs');
writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  layers: { L0: L0.length, L1: L1.length, L2: L2.length, L1_resid: L1_resid.length },
  phantom_due_sum: { L0: sumDueL0, L1: sumDueL1, L2: sumDueL2 },
  signature_payments_active: activeSig.length,
  snapshot,
}, null, 2));
console.log(`\n스냅샷 저장: ${outPath.pathname}`);
console.log('\n=== 진단 끝 (write 없음). 정정/백필은 후속 티켓 + 백필 SOP 게이트. ===');
