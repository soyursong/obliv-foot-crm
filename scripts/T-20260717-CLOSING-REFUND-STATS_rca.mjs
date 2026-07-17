/**
 * T-20260717-foot-CLOSING-REFUND-STATS-MISSING — RCA probe (NON-MUTATING, read-only)
 * 재현 케이스: 차트 F-4840 / 홍미옥 / 환불 350,000 / 발생 2026-07-17
 * 목표: 결제내역 탭 (a)목록 (b)매출합계 (c)담당자별매출 어디서 탈락하는지 집계소스 추적.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CHART = 'F-4840';
const NAME = '홍미옥';

// 0) 고객 조회
const { data: custs } = await sb.from('customers')
  .select('id, name, chart_number, clinic_id')
  .or(`chart_number.eq.${CHART},name.eq.${NAME}`);
console.log('=== 0) customers 매칭 ===');
console.log(JSON.stringify(custs, null, 2));
const cust = (custs ?? []).find(c => c.chart_number === CHART) || (custs ?? [])[0];
if (!cust) { console.log('고객 없음 — 종료'); process.exit(0); }
const cid = cust.id;

// 1) payments 전체 (환불 포함) — created_at 값 확인
const { data: pays } = await sb.from('payments')
  .select('id, amount, method, payment_type, created_at, clinic_id, status, linked_payment_id, memo')
  .eq('customer_id', cid)
  .order('created_at', { ascending: false });
console.log('\n=== 1) payments (단건) ===');
console.log(JSON.stringify(pays, null, 2));

// 2) package_payments (환불 포함)
const { data: pkgs } = await sb.from('package_payments')
  .select('id, amount, method, payment_type, created_at, clinic_id, package_id, parent_payment_id, memo')
  .eq('customer_id', cid)
  .order('created_at', { ascending: false });
console.log('\n=== 2) package_payments (패키지) ===');
console.log(JSON.stringify(pkgs, null, 2));

// 3) 350,000 환불 행 특정 + 일마감 윈도우(2026-07-17 KST) 판정
const dayStart = '2026-07-16T15:00:00.000Z'; // KST 2026-07-17 00:00
const dayEnd   = '2026-07-17T14:59:59.999Z'; // KST 2026-07-17 23:59:59
console.log('\n=== 3) 350,000 환불 행 & 일마감 윈도우(2026-07-17 KST) 판정 ===');
const refundRows = [
  ...(pays ?? []).filter(r => r.payment_type === 'refund').map(r => ({src:'payments', ...r})),
  ...(pkgs ?? []).filter(r => r.payment_type === 'refund').map(r => ({src:'package_payments', ...r})),
];
for (const r of refundRows) {
  const inWin = r.created_at >= dayStart && r.created_at <= dayEnd;
  const clinicMatch = r.clinic_id === cust.clinic_id;
  console.log(`  [${r.src}] amt=${r.amount} method=${r.method} created_at=${r.created_at} status=${r.status ?? '-'} clinic=${r.clinic_id}`);
  console.log(`     → 윈도우내(7/17KST)=${inWin} | clinic_id일치(고객clinic ${cust.clinic_id})=${clinicMatch} | status!=deleted=${(r.status ?? 'active')!=='deleted'}`);
}
if (refundRows.length === 0) console.log('  환불행 0건 — 환불이 아예 기록 안됨(입력 경로 문제 가능)');

// 4) 클리닉 목록 (clinic_id 매핑 확인)
const { data: clinics } = await sb.from('clinics').select('id, name, slug');
console.log('\n=== 4) clinics ===');
console.log(JSON.stringify(clinics, null, 2));
