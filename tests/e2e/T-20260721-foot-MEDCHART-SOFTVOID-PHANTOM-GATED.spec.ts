/**
 * E2E spec — T-20260721-foot-MEDCHART-SOFTVOID-PHANTOM-GATED
 * payments.status 유령수납 — 진료관리(의사 전용) 내원별 수납 표시 active-only(fail-closed allow-list) 계약
 *
 * RC: MedicalChartPanel.loadVisitPayments(:1007) payments 조회가
 *     `.eq('payment_type','payment')` 만 걸고 status 무필터 → status IN('cancelled','deleted')
 *     유령행이 진료관리 '치료·시술(결제내역 자동 연동)' 표시·합산에 혼입 → 과다계상.
 * FIX: 동 조회에 `.eq('status','active')` 추가 → fail-closed allow-list (미래 신규 status 값도 자동 배제).
 *     원 CHARTPAGE 티켓(commit 89711448)과 동일 SSOT(migration 20260514000010, 정상=status='active').
 *
 * 게이트: §11 진료관리 = 의사 전용 의료화면 → medical_confirm_gate 통과 후 착수
 *        (문지은 대표원장 방향동의 + 김주연 총괄 U0ATDB587PV 최종 GO, ts=1784676094.189969).
 *
 * ※ 축 구분: payments.status(수납 무효화 축) — closing_manual_payments.voided_at(SOFTVOID-INFRA) 과
 *   다른 테이블. 본 spec 은 payments.status 축만 검증.
 *
 * 현장 클릭 시나리오 매핑:
 *   시나리오 1: 진료관리 수납 — 삭제/취소 결제 제외(삭제 시 그만큼 감소)
 *   시나리오 2: 정상 고객(삭제/취소 없음) 수납금액 불변
 * + 회귀: loadVisitPayments 무필터가 실제로 유령을 혼입했음을 대조 증명
 * + AC2: 진료관리 수납금액 == 고객차트 totalPaid(active-only) 일치
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

/**
 * MedicalChartPanel.loadVisitPayments(:997~1011) 와 동일 계약 재현:
 *   특정 내원일(check_in) 스코프 → payment_type='payment' → status='active'.
 */
async function fetchVisitPayments(sb: SB, checkInId: string, withStatusFilter: boolean) {
  let q = sb.from('payments')
    .select('id,amount,memo,method')
    .in('check_in_id', [checkInId])
    .eq('payment_type', 'payment');
  if (withStatusFilter) q = q.eq('status', 'active');
  const { data } = await q;
  return (data as { amount: number }[]) ?? [];
}

const sumAmount = (rows: { amount: number }[]) => rows.reduce((s, p) => s + (p.amount ?? 0), 0);

async function seedCustomerWithVisit(sb: SB, suffix: string, rows: { amount: number; status: string }[]) {
  const name = `medchart-phantom-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${Math.floor(performance.now())}`;

  const { data: customer, error: custErr } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

  const { data: checkIn, error: ciErr } = await sb.from('check_ins').insert({
    clinic_id: CLINIC_ID, customer_id: customer!.id, customer_name: name,
    customer_phone: phone, visit_type: 'returning', status: 'done', queue_number: 996,
  }).select().single();
  expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

  const payRows = rows.map((r) => ({
    clinic_id: CLINIC_ID, check_in_id: checkIn!.id, customer_id: customer!.id,
    amount: r.amount, method: 'card', installment: null, payment_type: 'payment',
    status: r.status,
  }));
  const { error: payErr } = await sb.from('payments').insert(payRows);
  expect(payErr, `결제 seed 실패: ${payErr?.message}`).toBeNull();

  return { customerId: customer!.id as string, checkInId: checkIn!.id as string };
}

async function cleanup(sb: SB, customerId: string, checkInId: string) {
  await sb.from('payments').delete().eq('customer_id', customerId);
  await sb.from('check_ins').delete().eq('id', checkInId);
  await sb.from('customers').delete().eq('id', customerId);
}

