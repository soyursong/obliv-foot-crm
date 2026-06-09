/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — SCOPE (READ-ONLY)
 * 1) 체험권 deduction 으로 증발한 매출 범위 산정 (백필 후보)
 * 2) 정상 4종 패키지의 paid_amount/package_payments 대조 (체험권과 차이 입증)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
async function fetchAll(table, columns, filter) {
  const out = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < PAGE) break;
  }
  return out;
}

// ── A. 체험권 deduction 증발 매출 ──────────────────────────────────
// 체험 check_in_service 가 있는 check_in 중, payment 가 amount=0 또는 tax_type='선수금'
const cis = await fetchAll('check_in_services', 'id, service_name, price, is_package_session, check_in_id');
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
const trialCiPrice = new Map(); // ci → 체험 합가
for (const c of trialCis) trialCiPrice.set(c.check_in_id, (trialCiPrice.get(c.check_in_id) ?? 0) + (c.price ?? 0));
const allPays = await fetchAll('payments', 'id, check_in_id, amount, method, payment_type, tax_type, accounting_date');
const byCi = new Map();
for (const p of allPays) { if (!byCi.has(p.check_in_id)) byCi.set(p.check_in_id, []); byCi.get(p.check_in_id).push(p); }

const lost = [];
for (const [ciId, price] of trialCiPrice) {
  const pays = (byCi.get(ciId) ?? []).filter((p) => p.payment_type === 'payment');
  if (pays.length === 0) { lost.push({ ciId, kind: 'no_payment', expect: price, got: 0, acct: '-' }); continue; }
  for (const p of pays) {
    const isZero = (p.amount ?? 0) === 0;
    const isPrepaid = p.tax_type === '선수금';
    if (isZero) lost.push({ ciId, kind: 'amount_zero(선수금차감)', expect: price, got: 0, acct: p.accounting_date, method: p.method });
    else if (isPrepaid) lost.push({ ciId, kind: 'amount있음_but_선수금분류', expect: price, got: p.amount, acct: p.accounting_date, method: p.method });
  }
}
console.log('═══ A. 체험권 매출 증발/오분류 후보 ═══');
let lostSum = 0;
for (const l of lost) {
  if (l.kind.startsWith('amount_zero') || l.kind === 'no_payment') lostSum += l.expect;
  console.log(`  ci ${l.ciId?.slice(0,8)} | ${l.kind} | 기대=${won(l.expect)} 실제=${won(l.got)} | acct=${l.acct} ${l.method ?? ''}`);
}
console.log(`  ▶ 완전 증발(amount=0/no_payment) 추정 손실: ${won(lostSum)}원 (${lost.filter(l=>l.kind.startsWith('amount_zero')||l.kind==='no_payment').length}건)`);
console.log(`  ▶ 선수금 오분류(금액은 있음): ${lost.filter(l=>l.kind.startsWith('amount있음')).length}건\n`);

// ── B. 정상 4종 vs 체험권 패키지 paid_amount 대조 ──────────────────
const pkgs = await fetchAll('packages', 'id, package_name, total_amount, paid_amount, heated_sessions, unheated_sessions, podologe_sessions, iv_sessions, trial_sessions, status');
const allPkgPays = await fetchAll('package_payments', 'package_id, amount, payment_type');
const paidByPkg = new Map();
for (const pp of allPkgPays) paidByPkg.set(pp.package_id, (paidByPkg.get(pp.package_id) ?? 0) + (pp.payment_type === 'refund' ? -pp.amount : pp.amount));

const isTrialOnly = (p) => (p.trial_sessions > 0 || /체험/.test(p.package_name ?? '')) &&
  !(p.heated_sessions > 0 || p.unheated_sessions > 0 || p.podologe_sessions > 0 || p.iv_sessions > 0);
const trialPkgs = pkgs.filter(isTrialOnly);
const multiPkgs = pkgs.filter((p) => !isTrialOnly(p) && (p.heated_sessions>0||p.unheated_sessions>0||p.podologe_sessions>0||p.iv_sessions>0));

const cnt = (arr) => {
  const withPP = arr.filter((p) => (paidByPkg.get(p.id) ?? 0) > 0).length;
  return { total: arr.length, withPP, withoutPP: arr.length - withPP };
};
const t = cnt(trialPkgs), m = cnt(multiPkgs);
console.log('═══ B. 패키지 유형별 package_payments 보유율 ═══');
console.log(`  체험권 전용 패키지: ${t.total}건 | package_payments 있음 ${t.withPP}건 / 없음 ${t.withoutPP}건`);
console.log(`  다회차(4종) 패키지: ${m.total}건 | package_payments 있음 ${m.withPP}건 / 없음 ${m.withoutPP}건`);
console.log(`  → 체험권은 구매결제(package_payments)가 거의 없어 차감 시 매출 증발. 4종은 구매결제 보유 → 정상.`);
