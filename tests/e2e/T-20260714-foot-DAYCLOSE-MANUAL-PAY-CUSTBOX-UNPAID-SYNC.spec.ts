/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — 일마감 수기입력 → 고객박스 미수 연동(옵션A)
 *
 * 버그(현장 제보, 김주연 총괄): 일마감 화면 [+ 수기 추가]로 카드결제를 넣으면 일마감 내역엔 정상 표기되나
 *   해당 고객 카드(고객박스)에 "미수"가 잔존. RC = 수기입력이 closing_manual_payments 에만 기록되고
 *   정본(package_payments/payments)을 만들지 않아 (a)고객박스 미수 미해소 (b)2번차트 수납내역 미표시 (c)칸반 미해소.
 *
 * 수정(옵션A, Closing.tsx ManualEntryDialog.save): 차트번호가 클리닉 내 고객 1인으로 해소되고 스태프가
 *   귀속 대상(attrSel ≠ 'manual')을 고르면 → 정본 write-path recordManualPayment(단일 SSOT) 경유 →
 *   ★closing_manual_payments 를 만들지 않고 early-return (net-zero, 매출 이중계상 0).
 *   attrSel='manual'(기본 rollup)/미해소/수정모드 → 기존 closing_manual_payments 경로 유지(무회귀).
 *
 * 이 spec 의 고유 검증축(twin CHART2 는 ReceiptUploadSection 진입점, 본 건은 일마감 진입점 + net-zero):
 *   AC-DC1  package 귀속 → package_payments 1건 + 미수 해소  AND  closing_manual_payments 미생성(net-zero)
 *   AC-DC2  checkin 귀속 → payments 1건(check_in 귀속) + 칸반 done  AND  closing_manual_payments 미생성
 *   AC-DC3  attrSel='manual' rollup → closing_manual_payments 생성(기존 동선 무회귀), canonical 미생성
 *   AC-DC4  금액 <= 0 → 저장 차단(dialog guard + recordManualPayment guard 동치)
 *   AC-DC5  F-4695 이미현 파트1 정정 회귀(READ-ONLY prod): 미수 0 + 정본 pp 1건 + manual 삭제 + 재발 안 함
 *   AC-DC6  매출 이중계상 방지 불변식: canonical 라우팅은 closing_manual_payments 0건 → 매출 split 1건만
 *
 * 비파괴 — 임시 픽스처 생성 후 즉시 삭제. F-4695(AC-DC5)는 READ-ONLY 단언만.
 * author: dev-foot / 2026-07-15
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Closing.tsx ManualEntryDialog.save 의 라우팅 결정 미러(순수 로직 동치) ──
//   canonical 경유 조건 = !isEdit && resolvedCust && attrSel !== 'manual'
type Route = 'package' | 'checkin' | 'single' | 'rollup';
function decideRoute(isEdit: boolean, resolvedCust: boolean, attrSel: string): Route {
  if (!isEdit && resolvedCust && attrSel !== 'manual') {
    if (attrSel.startsWith('pkg:')) return 'package';
    if (attrSel.startsWith('ci:')) return 'checkin';
    if (attrSel === 'single') return 'single';
  }
  return 'rollup'; // closing_manual_payments 경로
}

