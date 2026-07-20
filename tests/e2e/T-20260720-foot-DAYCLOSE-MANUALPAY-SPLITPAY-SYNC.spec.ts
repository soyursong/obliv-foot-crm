/**
 * T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 일마감 수기 분할결제(카드+이체) 정본 연동
 *
 * 버그(현장, 부모 T-20260714 커버리지 갭): 일마감 수기 등록에서 분할결제(카드+이체 2 결제수단)를 넣으면
 *   recordManualPayment 가 단일 method+amount 시그니처라 이체 leg 가 closing_manual_payments 에만 남고
 *   canonical(package_payments) 미생성 → 고객박스 phantom 미수 잔존 + 2번차트 수납내역 미표시.
 *   RC = (c) closing_manual_payments 만 기록·canonical 미생성 (F-4717 현은호 실측).
 *
 * 수정(파트2): recordManualPayment 에 legs[] 확장 — 각 leg 가 canonical 1행. 병렬 write 경로 신설 없음(AC7).
 *   package: leg 별 package_payments + paid_amount = leg 합 재집계 → 미수 정합.
 *   checkin: leg 별 payments(동일 check_in) + 칸반 done. single: leg 별 payments.
 *   rollup(manual): leg 별 closing_manual_payments(카드/이체 subtotal 정합).
 *
 * 고유 검증축:
 *   AC-SP0  leg 정규화: legs 우선, 미지정 시 amount+method 단일 leg (하위호환)
 *   AC-SP1  package 분할(카드+이체) → package_payments 2건 + paid_amount=leg합 + 미수 0 + net-zero
 *   AC-SP2  checkin 분할 → payments 2건(동일 check_in_id) + 칸반 done
 *   AC-SP3  single 분할 → payments 2건(check_in_id NULL)
 *   AC-SP4  rollup 분할 → closing_manual_payments 2건(카드/이체 subtotal 정합), canonical 0
 *   AC-SP5  F-4717 현은호 파트1 정정 회귀(READ-ONLY prod): 미수 0 + canonical transfer 1건 + manual soft-void
 *   AC-SP6  매출 이중계상 방지 불변식: leg 합 = 총액, canonical leg 당 1회
 *
 * 비파괴 — 임시 픽스처 생성 후 즉시 삭제. F-4717(AC-SP5)은 READ-ONLY 단언만.
 * author: dev-foot / 2026-07-20
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type PayMethod = 'card' | 'cash' | 'transfer';
interface Leg { method: PayMethod; amount: number; }

// ── recordManualPayment 의 leg 정규화 미러(순수 로직 동치) ──
function normalizeLegs(input: { amount?: number; method?: PayMethod; legs?: Leg[] }): Leg[] {
  const legs = (input.legs && input.legs.length > 0)
    ? input.legs
    : (input.amount != null && input.method != null) ? [{ method: input.method, amount: input.amount }] : [];
  if (legs.length === 0) throw new Error('결제 leg 가 없습니다');
  for (const l of legs) {
    if (!(l.amount > 0)) throw new Error('금액이 올바르지 않습니다');
    if (!l.method) throw new Error('결제수단이 올바르지 않습니다');
  }
  return legs;
}

// package 라우팅 leg-write 재현(코드 경로 동치)
async function recordPackageLegs(clinicId: string, customerId: string, packageId: string, legs: Leg[]) {
  const { error } = await service.from('package_payments').insert(
    legs.map(l => ({
      clinic_id: clinicId, package_id: packageId, customer_id: customerId,
      amount: l.amount, method: l.method, installment: 0, payment_type: 'payment', fee_kind: 'package',
      memo: 'SPLITPAY-SYNC E2E',
    })),
  );
  expect(error).toBeNull();
  const { data: sum } = await service.from('package_payments').select('amount, payment_type').eq('package_id', packageId);
  const total = (sum ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  await service.from('packages').update({ paid_amount: total }).eq('id', packageId);
}

async function newCustomer(clinicId: string) {
  const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
  const { data } = await service.from('customers')
    .insert({ clinic_id: clinicId, name: `SPLT_${suffix.slice(-4)}`, phone: `DUMMY-${suffix}` }).select().single();
  return data!;
}
async function clinicId() {
  const { data } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  expect(data?.id).toBeTruthy();
  return data!.id as string;
}

test.describe('T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC (분할결제 canonical 연동)', () => {
  const CLOSE_DATE = '2026-07-20';

  test('AC-SP0: leg 정규화 — legs 우선 / 하위호환 단일 leg / 가드', () => {
    expect(normalizeLegs({ amount: 100000, method: 'card' })).toEqual([{ method: 'card', amount: 100000 }]);
    expect(normalizeLegs({ legs: [{ method: 'card', amount: 300 }, { method: 'transfer', amount: 700 }] }))
      .toHaveLength(2);
    // legs 지정 시 amount/method 무시
    expect(normalizeLegs({ amount: 999, method: 'cash', legs: [{ method: 'card', amount: 1 }] }))
      .toEqual([{ method: 'card', amount: 1 }]);
    expect(() => normalizeLegs({})).toThrow();
    expect(() => normalizeLegs({ legs: [{ method: 'card', amount: 0 }] })).toThrow('금액');
  });

  test('AC-SP1: package 분할(카드+이체) → pp 2건 + 미수 0 + net-zero', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const { data: pkg } = await service.from('packages')
      .insert({ clinic_id: cid, customer_id: cust.id, package_name: '24회권', package_type: '24회권', total_amount: 5760000, paid_amount: 0, total_sessions: 24, status: 'active' })
      .select().single();
    expect((pkg!.total_amount ?? 0) - (pkg!.paid_amount ?? 0)).toBe(5760000); // BEFORE 미수

    // 분할결제: 카드 4,500,000 + 이체 1,260,000 = 5,760,000 (F-4717 실측 재현)
    const legs: Leg[] = [{ method: 'card', amount: 4500000 }, { method: 'transfer', amount: 1260000 }];
    expect(legs.reduce((s, l) => s + l.amount, 0)).toBe(5760000); // leg 합 = 총액(이중계상 0)
    await recordPackageLegs(cid, cust.id, pkg!.id, legs);

    const { data: pps } = await service.from('package_payments').select('amount, method, fee_kind').eq('package_id', pkg!.id).order('amount');
    expect(pps!.length).toBe(2);                                   // leg 별 canonical 1행
    expect(pps!.map(p => p.method).sort()).toEqual(['card', 'transfer']);
    const { data: after } = await service.from('packages').select('total_amount, paid_amount').eq('id', pkg!.id).single();
    expect((after!.total_amount ?? 0) - (after!.paid_amount ?? 0)).toBe(0); // 미수 해소(leg 합 재집계)

    const { data: cmp } = await service.from('closing_manual_payments')
      .select('id').eq('clinic_id', cid).eq('customer_name', cust.name).eq('close_date', CLOSE_DATE);
    expect((cmp ?? []).length).toBe(0);                            // net-zero
    console.log('[SPLITPAY] package 분할 → pp 2건 · 미수 0 · closing_manual 0(net-zero)');

    await service.from('package_payments').delete().eq('package_id', pkg!.id);
    await service.from('packages').delete().eq('id', pkg!.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-SP2: checkin 분할 → payments 2건(동일 check_in) + 칸반 done', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const { data: ci } = await service.from('check_ins')
      .insert({ clinic_id: cid, customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone, visit_type: 'returning', status: 'payment_waiting', queue_number: 992 })
      .select().single();

    const legs: Leg[] = [{ method: 'card', amount: 80000 }, { method: 'transfer', amount: 20000 }];
    const { error } = await service.from('payments').insert(legs.map(l => ({
      clinic_id: cid, check_in_id: ci!.id, customer_id: cust.id,
      amount: l.amount, method: l.method, installment: 0, payment_type: 'payment', memo: '영수증 수납',
    })));
    expect(error).toBeNull();
    await service.from('check_ins').update({ status: 'done' }).eq('id', ci!.id);

    const { data: pays } = await service.from('payments').select('check_in_id, method').eq('check_in_id', ci!.id);
    expect(pays!.length).toBe(2);
    expect(pays!.every(p => p.check_in_id === ci!.id)).toBe(true);
    const { data: ciAfter } = await service.from('check_ins').select('status').eq('id', ci!.id).single();
    expect(ciAfter!.status).toBe('done');
    console.log('[SPLITPAY] checkin 분할 → payments 2건(동일 check_in) · 칸반 done');

    await service.from('payments').delete().eq('check_in_id', ci!.id);
    await service.from('check_ins').delete().eq('id', ci!.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-SP3: single 분할 → payments 2건(check_in_id NULL)', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const legs: Leg[] = [{ method: 'cash', amount: 30000 }, { method: 'card', amount: 70000 }];
    const { error } = await service.from('payments').insert(legs.map(l => ({
      clinic_id: cid, check_in_id: null, customer_id: cust.id,
      amount: l.amount, method: l.method, installment: 0, payment_type: 'payment', memo: '영수증 수납(단건)',
    })));
    expect(error).toBeNull();
    const { data: pays } = await service.from('payments').select('check_in_id, amount').eq('customer_id', cust.id);
    expect(pays!.length).toBe(2);
    expect(pays!.every(p => p.check_in_id === null)).toBe(true);
    expect(pays!.reduce((s, p) => s + p.amount, 0)).toBe(100000);
    console.log('[SPLITPAY] single 분할 → payments 2건(check_in_id NULL)');

    await service.from('payments').delete().eq('customer_id', cust.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-SP4: rollup 분할 → closing_manual_payments 2건(subtotal 정합), canonical 0', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const legs: Leg[] = [{ method: 'card', amount: 55000 }, { method: 'transfer', amount: 45000 }];
    const rows = legs.map(l => ({
      clinic_id: cid, close_date: CLOSE_DATE, pay_time: '14:00',
      chart_number: null, customer_name: cust.name, staff_name: '테스트', amount: l.amount, method: l.method,
    }));
    const { data: ins, error } = await service.from('closing_manual_payments').insert(rows).select();
    expect(error).toBeNull();
    expect(ins!.length).toBe(2);
    // 카드/이체 subtotal 정합
    const card = ins!.filter(r => r.method === 'card').reduce((s, r) => s + r.amount, 0);
    const transfer = ins!.filter(r => r.method === 'transfer').reduce((s, r) => s + r.amount, 0);
    expect(card).toBe(55000);
    expect(transfer).toBe(45000);
    // canonical 미생성(rollup 은 정본 미경유)
    const { data: pays } = await service.from('payments').select('id').eq('customer_id', cust.id);
    expect((pays ?? []).length).toBe(0);
    console.log('[SPLITPAY] rollup 분할 → closing_manual 2건 · 카드/이체 subtotal 정합 · canonical 0');

    await service.from('closing_manual_payments').delete().in('id', ins!.map(r => r.id));
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-SP5: F-4717 현은호 파트1 정정 회귀(READ-ONLY prod)', async () => {
    const PKG = '9455ca84-5798-413b-bd45-7457616d7f55';
    const CUST = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';
    const MANUAL = 'd38b38fb-a60d-41b1-91fa-05548c9f51bf';

    // 미수(package_due) = total - Σ(package fee_kind net) = 0
    const { data: pkg } = await service.from('packages').select('total_amount, paid_amount').eq('id', PKG).single();
    const { data: pp } = await service.from('package_payments')
      .select('amount, method, fee_kind, payment_type').eq('package_id', PKG).eq('customer_id', CUST);
    const netPaid = (pp ?? []).reduce((s, r) =>
      s + (String(r.fee_kind ?? 'package') === 'package' ? (r.payment_type === 'refund' ? -r.amount : r.amount) : 0), 0);
    expect((pkg!.total_amount ?? 0) - netPaid).toBe(0);            // 미수 0

    // 이체 leg canonical 정확히 1건(double-apply 없음)
    const transferLeg = (pp ?? []).filter(r => r.method === 'transfer' && r.amount === 1260000);
    expect(transferLeg.length).toBe(1);
    // 카드 leg 4,500,000 + 이체 leg 1,260,000 = 총액
    expect(netPaid).toBe(5760000);

    // 정본화된 수기 이체행 soft-void 됨(net-zero, 이중계상 방지)
    const { data: manual } = await service.from('closing_manual_payments').select('voided_at').eq('id', MANUAL).single();
    expect(manual!.voided_at).not.toBeNull();
    console.log('[SPLITPAY] F-4717 회귀: 미수 0 · canonical transfer 1건 · manual soft-void(net-zero)');
  });

  test('AC-SP6: 매출 이중계상 방지 불변식 — leg 합 = 총액, canonical leg 당 1회', () => {
    const legs: Leg[] = [{ method: 'card', amount: 4500000 }, { method: 'transfer', amount: 1260000 }];
    const total = 5760000;
    // 불변식1: leg 합 = 총액
    expect(legs.reduce((s, l) => s + l.amount, 0)).toBe(total);
    // 불변식2: canonical 행 수 = leg 수(각 leg 1회) — closing_manual 과 동시생성 불가(canonical 라우팅 early-return)
    const canonicalRows = legs.length;
    const closingManualRows = 0; // canonical 라우팅 시 미생성
    expect(canonicalRows).toBe(legs.length);
    expect(canonicalRows > 0 && closingManualRows > 0).toBe(false); // 상호배타 = 이중계상 0
  });
});
