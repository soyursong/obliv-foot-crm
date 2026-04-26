/**
 * T3 Critical Flow CF-4 — 패키지 신규 + 분할 결제 (T-foot-qa-002)
 *
 * 시나리오:
 *   1. 신규 customer + check_in 시드 (status=payment_waiting)
 *   2. PaymentDialog 패키지 결제 시뮬 (DB 직접)
 *      - packages INSERT (preset_12, total_amount=3.6M, paid_amount=3.6M)
 *      - package_payments 2건 INSERT (카드 2M + 현금 1.6M)
 *   3. check_in.package_id 갱신 + status='treatment_waiting'
 *   4. 합계 검증
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { CLINIC_ID, seedCheckIn } from '../../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-4 패키지 신규 + 분할 결제', () => {
  test('패키지 신규 구매 + 분할 결제 풀 사이클', async () => {
    const ck = await seedCheckIn({
      status: 'payment_waiting',
      visit_type: 'new',
      name: `cf4-pkg-split-${Date.now()}`,
    });

    let pkgId: string | null = null;
    try {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const preset = { label: '패키지1 (12회)', total: 12, suggestedPrice: 3600000 };
      const splitCard = 2000000;
      const splitCash = 1600000;
      const totalAmount = splitCard + splitCash;

      // 1) packages INSERT (PaymentDialog 패턴 그대로)
      const { data: pkg, error: pkgErr } = await sb
        .from('packages')
        .insert({
          clinic_id: CLINIC_ID,
          customer_id: ck.customerId,
          package_name: preset.label,
          package_type: `preset_${preset.total}`,
          total_sessions: preset.total,
          total_amount: preset.suggestedPrice,
          paid_amount: totalAmount,
          status: 'active',
        })
        .select('id')
        .single();
      expect(pkgErr).toBeNull();
      expect(pkg).toBeTruthy();
      pkgId = pkg!.id as string;

      // 2) package_payments 분할 2건
      const { error: ppErr } = await sb.from('package_payments').insert([
        {
          clinic_id: CLINIC_ID,
          package_id: pkgId,
          customer_id: ck.customerId,
          amount: splitCard,
          method: 'card',
          installment: 12,
        },
        {
          clinic_id: CLINIC_ID,
          package_id: pkgId,
          customer_id: ck.customerId,
          amount: splitCash,
          method: 'cash',
          installment: null,
        },
      ]);
      expect(ppErr).toBeNull();

      // 3) check_in.package_id + status 전이
      await sb
        .from('check_ins')
        .update({ package_id: pkgId, status: 'treatment_waiting' })
        .eq('id', ck.id);

      // 4) 합계 검증
      const { data: payRows } = await sb
        .from('package_payments')
        .select('amount, method')
        .eq('package_id', pkgId);
      const sum = (payRows ?? []).reduce((a, r) => a + (r.amount as number), 0);
      const card = (payRows ?? []).filter((r) => r.method === 'card').reduce((a, r) => a + (r.amount as number), 0);
      const cash = (payRows ?? []).filter((r) => r.method === 'cash').reduce((a, r) => a + (r.amount as number), 0);
      console.log(`분할 결제: 카드 ${card} + 현금 ${cash} = ${sum}`);
      expect(sum).toBe(totalAmount);
      expect(card).toBe(splitCard);
      expect(cash).toBe(splitCash);

      // check_in 정합
      const { data: ciRow } = await sb.from('check_ins').select('package_id, status').eq('id', ck.id).single();
      expect(ciRow?.package_id).toBe(pkgId);
      expect(ciRow?.status).toBe('treatment_waiting');
    } finally {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      if (pkgId) {
        await sb.from('package_payments').delete().eq('package_id', pkgId);
        await sb.from('packages').delete().eq('id', pkgId);
      }
      await ck.cleanup();
    }
  });
});