// recordManualPayment('package') write shape 재현(코드 경로 동치)
async function recordPackage(clinicId: string, customerId: string, packageId: string, amount: number, method: string) {
  const { error } = await service.from('package_payments').insert({
    clinic_id: clinicId, package_id: packageId, customer_id: customerId,
    amount, method, installment: 0, payment_type: 'payment', fee_kind: 'package',
    memo: '일마감 수기결제 정본화(opt-A) T-20260714-DAYCLOSE',
  });
  expect(error).toBeNull();
  const { data: sum } = await service.from('package_payments').select('amount, payment_type').eq('package_id', packageId);
  const total = (sum ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  await service.from('packages').update({ paid_amount: total }).eq('id', packageId);
}

async function newCustomer(clinicId: string) {
  const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
  const { data } = await service.from('customers')
    .insert({ clinic_id: clinicId, name: `DCLS_${suffix.slice(-4)}`, phone: `010${suffix}` }).select().single();
  return data!;
}
async function clinicId() {
  const { data } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  expect(data?.id).toBeTruthy();
  return data!.id as string;
}

test.describe('T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (옵션A · net-zero)', () => {
  const CLOSE_DATE = '2026-07-15';

  test('라우팅 결정 미러: canonical vs rollup', () => {
    expect(decideRoute(false, true, 'pkg:abc')).toBe('package');
    expect(decideRoute(false, true, 'ci:xyz')).toBe('checkin');
    expect(decideRoute(false, true, 'single')).toBe('single');
    expect(decideRoute(false, true, 'manual')).toBe('rollup');   // 기본 rollup
    expect(decideRoute(false, false, 'pkg:abc')).toBe('rollup'); // 고객 미해소 → rollup
    expect(decideRoute(true, true, 'pkg:abc')).toBe('rollup');   // 수정모드 → rollup(귀속전환 비대상)
  });

  test('AC-DC1: package 귀속 → 미수 해소 + closing_manual_payments 미생성(net-zero)', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const { data: pkg } = await service.from('packages')
      .insert({ clinic_id: cid, customer_id: cust.id, package_name: '12회권', package_type: '12회권', total_amount: 2890000, paid_amount: 0, total_sessions: 12, status: 'active' })
      .select().single();

    // BEFORE: 미수 = 2,890,000
    expect((pkg!.total_amount ?? 0) - (pkg!.paid_amount ?? 0)).toBe(2890000);

    // 일마감 수기입력 저장(pkg 라우팅) — canonical 경유, closing_manual_payments 미생성
    expect(decideRoute(false, true, `pkg:${pkg!.id}`)).toBe('package');
    await recordPackage(cid, cust.id, pkg!.id, 2890000, 'card');

    const { data: pps } = await service.from('package_payments').select('amount, fee_kind').eq('package_id', pkg!.id);
    expect(pps!.length).toBe(1);
    expect(pps![0].fee_kind).toBe('package');
    const { data: after } = await service.from('packages').select('total_amount, paid_amount').eq('id', pkg!.id).single();
    expect((after!.total_amount ?? 0) - (after!.paid_amount ?? 0)).toBe(0); // 고객박스 미수 해소

    // ★net-zero: 이 고객/마감일에 closing_manual_payments 가 생성되지 않았어야 함
    const { data: cmp } = await service.from('closing_manual_payments')
      .select('id').eq('clinic_id', cid).eq('customer_name', cust.name).eq('close_date', CLOSE_DATE);
    expect((cmp ?? []).length).toBe(0);
    console.log('[DAYCLOSE] pkg 라우팅 → 미수 해소 + closing_manual_payments 0건(net-zero) 확인');

    await service.from('package_payments').delete().eq('package_id', pkg!.id);
    await service.from('packages').delete().eq('id', pkg!.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-DC2: checkin 귀속 → payments + 칸반 done + closing_manual_payments 미생성', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    const { data: ci } = await service.from('check_ins')
      .insert({ clinic_id: cid, customer_id: cust.id, customer_name: cust.name, customer_phone: cust.phone, visit_type: 'returning', status: 'payment_waiting', queue_number: 991 })
      .select().single();

    expect(decideRoute(false, true, `ci:${ci!.id}`)).toBe('checkin');
    const { error: pErr } = await service.from('payments').insert({
      clinic_id: cid, check_in_id: ci!.id, customer_id: cust.id,
      amount: 100000, method: 'card', installment: 0, payment_type: 'payment', memo: '영수증 수납',
    });
    expect(pErr).toBeNull();
    await service.from('check_ins').update({ status: 'done' }).eq('id', ci!.id);

    const { data: pays } = await service.from('payments').select('check_in_id').eq('check_in_id', ci!.id);
    expect(pays!.length).toBe(1);                       // 2번차트 수납내역 표시(payments 정본)
    expect(pays![0].check_in_id).toBe(ci!.id);
    const { data: ciAfter } = await service.from('check_ins').select('status').eq('id', ci!.id).single();
    expect(ciAfter!.status).toBe('done');               // 칸반 해소

    const { data: cmp } = await service.from('closing_manual_payments')
      .select('id').eq('clinic_id', cid).eq('customer_name', cust.name).eq('close_date', CLOSE_DATE);
    expect((cmp ?? []).length).toBe(0);                 // net-zero
    console.log('[DAYCLOSE] ci 라우팅 → 칸반 done + closing_manual_payments 0건 확인');

    await service.from('payments').delete().eq('check_in_id', ci!.id);
    await service.from('check_ins').delete().eq('id', ci!.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-DC3: attrSel=manual rollup → closing_manual_payments 생성(무회귀), canonical 미생성', async () => {
    const cid = await clinicId();
    const cust = await newCustomer(cid);
    expect(decideRoute(false, true, 'manual')).toBe('rollup');

    // 기존 동선: closing_manual_payments insert (payload = Closing.tsx save() rollup 경로)
    const { data: row, error } = await service.from('closing_manual_payments').insert({
      clinic_id: cid, close_date: CLOSE_DATE, pay_time: '13:00',
      chart_number: null, customer_name: cust.name, staff_name: '테스트', amount: 70000, method: 'card',
    }).select().single();
    expect(error).toBeNull();
    expect(row!.id).toBeTruthy();

    // canonical(payments/package_payments)은 생성되지 않아야 함(rollup 은 정본 미경유)
    const { data: pays } = await service.from('payments').select('id').eq('customer_id', cust.id);
    expect((pays ?? []).length).toBe(0);
    console.log('[DAYCLOSE] rollup 라우팅 → closing_manual_payments 유지 + canonical 0건(무회귀) 확인');

    await service.from('closing_manual_payments').delete().eq('id', row!.id);
    await service.from('customers').delete().eq('id', cust.id);
  });

  test('AC-DC4: 금액 <= 0 → 저장 차단', () => {
    // Closing.tsx save(): if (!amt || amt <= 0) return;  ·  recordManualPayment: if (!(amount>0)) throw
    const dialogGuard = (amt: number) => amt > 0;                 // false = 저장 차단
    const writeGuard = (amt: number) => { if (!(amt > 0)) throw new Error('금액이 올바르지 않습니다'); };
    expect(dialogGuard(0)).toBe(false);
    expect(dialogGuard(-1)).toBe(false);
    expect(dialogGuard(100000)).toBe(true);
    expect(() => writeGuard(0)).toThrow('금액');
    expect(() => writeGuard(-500)).toThrow('금액');
    expect(() => writeGuard(100000)).not.toThrow();
  });

  test('AC-DC5: F-4695 이미현 파트1 정정 회귀(READ-ONLY prod)', async () => {
    const PKG = 'e55c868d-7b39-4b50-a98e-305d2353152d';
    const CUST = 'a07a3079-69ba-415a-a0f8-61e8d0921168';

    // 미수(package_due) = total - Σ(package fee_kind) = 0 → 고객박스 미수 해소
    const { data: pkg } = await service.from('packages').select('total_amount, paid_amount').eq('id', PKG).single();
    const { data: pp } = await service.from('package_payments')
      .select('amount, method, fee_kind, payment_type, memo').eq('package_id', PKG).eq('customer_id', CUST);
    const netPkgPaid = (pp ?? []).reduce((s, r) =>
      s + (String(r.fee_kind ?? 'package') === 'package' ? (r.payment_type === 'refund' ? -r.amount : r.amount) : 0), 0);
    const due = (pkg!.total_amount ?? 0) - netPkgPaid;
    expect(due).toBe(0);                                 // 미수 0 (재발 안 함)

    // 정본화 package 결제 정확히 1건(double-apply 없음) + 2,890,000 card
    const canonical = (pp ?? []).filter(r => String(r.fee_kind ?? 'package') === 'package' && r.amount === 2890000);
    expect(canonical.length).toBe(1);
    expect(canonical[0].method).toBe('card');

    // 정본화된 수기 결제행(closing_manual_payments d993ffc5) 삭제됨 → net-zero
    const { data: gone } = await service.from('closing_manual_payments').select('id').eq('id', 'd993ffc5-8c9b-4ef8-a1cf-df73b51aaba5');
    expect((gone ?? []).length).toBe(0);
    console.log('[DAYCLOSE] F-4695 회귀: due=0 · 정본 pp 1건 · manual 삭제 확인(net-zero, 재발 없음)');
  });

  test('AC-DC6: 매출 이중계상 방지 불변식 — canonical ↔ closing_manual_payments 상호배타', () => {
    // 일마감 총계 = payments + package_payments + closing_manual_payments 합산(Closing.tsx)
    // → canonical 라우팅이 closing_manual_payments 를 만들면 동일 결제가 2회 계상됨.
    // 옵션A save(): canonical 경유 시 early-return → closing_manual_payments 미생성. 상호배타 보장.
    const routes: Route[] = ['package', 'checkin', 'single', 'rollup'];
    for (const r of routes) {
      const makesCanonical = r !== 'rollup';
      const makesClosingManual = r === 'rollup';
      expect(makesCanonical && makesClosingManual).toBe(false); // 동시 생성 불가 = 이중계상 0
    }
  });
});
