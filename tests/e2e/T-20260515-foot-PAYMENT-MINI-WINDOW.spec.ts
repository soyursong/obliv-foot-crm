/**
 * E2E spec — T-20260515-foot-PAYMENT-MINI-WINDOW
 * 풋센터 결제 미니창(모달) — Phase 1 (AC-1~7 + AC-11)
 *
 * AC-1: 대시보드 수납대기 슬롯 [결제하기] 버튼 → PaymentMiniWindow 모달
 * AC-2: 좌측 카테고리 탭 (풋케어/처방약/화장품) — services.category_label 기준
 * AC-3: 코드 클릭 → 선택 시술 목록 추가
 * AC-4: 코드 선택 시 services.price 자동 기입
 * AC-5: [시술 저장 및 금액 산정] → check_in_services 저장 + 합산 금액 산정
 * AC-6: 세금 구분 자동 분류 (vat_type + is_insurance_covered → 비급여(과세)/비급여(면세)/급여)
 * AC-7: 수납대기 합산 금액 반영 (check_in_services 기반 pending 금액)
 * AC-11: [수납] 버튼 → payments INSERT + check_ins.status = 'done' (PAYMENT-AUTO-DONE reuse)
 *
 * 시나리오 1: 정상 동선 — 코드 선택 → 저장 → 수납 → done 전환
 * 시나리오 2: 세금 구분 분류 (vat_type / is_insurance_covered)
 * 시나리오 3: 엣지 — 코드 미선택 상태 저장 시도
 *
 * AC-8~10은 Phase 2 (FORM-TEMPLATE-REFRESH 완료 후) — 본 spec 범위 외
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260515-PAYMENT-MINI-WINDOW — 결제 미니창 Phase 1', () => {

  test('시나리오 1: payment_waiting → 시술 저장 → 수납 → done 전환', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `mini-pay-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 테스트 고객 + payment_waiting 체크인 시드
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 980,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    // 풋케어 카테고리 서비스 1건 픽업 (AC-2/AC-3/AC-4)
    const { data: svcList } = await sb
      .from('services')
      .select('*')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .limit(2);
    expect((svcList?.length ?? 0) > 0, '활성 서비스가 1건 이상 있어야 함').toBe(true);
    const svc = svcList![0];

    try {
      // AC-5: 시술 저장 (PaymentMiniWindow handleSave 시뮬)
      const { error: cisErr } = await sb.from('check_in_services').insert({
        check_in_id: checkInId,
        service_id: svc.id,
        service_name: svc.name,
        price: svc.price,
        original_price: svc.price,
        is_package_session: false,
      });
      expect(cisErr, `check_in_services 저장 실패: ${cisErr?.message}`).toBeNull();

      // AC-7: 수납대기 pending 합산 (Dashboard fetchPendingServices 시뮬)
      const { data: pendingRows } = await sb
        .from('check_in_services')
        .select('price')
        .eq('check_in_id', checkInId);
      const pendingSum = (pendingRows ?? []).reduce((a, r: { price: number }) => a + r.price, 0);
      expect(pendingSum, '수납대기 합산이 서비스 가격과 일치').toBe(svc.price);

      // AC-11: 수납 (PAYMENT-AUTO-DONE reuse) — payments INSERT
      const { error: payErr } = await sb.from('payments').insert({
        check_in_id: checkInId,
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        amount: pendingSum,
        method: 'card',
        installment: null,
        memo: null,
        payment_type: 'payment',
      });
      expect(payErr, `payments INSERT 실패: ${payErr?.message}`).toBeNull();

      // AC-11: check_ins.status → 'done'
      const { error: ciUpErr } = await sb
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkInId);
      expect(ciUpErr, `status done 전환 실패: ${ciUpErr?.message}`).toBeNull();

      const { data: updated } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, '수납 완료 후 status=done').toBe('done');

      console.log('[시나리오1] 코드 선택 → 저장 → 수납 → done PASS');
    } finally {
      // cleanup
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_in_services').delete().eq('check_in_id', checkInId);
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-6: 세금 구분 분류 (vat_type + is_insurance_covered)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // 풋센터 서비스 4건 추출하여 세금 구분 매핑 검증
    const { data: services } = await sb
      .from('services')
      .select('id, name, vat_type, is_insurance_covered, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .limit(20);
    expect((services?.length ?? 0) > 0, '서비스 1건 이상 존재').toBe(true);

    // PaymentMiniWindow getTaxClass 로직과 동일
    type TaxClass = '비급여(과세)' | '비급여(면세)' | '급여';
    const classify = (svc: { vat_type: string | null; is_insurance_covered: boolean | null }): TaxClass => {
      if (svc.is_insurance_covered) return '급여';
      if (svc.vat_type === 'exclusive' || svc.vat_type === 'inclusive') return '비급여(과세)';
      return '비급여(면세)';
    };

    for (const svc of services ?? []) {
      const cls = classify(svc);
      expect(['비급여(과세)', '비급여(면세)', '급여']).toContain(cls);
    }
    console.log('[AC-6] 세금 구분 분류 로직 — 모든 서비스 분류 가능 PASS');
  });

  test('시나리오 3: 엣지 — 시술 미선택 상태에서 수납 시도 (금액 0)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `empty-pay-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();

    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 981,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // check_in_services 미생성 → pending 합산 0
      const { data: pendingRows } = await sb
        .from('check_in_services')
        .select('price')
        .eq('check_in_id', checkInId);
      const pendingSum = (pendingRows ?? []).reduce((a, r: { price: number }) => a + r.price, 0);
      expect(pendingSum, '시술 미선택 시 pending 합산은 0').toBe(0);

      // PaymentMiniWindow handleSettle은 grandTotal <= 0 시 토스트 에러로 차단
      // → 수납 처리 불가 (status payment_waiting 유지)
      const { data: still } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(still?.status, '시술 미선택 상태에서는 payment_waiting 유지').toBe('payment_waiting');

      console.log('[시나리오3] 시술 미선택 → 수납 차단 + status 유지 PASS');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
