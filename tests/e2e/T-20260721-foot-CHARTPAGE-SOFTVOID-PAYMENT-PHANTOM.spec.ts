/**
 * E2E spec — T-20260721-foot-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM
 * payments.status 유령수납 — 고객차트 합산 active-only(fail-closed allow-list) 계약
 *
 * RC: CustomerChartPage payments 무필터 조회(초기 3208 / refresh 3350)로
 *     status IN('cancelled','deleted') 유령행이 totalPaid/feePayments 합산·표시에 혼입.
 * FIX: 전 고객차트-축 payments read 를 `.eq('status','active')` 로 fail-closed 화.
 *     (닫힌 allow-list — 미래 신규 status 값도 자동 배제)
 *
 * ※ 축 구분: payments.status(고객차트 축) — closing_manual_payments.voided_at(SOFTVOID-INFRA) 과
 *   다른 테이블. 본 spec 은 payments.status 축만 검증.
 *
 * 시나리오 1: active-only 조회 = 유령행(cancelled/deleted) 배제 → totalPaid 정합
 * 시나리오 2: (회귀) 무필터 조회 = 유령행 혼입 재현 → 필터가 실제로 차이를 만드는지 증명
 * 시나리오 3: fail-closed — cancelled·deleted 양쪽 모두 배제(deny-list 'deleted만 배제' 아님)
 * 시나리오 4: 고객목록/문서/치료칸반 축 sweep — 동일 active-only 계약
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

async function seedCustomerWithPayments(sb: SB, suffix: string) {
  const name = `phantom-pay-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${Math.floor(performance.now())}`;

  const { data: customer, error: custErr } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

  const { data: checkIn, error: ciErr } = await sb.from('check_ins').insert({
    clinic_id: CLINIC_ID, customer_id: customer!.id, customer_name: name,
    customer_phone: phone, visit_type: 'returning', status: 'done', queue_number: 997,
  }).select().single();
  expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

  // active 60,000 (정상수납) / cancelled 20,000 (유령) / deleted 30,000 (유령)
  const rows = [
    { amount: 60000, status: 'active' },
    { amount: 20000, status: 'cancelled' },
    { amount: 30000, status: 'deleted' },
  ].map((r) => ({
    clinic_id: CLINIC_ID, check_in_id: checkIn!.id, customer_id: customer!.id,
    amount: r.amount, method: 'card', installment: null, payment_type: 'payment',
    status: r.status,
  }));
  const { error: payErr } = await sb.from('payments').insert(rows);
  expect(payErr, `결제 seed 실패: ${payErr?.message}`).toBeNull();

  return { customerId: customer!.id as string, checkInId: checkIn!.id as string };
}

async function cleanup(sb: SB, customerId: string, checkInId: string) {
  await sb.from('payments').delete().eq('customer_id', customerId);
  await sb.from('check_ins').delete().eq('id', checkInId);
  await sb.from('customers').delete().eq('id', customerId);
}

test.describe('T-20260721-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM — payments.status 유령수납', () => {

  test('시나리오 1: active-only 조회 → 유령행 배제, totalPaid=60,000', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithPayments(sb, 's1');
    try {
      // CustomerChartPage 초기로드(3208)·refresh(3350) 와 동일 계약
      const { data } = await sb.from('payments')
        .select('*').eq('customer_id', customerId).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(50);
      expect(data!.length, 'active 행만 조회').toBe(1);
      const totalPaid = (data as { amount: number; payment_type: string }[])
        .filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0);
      expect(totalPaid, '유령(cancelled+deleted 50,000) 배제').toBe(60000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 2 (회귀): 무필터 조회는 유령 혼입 → 필터가 실제 차이를 만든다', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithPayments(sb, 's2');
    try {
      const { data: unfiltered } = await sb.from('payments')
        .select('*').eq('customer_id', customerId)
        .order('created_at', { ascending: false }).limit(50);
      const phantomTotal = (unfiltered as { amount: number; payment_type: string }[])
        .filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0);
      // 버그 재현: 무필터는 110,000(60k+20k+30k) — 유령 50,000 혼입
      expect(unfiltered!.length, '무필터=3행(유령 포함)').toBe(3);
      expect(phantomTotal, '무필터 합산=유령 혼입').toBe(110000);

      const { data: filtered } = await sb.from('payments')
        .select('*').eq('customer_id', customerId).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(50);
      const cleanTotal = (filtered as { amount: number; payment_type: string }[])
        .filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0);
      expect(phantomTotal - cleanTotal, '필터가 제거한 유령 = 50,000').toBe(50000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 3: fail-closed — cancelled·deleted 둘 다 배제(deny-list "deleted만" 아님)', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithPayments(sb, 's3');
    try {
      const { data } = await sb.from('payments')
        .select('status').eq('customer_id', customerId).eq('status', 'active');
      const statuses = new Set((data as { status: string }[]).map((r) => r.status));
      expect(statuses.has('cancelled'), 'cancelled 배제').toBe(false);
      expect(statuses.has('deleted'), 'deleted 배제').toBe(false);
      expect([...statuses], 'active 만 잔존').toEqual(['active']);

      // deny-list('deleted만 배제')였다면 cancelled 가 잔존했을 것 — 대조
      const { data: denyList } = await sb.from('payments')
        .select('status').eq('customer_id', customerId).neq('status', 'deleted');
      const denyStatuses = new Set((denyList as { status: string }[]).map((r) => r.status));
      expect(denyStatuses.has('cancelled'), 'deny-list 였다면 cancelled 누출됨(대조)').toBe(true);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 4: sweep 축(고객목록/문서/치료칸반) 동일 active-only 계약', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithPayments(sb, 's4');
    try {
      // Customers.tsx: 고객별 누적수납 (customer_id, active-only)
      const { data: custAgg } = await sb.from('payments')
        .select('customer_id, amount, payment_type').in('customer_id', [customerId]).eq('status', 'active');
      const custTotal = (custAgg as { amount: number; payment_type: string }[])
        .reduce((s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0);
      expect(custTotal, '고객목록 누적수납 active-only').toBe(60000);

      // autoBindContext / TreatmentStatusPanel: check_in 스코프 active-only
      const { data: ciAgg } = await sb.from('payments')
        .select('amount, payment_type').eq('check_in_id', checkInId).eq('status', 'active');
      const ciTotal = (ciAgg as { amount: number }[]).reduce((s, p) => s + (p.amount ?? 0), 0);
      expect(ciTotal, '내원별 수납 active-only').toBe(60000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });
});
