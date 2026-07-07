/**
 * T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
 * 결제 항목별 명세(payment_items) — 스코프 (C) 풀명세: 항목명+수가코드+급여/비급여+단가+횟수 각 행 분리.
 *
 * DB-직접 흐름 검증(PaymentDialog 클라이언트 insert 경로 재현). service_role 로 시드/정리.
 * AC 대응:
 *   AC-1: 항목별(항목명+금액) 분리 저장 — payments 총액 단일구조 해소.
 *   AC-2: 항목별 내역 조회 가능(payment_id 기준 read).
 *   AC-3: charge_class = 급여/비급여 표시축만(CHECK 2값), split 금액 재선언 없음.
 *   AC-4: 기존 lump-sum(payment_items 0행) 회귀 0 — payments 단독 read 정상.
 * 스키마 계약(DA-20260707-foot-PAYMENT-ITEMS): charge_class CHECK IN ('급여','비급여'),
 *   payment_id ON DELETE CASCADE, check_in_id ON DELETE SET NULL.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY', () => {
  test('AC-1/AC-2/AC-3 — 항목별 풀명세 저장·조회 + charge_class 2값', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let checkInId: string | null = null;
    let paymentId: string | null = null;

    try {
      const { data: customer } = await sb
        .from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-test-${Date.now()}`, phone, visit_type: 'new' })
        .select()
        .single();
      customerId = customer!.id;

      const { data: ci } = await sb
        .from('check_ins')
        .insert({
          clinic_id: CLINIC_ID,
          customer_id: customerId,
          customer_name: customer!.name,
          customer_phone: phone,
          visit_type: 'new',
          status: 'payment_waiting',
          queue_number: 998,
        })
        .select()
        .single();
      checkInId = ci!.id;

      // 수납(payments) — 총액 100,000
      const { data: pay, error: payErr } = await sb
        .from('payments')
        .insert({
          clinic_id: CLINIC_ID,
          check_in_id: checkInId,
          customer_id: customerId,
          amount: 100000,
          method: 'card',
          payment_type: 'payment',
        })
        .select('id')
        .single();
      expect(payErr).toBeNull();
      paymentId = pay!.id;

      // 항목별 명세 — 풀명세 2행 (급여 1행 + 비급여 1행)
      const { error: itemErr } = await sb.from('payment_items').insert([
        {
          payment_id: paymentId,
          check_in_id: checkInId,
          service_name: '발톱무좀 균검사',
          service_code: 'D6591',
          quantity: 1,
          unit_price: 30000,
          line_amount: 30000,
          charge_class: '급여',
        },
        {
          payment_id: paymentId,
          check_in_id: checkInId,
          service_name: '레이저 시술',
          service_code: 'LZ01',
          quantity: 2,
          unit_price: 35000,
          line_amount: 70000,
          charge_class: '비급여',
        },
      ]);
      expect(itemErr).toBeNull();

      // AC-2: payment_id 기준 조회 가능
      const { data: items } = await sb
        .from('payment_items')
        .select('*')
        .eq('payment_id', paymentId)
        .order('created_at', { ascending: true });
      expect(items).toHaveLength(2);
      // 항목 합계 = 수납 총액 (soft 정합 — advisory)
      const sum = (items ?? []).reduce((s, it) => s + it.line_amount, 0);
      expect(sum).toBe(100000);
      // charge_class 값 검증
      expect((items ?? []).map((i) => i.charge_class).sort()).toEqual(['급여', '비급여']);
      // 수가코드·횟수 보존
      const laser = (items ?? []).find((i) => i.service_name === '레이저 시술');
      expect(laser?.service_code).toBe('LZ01');
      expect(laser?.quantity).toBe(2);

      // AC-3: charge_class CHECK 위반은 거부 (급여/비급여 외 값 금지 — 공단부담 등 확장 불가)
      const { error: badErr } = await sb.from('payment_items').insert({
        payment_id: paymentId,
        service_name: 'bad-class',
        quantity: 1,
        line_amount: 1000,
        charge_class: '공단부담',
      });
      expect(badErr).not.toBeNull();
    } finally {
      if (paymentId) {
        await sb.from('payment_items').delete().eq('payment_id', paymentId);
        await sb.from('payments').delete().eq('id', paymentId);
      }
      if (checkInId) await sb.from('check_ins').delete().eq('id', checkInId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('스키마 계약 — payment_id ON DELETE CASCADE (부모 수납 삭제 시 항목 동반 삭제)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb
        .from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-cascade-${Date.now()}`, phone, visit_type: 'new' })
        .select()
        .single();
      customerId = customer!.id;

      const { data: pay } = await sb
        .from('payments')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, amount: 50000, method: 'cash', payment_type: 'payment' })
        .select('id')
        .single();
      paymentId = pay!.id;

      await sb.from('payment_items').insert({
        payment_id: paymentId,
        service_name: 'cascade-line',
        quantity: 1,
        unit_price: 50000,
        line_amount: 50000,
        charge_class: '비급여',
      });

      // 부모 payment 삭제 → 항목 CASCADE 삭제
      await sb.from('payments').delete().eq('id', paymentId);
      const { data: orphans } = await sb.from('payment_items').select('id').eq('payment_id', paymentId);
      expect(orphans ?? []).toHaveLength(0);
      paymentId = null; // 이미 삭제됨
    } finally {
      if (paymentId) await sb.from('payments').delete().eq('id', paymentId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('AC-4 회귀 0 — 항목 없는 lump-sum 수납은 payments 단독 read 정상', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb
        .from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-legacy-${Date.now()}`, phone, visit_type: 'new' })
        .select()
        .single();
      customerId = customer!.id;

      const { data: pay, error } = await sb
        .from('payments')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, amount: 80000, method: 'transfer', payment_type: 'payment' })
        .select('id, amount')
        .single();
      expect(error).toBeNull();
      paymentId = pay!.id;
      expect(pay!.amount).toBe(80000);

      // payment_items 0행 = 레거시 lump-sum
      const { data: items } = await sb.from('payment_items').select('id').eq('payment_id', paymentId);
      expect(items ?? []).toHaveLength(0);
    } finally {
      if (paymentId) await sb.from('payments').delete().eq('id', paymentId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
