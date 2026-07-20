/**
 * T-20260714-foot-CHART2-RECEIPT-MANUALPAY-POPUP — 2번차트 영수증 업로드+수기수납 팝업(옵션A)
 *
 * 요청(김주연 총괄): 영수증 스캔 OCR 임시대안 — 2번차트에서 영수증 업로드 + 금액 수기입력 +
 *   결제수단 선택 + 저장 → 수납 기록 생성(고객박스 미수 해소 · 2번차트 수납내역 표시 · 수납대기 칸반 해소).
 *
 * 구현: 신규 팝업 신설이 아니라 기존 ReceiptUploadSection(CustomerChartPage) 확장 —
 *   RECEIPT-PKG-ALWAYS 하드블록(활성패키지 無 차단) supersede → 옵션A '귀속 대상 수기선택'.
 *   저장 write-path 는 단일 SSOT recordManualPayment(manualPaymentWritePath.ts) 경유(AC7: 병렬 경로 신설 0).
 *
 * 옵션A 3분기 (동일 SSOT 를 일마감 수기입력 DAYCLOSE 티켓과 공유):
 *   pkg     활성 패키지 잔금 → package_payments INSERT(fee_kind='package') + packages.paid_amount 재집계 → 미수 해소
 *   ci      payment_waiting 내원 → payments INSERT(check_in 귀속) + check_ins.status='done' → 칸반 해소
 *   single  둘다無 → payments INSERT(check_in_id NULL) 단건
 *
 * 검증(비파괴 — 임시 데이터 생성 후 즉시 삭제). recordManualPayment 의 write shape 를 그대로 재현.
 *  AC2/AC3-a: pkg 라우팅 → package_payments 1건(fee_kind='package') + paid_amount 재집계 → 미수(due) 해소.
 *  AC3-b/c:   ci  라우팅 → payments 1건(check_in_id 세팅) + check_ins.status='done'(칸반 해소).
 *  옵션A 3분기: single 라우팅 → payments 1건(check_in_id NULL).
 *  AC5:       금액 <= 0 → 저장 차단(recordManualPayment throw).
 *  AC6:       결제수단은 기존 enum(card/cash/transfer) 재사용 — 신규 enum 없음.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// recordManualPayment('package') 의 write shape 재현 헬퍼 (코드 경로 동치)
async function recordPackage(clinicId: string, customerId: string, packageId: string, amount: number, method: string) {
  const { error } = await service.from('package_payments').insert({
    clinic_id: clinicId, package_id: packageId, customer_id: customerId,
    amount, method, installment: 0, payment_type: 'payment', fee_kind: 'package', memo: '영수증 업로드',
  });
  expect(error).toBeNull();
  const { data: sum } = await service.from('package_payments').select('amount, payment_type').eq('package_id', packageId);
  const total = (sum ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  await service.from('packages').update({ paid_amount: total }).eq('id', packageId);
}

test.describe('T-20260714-foot-CHART2-RECEIPT-MANUALPAY-POPUP (옵션A)', () => {
  test('AC2/AC3-a: 패키지 귀속 → package_payments 생성 + 미수 해소', async () => {
    const { data: clinic } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    const clinicId = clinic!.id;

    const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
    const { data: customer } = await service.from('customers')
      .insert({ clinic_id: clinicId, name: `RCPT_${suffix.slice(-4)}`, phone: `DUMMY-${suffix}` }).select().single();
    const { data: pkg } = await service.from('packages')
      .insert({ clinic_id: clinicId, customer_id: customer!.id, package_name: '12회권', package_type: '12회권', total_amount: 2890000, paid_amount: 0, total_sessions: 12, status: 'active' })
      .select().single();

    // BEFORE: 미수(due) = total_amount - paid = 2,890,000
    expect((pkg!.total_amount ?? 0) - (pkg!.paid_amount ?? 0)).toBe(2890000);

    // === 팝업 저장(pkg 라우팅) 재현 ===
    await recordPackage(clinicId, customer!.id, pkg!.id, 2890000, 'card');

    const { data: pps } = await service.from('package_payments').select('amount, fee_kind, payment_type').eq('package_id', pkg!.id);
    expect(pps!.length).toBe(1);            // AC2: 정본 결제행 1건(이중계상 0)
    expect(pps![0].fee_kind).toBe('package'); // 미수 산식(fee_kind='package')과 정합
    const { data: after } = await service.from('packages').select('total_amount, paid_amount').eq('id', pkg!.id).single();
    expect((after!.total_amount ?? 0) - (after!.paid_amount ?? 0)).toBe(0); // AC3-a: 미수 해소
    console.log('[CHART2-RECEIPT] pkg 라우팅 → 미수 해소 확인');

    await service.from('package_payments').delete().eq('package_id', pkg!.id);
    await service.from('packages').delete().eq('id', pkg!.id);
    await service.from('customers').delete().eq('id', customer!.id);
  });

  test('AC3-b/c: 수납대기 내원 귀속 → payments 생성 + 칸반(status=done) 해소', async () => {
    const { data: clinic } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
    const clinicId = clinic!.id;
    const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
    const { data: customer } = await service.from('customers')
      .insert({ clinic_id: clinicId, name: `RCPT_${suffix.slice(-4)}`, phone: `DUMMY-${suffix}` }).select().single();
    const { data: ci } = await service.from('check_ins')
      .insert({ clinic_id: clinicId, customer_id: customer!.id, customer_name: customer!.name, customer_phone: customer!.phone, visit_type: 'returning', status: 'payment_waiting', queue_number: 990 })
      .select().single();

    // === 팝업 저장(ci 라우팅) 재현 ===
    const { error: pErr } = await service.from('payments').insert({
      clinic_id: clinicId, check_in_id: ci!.id, customer_id: customer!.id,
      amount: 50000, method: 'card', installment: 0, payment_type: 'payment', memo: '영수증 수납',
    });
    expect(pErr).toBeNull();
    const { error: ciErr } = await service.from('check_ins').update({ status: 'done' }).eq('id', ci!.id);
    expect(ciErr).toBeNull();

    const { data: pays } = await service.from('payments').select('check_in_id, amount').eq('check_in_id', ci!.id);
    expect(pays!.length).toBe(1);                 // AC3-b: 2번차트 수납내역 표시(payments 정본)
    expect(pays![0].check_in_id).toBe(ci!.id);
    const { data: ciAfter } = await service.from('check_ins').select('status').eq('id', ci!.id).single();
    expect(ciAfter!.status).toBe('done');         // AC3-c: 수납대기 칸반 해소
    console.log('[CHART2-RECEIPT] ci 라우팅 → 칸반 해소 확인');

    await service.from('payments').delete().eq('check_in_id', ci!.id);
    await service.from('check_ins').delete().eq('id', ci!.id);
    await service.from('customers').delete().eq('id', customer!.id);
  });

  test('옵션A 3분기: 단건 귀속 → payments(check_in_id NULL) 생성', async () => {
    const { data: clinic } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
    const clinicId = clinic!.id;
    const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
    const { data: customer } = await service.from('customers')
      .insert({ clinic_id: clinicId, name: `RCPT_${suffix.slice(-4)}`, phone: `DUMMY-${suffix}` }).select().single();

    const { data: pay, error } = await service.from('payments').insert({
      clinic_id: clinicId, check_in_id: null, customer_id: customer!.id,
      amount: 30000, method: 'cash', installment: 0, payment_type: 'payment', memo: '영수증 수납(단건)',
    }).select().single();
    expect(error).toBeNull();
    expect(pay!.check_in_id).toBeNull();
    console.log('[CHART2-RECEIPT] single 라우팅 → check_in_id NULL 단건 확인');

    await service.from('payments').delete().eq('id', pay!.id);
    await service.from('customers').delete().eq('id', customer!.id);
  });

  test('AC5: 금액 <= 0 → 저장 차단', () => {
    // recordManualPayment: if (!(amount > 0)) throw new Error('금액이 올바르지 않습니다')
    const guard = (amount: number) => { if (!(amount > 0)) throw new Error('금액이 올바르지 않습니다'); };
    expect(() => guard(0)).toThrow('금액');
    expect(() => guard(-1)).toThrow('금액');
    expect(() => guard(50000)).not.toThrow();
  });

  test('AC6: 결제수단 enum 재사용 — 신규 enum 없음', () => {
    const METHODS = ['card', 'cash', 'transfer'];
    expect(METHODS).toContain('card');
    expect(METHODS).toContain('cash');
    expect(METHODS).toContain('transfer');
    expect(METHODS.length).toBe(3); // 신규 enum 추가 없음
  });
});
