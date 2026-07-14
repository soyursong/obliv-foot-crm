/**
 * T-20260714 ... MISU-CLEANUP — Phase A 미수 대사 DEEP-DIVE
 * *** READ-ONLY. SELECT 만. write 0 ***
 * 13개 1:1확정 매칭고객에 대해 잘못 남은 미수(패키지 잔금 / payment_waiting) + 당일 canonical 결제
 * 를 나란히 놓아 총괄 대사표를 만든다. Phase B 판정 근거(이중입력 vs 진짜 미링크) 구분용.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUG_DATE = '2026-07-14';

// 13 매칭 고객 (match 스크립트 결과 고정) — chart→id
const MATCHED = [
  ['F-4590', '전인호', '5bd0e924-c701-4b16-8865-a03c5a6edae1', 10000],
  ['F-4695', '이미현', 'a07a3079-69ba-415a-a0f8-61e8d0921168', 8900],
  ['F-4644', '최고',   'd2c91749-c6c3-498b-a3d4-12d5d26a67e8', 10000],
  ['F-4646', '박형규', '4c7fcad8-115d-4e80-a88d-65e2e24e81d4', 10000],
  ['F-4652', '진태주', '3210644b-04a5-4f24-b425-c3d10ae87dc9', 10000],
  ['F-4655', '마서현', '23d923ed-7cd9-4cbb-a169-bb64450ec3f2', 10000],
  ['F-4600', '최창수', '14889376-6f68-4222-8b76-14a22b16dd1d', 10000],
  ['F-4601', '정종석', '7d177461-cd0c-478b-b322-7c8498798ef5', 10000],
  ['F-4546', '김종형', 'd0a9a495-e068-4dba-a96e-b0366ab6c596', 10000],
  ['F-4696', '허유희', '4e051559-a7bf-4eee-9819-d626a26b6220', 3880000],
  ['F-4696', '허유희', '4e051559-a7bf-4eee-9819-d626a26b6220', 1000000],
  ['F-4597', '윤철희', '476038ed-5ed1-44c0-8a2b-2cfb2d7011b9', 10000],
  ['F-4687', '신용섭', '6b3f8373-3841-49af-b308-1f128d4b00cc', 10000],
];
const custIds = [...new Set(MATCHED.map((m) => m[2]))];

// 당일 canonical payments / package_payments
const { data: pay } = await sb.from('payments')
  .select('id, customer_id, amount, method, memo, created_at, check_in_id')
  .in('customer_id', custIds).gte('created_at', BUG_DATE + 'T00:00:00').lte('created_at', BUG_DATE + 'T23:59:59');
const { data: pp } = await sb.from('package_payments')
  .select('id, customer_id, package_id, amount, method, memo, created_at')
  .in('customer_id', custIds).gte('created_at', BUG_DATE + 'T00:00:00').lte('created_at', BUG_DATE + 'T23:59:59');

// 패키지 잔금(미수)
const { data: pkgs } = await sb.from('packages')
  .select('id, customer_id, package_name, total_amount, paid_amount, status')
  .in('customer_id', custIds);

// payment_waiting check_ins
const { data: pw } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status, checked_in_at')
  .in('customer_id', custIds).eq('status', 'payment_waiting');

const grp = (arr, k) => { const m = new Map(); for (const r of arr ?? []) { const id = r[k]; if (!m.has(id)) m.set(id, []); m.get(id).push(r); } return m; };
const payBy = grp(pay, 'customer_id'), ppBy = grp(pp, 'customer_id'), pkgBy = grp(pkgs, 'customer_id'), pwBy = grp(pw, 'customer_id');

console.log('================= 고객별 미수/결제 대사 (write 0) =================');
for (const id of custIds) {
  const m = MATCHED.find((x) => x[2] === id);
  const manualRows = MATCHED.filter((x) => x[2] === id);
  const manualSum = manualRows.reduce((s, x) => s + x[3], 0);
  const canonPay = (payBy.get(id) ?? []).reduce((s, r) => s + r.amount, 0);
  const canonPp = (ppBy.get(id) ?? []).reduce((s, r) => s + r.amount, 0);
  const pkgList = (pkgBy.get(id) ?? []).map((p) => ({ name: p.package_name, total: p.total_amount, paid: p.paid_amount, due: (p.total_amount ?? 0) - (p.paid_amount ?? 0), status: p.status }));
  const pkgDue = pkgList.reduce((s, p) => s + (p.due > 0 ? p.due : 0), 0);
  const pwCount = (pwBy.get(id) ?? []).length;
  console.log(JSON.stringify({
    chart: m[0], 성함: m[1], cust_id: id,
    수기입력_건수: manualRows.length, 수기입력_합계: manualSum,
    당일_canonical_payments: canonPay, 당일_canonical_pkgpay: canonPp,
    payment_waiting: pwCount, 패키지_미수합: pkgDue,
    패키지: pkgList,
  }));
}

console.log('\n================= Phase B 위험 플래그 =================');
const dual = custIds.filter((id) => (payBy.get(id)?.length || ppBy.get(id)?.length));
console.log('당일 canonical 결제 병존(이중입력 정밀검토 대상) 고객:', dual.length, dual);
console.log('\n✅ MISU DEEP-DIVE 완료 (READ-ONLY, write 0).');
