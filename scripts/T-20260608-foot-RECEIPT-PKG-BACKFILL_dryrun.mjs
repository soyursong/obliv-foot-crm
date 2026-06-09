/**
 * T-20260608-foot-RECEIPT-PKG-BACKFILL — DRY-RUN (READ-ONLY, NO UPDATE/INSERT)
 *
 * 목적: payments.memo='영수증 업로드' 전 row(전체 기간)를 package_payments로
 *   소급 이관하기 전, 영향 범위/귀속 미리보기/no_package 건수를 리포트한다.
 *   *** 이 스크립트는 select 만 수행. 어떤 write 도 하지 않는다. ***
 *
 * 귀속 규칙 (스펙 확정):
 *   (b) 범위: memo='영수증 업로드' 전 row (활성 패키지 보유 무관)
 *   (c) 동일 고객 패키지 2개+ 우선순위:
 *       1) 활성(active) 中 가장 최근(contract_date desc, created_at desc) 1건
 *       2) 활성 없으면 → 가장 최근 패키지(상태 무관, contract_date desc, created_at desc)
 *       3) 패키지 0개 → no_package (자동 이관 보류, 별도 표기)
 *   (d) 금액 불일치: 무조건 이관, 금액 그대로 package_payments 귀속
 *
 * 스키마 주의(이관 실행 시 사전 차단 대상):
 *   - package_payments.method CHECK IN ('card','cash','transfer') — payments는 'membership' 허용.
 *     membership 결제건은 그대로 INSERT 불가 → 별도 플래그(method_incompatible).
 *   - payment_type='refund' 건은 환불 — 별도 플래그(refund_rows).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const ymd = (t) => (t ? String(t).slice(0, 10) : '-');

async function fetchAll(table, columns, filter) {
  const out = [];
  const PAGE = 1000;
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

console.log('=== T-20260608-foot-RECEIPT-PKG-BACKFILL DRY-RUN (READ-ONLY) ===');
console.log('실행시각:', new Date().toISOString());

// 1) 대상 payments
const pays = await fetchAll(
  'payments',
  'id,customer_id,amount,method,payment_type,memo,check_in_id,created_at',
  (q) => q.eq('memo', '영수증 업로드')
);
console.log(`\n[1] 대상 payments(memo='영수증 업로드') 총: ${pays.length} row`);

// 2) 대상 고객들의 packages 전수
const custIds = [...new Set(pays.map((p) => p.customer_id).filter(Boolean))];
const nullCust = pays.filter((p) => !p.customer_id);
console.log(`    고유 고객 수: ${custIds.length}` + (nullCust.length ? ` (customer_id NULL ${nullCust.length}건 포함X)` : ''));

const pkgsAll = [];
for (let i = 0; i < custIds.length; i += 200) {
  const chunk = custIds.slice(i, i + 200);
  const part = await fetchAll(
    'packages',
    'id,customer_id,package_name,status,total_amount,paid_amount,contract_date,created_at',
    (q) => q.in('customer_id', chunk)
  );
  pkgsAll.push(...part);
}
const pkgByCust = new Map();
for (const pk of pkgsAll) {
  if (!pkgByCust.has(pk.customer_id)) pkgByCust.set(pk.customer_id, []);
  pkgByCust.get(pk.customer_id).push(pk);
}

// 고객명
const custNames = new Map();
for (let i = 0; i < custIds.length; i += 200) {
  const chunk = custIds.slice(i, i + 200);
  const { data } = await sb.from('customers').select('id,name').in('id', chunk);
  (data || []).forEach((c) => custNames.set(c.id, c.name));
}

const cmpRecent = (a, b) => {
  const da = a.contract_date || a.created_at || '';
  const db = b.contract_date || b.created_at || '';
  if (db !== da) return db < da ? -1 : 1;
  return (b.created_at || '') < (a.created_at || '') ? -1 : 1;
};

function pick(customerId) {
  const list = (pkgByCust.get(customerId) || []).slice();
  if (list.length === 0) return { rule: 'no_package', pkg: null };
  const active = list.filter((p) => p.status === 'active').sort(cmpRecent);
  if (active.length) return { rule: active.length > 1 ? 'active_recent(multi)' : 'active_recent', pkg: active[0], pkgCount: list.length };
  const any = list.slice().sort(cmpRecent);
  return { rule: 'any_recent(no_active)', pkg: any[0], pkgCount: list.length };
}

// 3) 분류
let noPkg = 0, toActive = 0, toAny = 0, multi = 0;
let methodIncompat = 0, refundRows = 0, sumAmount = 0;
const rows = [];
for (const p of pays) {
  const r = p.customer_id ? pick(p.customer_id) : { rule: 'no_package', pkg: null };
  if (r.rule === 'no_package') noPkg++;
  else if (r.rule.startsWith('active')) { toActive++; if (r.rule.includes('multi')) multi++; }
  else toAny++;
  if (!['card', 'cash', 'transfer'].includes(p.method)) methodIncompat++;
  if (p.payment_type === 'refund') refundRows++;
  sumAmount += p.amount || 0;
  rows.push({
    name: custNames.get(p.customer_id) || (p.customer_id ? '(이름없음)' : '(고객없음)'),
    amount: p.amount, method: p.method, ptype: p.payment_type,
    paid_at: ymd(p.created_at), rule: r.rule,
    pkg: r.pkg ? `${r.pkg.package_name}[${r.pkg.status}] ${won(r.pkg.paid_amount)}/${won(r.pkg.total_amount)} (계약 ${ymd(r.pkg.contract_date)})` : '— (보류)',
    pkgCount: r.pkgCount || 0,
  });
}

console.log('\n[2] 귀속 분류 요약');
console.log(`    이관 가능 총액: ${won(sumAmount)}원`);
console.log(`    → 활성 패키지 귀속(1)        : ${toActive} (그중 패키지 2개+ 고객: ${multi})`);
console.log(`    → 활성없음·최근패키지 귀속(2): ${toAny}`);
console.log(`    → no_package 보류(3)         : ${noPkg}`);
console.log('\n[3] 이관 실행 시 사전 차단 필요 플래그');
console.log(`    method 비호환(membership 등, pkg CHECK 위반): ${methodIncompat}`);
console.log(`    payment_type='refund' (환불건)               : ${refundRows}`);
console.log(`    customer_id NULL                             : ${nullCust.length}`);

console.log('\n[4] 고객별 미리보기 (전체)');
console.log('고객 | 금액 | 결제수단 | type | 결제일 | 현재분류 → 귀속규칙 | 귀속패키지 | 고객패키지수');
for (const r of rows.sort((a, b) => (a.name > b.name ? 1 : -1))) {
  console.log(`${r.name} | ${won(r.amount)} | ${r.method} | ${r.ptype} | ${r.paid_at} | payments(단건) → ${r.rule} | ${r.pkg} | ${r.pkgCount}`);
}

console.log('\n=== DRY-RUN 끝 (write 없음) ===');