test.describe('T-20260721-MEDCHART-SOFTVOID-PHANTOM-GATED — 진료관리 내원별 수납 active-only', () => {

  test('시나리오 1: 삭제/취소 결제 제외 — active 60,000 + cancelled 20,000 + deleted 30,000 → 60,000', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithVisit(sb, 's1', [
      { amount: 60000, status: 'active' },
      { amount: 20000, status: 'cancelled' },
      { amount: 30000, status: 'deleted' },
    ]);
    try {
      const rows = await fetchVisitPayments(sb, checkInId, true);
      expect(rows.length, 'active 행만 표시').toBe(1);
      expect(sumAmount(rows), '유령(취소 20k + 삭제 30k) 배제').toBe(60000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 2: 정상 고객(삭제/취소 없음) 수납금액 불변 — active 두 건 45,000', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithVisit(sb, 's2', [
      { amount: 25000, status: 'active' },
      { amount: 20000, status: 'active' },
    ]);
    try {
      const filtered = await fetchVisitPayments(sb, checkInId, true);
      const unfiltered = await fetchVisitPayments(sb, checkInId, false);
      // 유령 없음 → 필터 유무와 무관하게 동일(정상 고객 회귀 불변)
      expect(sumAmount(filtered), 'active-only 합산').toBe(45000);
      expect(sumAmount(filtered), '정상 고객: 수정 전(무필터)과 동일').toBe(sumAmount(unfiltered));
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('회귀: loadVisitPayments 무필터는 유령 혼입 → 필터가 실제 차이(50,000)를 만든다', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithVisit(sb, 'reg', [
      { amount: 60000, status: 'active' },
      { amount: 20000, status: 'cancelled' },
      { amount: 30000, status: 'deleted' },
    ]);
    try {
      const phantom = sumAmount(await fetchVisitPayments(sb, checkInId, false)); // 버그 경로
      const clean = sumAmount(await fetchVisitPayments(sb, checkInId, true));    // 수정 경로
      expect(phantom, '무필터=유령 혼입 110,000').toBe(110000);
      expect(clean, 'active-only 60,000').toBe(60000);
      expect(phantom - clean, '필터가 제거한 유령 = 50,000').toBe(50000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('AC2: 진료관리 내원별 수납 == 고객차트 totalPaid(active-only) 일치', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithVisit(sb, 'ac2', [
      { amount: 60000, status: 'active' },
      { amount: 20000, status: 'cancelled' },
      { amount: 30000, status: 'deleted' },
    ]);
    try {
      // 진료관리(MedicalChartPanel) 내원별 수납 (check_in 스코프 active-only)
      const medchartTotal = sumAmount(await fetchVisitPayments(sb, checkInId, true));
      // 고객차트 totalPaid 계약 (CHARTPAGE 픽스, customer 스코프 active-only, payment_type='payment')
      const { data: chartRows } = await sb.from('payments')
        .select('amount,payment_type').eq('customer_id', customerId).eq('status', 'active');
      const chartTotalPaid = (chartRows as { amount: number; payment_type: string }[])
        .filter((p) => p.payment_type === 'payment').reduce((s, p) => s + (p.amount ?? 0), 0);
      expect(medchartTotal, '진료관리 == 고객차트 totalPaid').toBe(chartTotalPaid);
      expect(medchartTotal, '둘 다 active-only 60,000').toBe(60000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('fail-closed: allow-list 이므로 cancelled·deleted 둘 다 배제 (deny-list "deleted만" 아님)', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCustomerWithVisit(sb, 'fc', [
      { amount: 60000, status: 'active' },
      { amount: 20000, status: 'cancelled' },
      { amount: 30000, status: 'deleted' },
    ]);
    try {
      const { data } = await sb.from('payments')
        .select('status').in('check_in_id', [checkInId])
        .eq('payment_type', 'payment').eq('status', 'active');
      const statuses = new Set((data as { status: string }[]).map((r) => r.status));
      expect(statuses.has('cancelled'), 'cancelled 배제').toBe(false);
      expect(statuses.has('deleted'), 'deleted 배제').toBe(false);
      expect([...statuses], 'active 만 잔존').toEqual(['active']);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });
});
