/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — BACKFILL DRY-RUN (READ-ONLY)
 *
 * ⚠ 이 스크립트는 SELECT/시뮬레이션만 수행. 어떤 write 도 하지 않는다.
 *   실제 백필은 supervisor 게이트 승인 후 별도 _apply 스크립트로 집행한다.
 *
 * 대상: 체험권(trial) 시술이 선수금차감으로 처리되어 매출이 증발/오분류된 payment.
 *   분류 A. amount=0 + tax_type='선수금'  → 증발 (체험가만큼 매출 복구 필요)
 *   분류 B. tax_type='선수금' + amount>0  → 오분류 (금액은 있으나 선수금으로 잡힘)
 *   분류 C. payment 없음                  → 미수납 가능(진행중) — 백필 제외, 현장 확인 권고
 *
 * 제안 보정(승인 시):
 *   A: payments.amount = 체험가, tax_type=null(또는 면세_비급여), is_package_session=false 정정
 *   B: tax_type=null(또는 면세_비급여)로 재분류 (amount 유지)
 *   C: 백필 안 함 — 현장(총괄)에 수납 여부 확인 요청
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

const cis = await fetchAll('check_in_services', 'service_name, price, check_in_id');
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
const trialPrice = new Map();
for (const c of trialCis) trialPrice.set(c.check_in_id, (trialPrice.get(c.check_in_id) ?? 0) + (c.price ?? 0));
const pays = await fetchAll('payments', 'id, check_in_id, amount, method, payment_type, tax_type, accounting_date');
const byCi = new Map();
for (const p of pays) { if (!byCi.has(p.check_in_id)) byCi.set(p.check_in_id, []); byCi.get(p.check_in_id).push(p); }

const A = [], B = [], C = [];
for (const [ciId, price] of trialPrice) {
  const ps = (byCi.get(ciId) ?? []).filter((p) => p.payment_type === 'payment');
  if (ps.length === 0) { C.push({ ciId, price }); continue; }
  for (const p of ps) {
    if ((p.amount ?? 0) === 0 && p.tax_type === '선수금') A.push({ id: p.id, ciId, price, acct: p.accounting_date, method: p.method });
    else if (p.tax_type === '선수금' && (p.amount ?? 0) > 0) B.push({ id: p.id, ciId, amount: p.amount, acct: p.accounting_date, method: p.method });
  }
}

console.log('═══ BACKFILL DRY-RUN (NO WRITE) ═══\n');
console.log(`[A] amount=0 + 선수금 → 매출 복구 대상: ${A.length}건`);
for (const a of A) console.log(`    pay ${a.id?.slice(0,8)} ci ${a.ciId?.slice(0,8)} | ${won(0)} → ${won(a.price)} | acct=${a.acct} ${a.method}`);
console.log(`    복구액 합계: ${won(A.reduce((s,a)=>s+a.price,0))}원\n`);
console.log(`[B] 선수금 오분류(amount>0) → tax 재분류 대상: ${B.length}건`);
for (const b of B) console.log(`    pay ${b.id?.slice(0,8)} ci ${b.ciId?.slice(0,8)} | amount=${won(b.amount)} 유지, tax 선수금→면세 | acct=${b.acct} ${b.method}`);
console.log(`\n[C] payment 없음(진행중 가능) → 백필 제외, 현장 확인: ${C.length}건`);
for (const c of C) console.log(`    ci ${c.ciId?.slice(0,8)} | 체험가=${won(c.price)}`);
console.log(`\n총 매출 영향(A 복구): ${won(A.reduce((s,a)=>s+a.price,0))}원 / 오분류 정정(B): ${B.length}건 / 보류(C): ${C.length}건`);
console.log('\n⚠ 실제 집행 없음 — supervisor 게이트 승인 후 _apply 스크립트로 진행.');
