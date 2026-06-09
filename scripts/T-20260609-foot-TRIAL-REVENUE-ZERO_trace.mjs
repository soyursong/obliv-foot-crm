/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — TRACE (READ-ONLY)
 * 체험 시술 check_in → 연결 payment 의 amount/method/tax_type 추적.
 * 체험권 단건 매출이 어떻게 기록(또는 증발)되는지 확정.
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

// 체험 check_in_services → check_in_id 모음
const cis = await fetchAll('check_in_services', 'id, service_name, price, is_package_session, check_in_id');
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
const trialCiIds = [...new Set(trialCis.map((c) => c.check_in_id))];
console.log(`체험 check_in_services: ${trialCis.length}건 / 고유 check_in: ${trialCiIds.length}건\n`);

// 해당 check_in의 payments 전부
const allPays = await fetchAll('payments', 'id, check_in_id, amount, method, payment_type, tax_type, status, accounting_date');
const byCi = new Map();
for (const p of allPays) {
  if (!byCi.has(p.check_in_id)) byCi.set(p.check_in_id, []);
  byCi.get(p.check_in_id).push(p);
}

let zeroAmt = 0, prepaidTax = 0, normalRev = 0, noPay = 0;
console.log('check_in별 체험 시술 ↔ payment 매칭:');
for (const ciId of trialCiIds) {
  const ciTrials = trialCis.filter((c) => c.check_in_id === ciId);
  const pays = byCi.get(ciId) ?? [];
  const trialPrice = ciTrials.reduce((s, c) => s + (c.price ?? 0), 0);
  const isPkgSess = ciTrials.some((c) => c.is_package_session === true);
  if (pays.length === 0) { noPay++; }
  for (const p of pays) {
    const net = p.payment_type === 'refund' ? -p.amount : p.amount;
    if ((p.amount ?? 0) === 0) zeroAmt++;
    if (p.tax_type === '선수금') prepaidTax++;
    if ((p.amount ?? 0) > 0 && p.tax_type !== '선수금') normalRev++;
  }
  const payStr = pays.length
    ? pays.map((p) => `amt=${won(p.amount)}/${p.method}/${p.tax_type ?? 'null'}/${p.payment_type}`).join(' ; ')
    : '★결제없음';
  console.log(`  ci ${ciId?.slice(0,8)} | 체험가=${won(trialPrice)} | pkgSess=${isPkgSess} | acct=${pays[0]?.accounting_date ?? '-'} → ${payStr}`);
}

console.log('\n── 요약 ──');
console.log(`체험 시술 있는 check_in: ${trialCiIds.length}건`);
console.log(`  결제없음(payment 0건): ${noPay}건`);
console.log(`  payment amount=0: ${zeroAmt}건  ← 매출 0 증발 의심`);
console.log(`  payment tax_type='선수금'(차감): ${prepaidTax}건  ← 선수금차감=매출제외`);
console.log(`  payment 정상매출(amount>0, tax≠선수금): ${normalRev}건`);
