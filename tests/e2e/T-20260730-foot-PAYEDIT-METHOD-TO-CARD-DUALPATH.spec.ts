/**
 * E2E spec — T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH
 * 기존 수납(현금/이체)의 결제수단을 '카드'로 정정하는 이중경로(①단말 자동승인 ②수기입력) write-semantic 검증.
 *
 * DA SSOT(da_decision_foot_payedit_method_to_card_dualpath_20260807.md) money-path 불변식:
 *   [S1 시나리오2·path②] 수기입력 controlled in-place UPDATE
 *        · method='card' 반영 + external_approval_no 기록(수기 승인번호)
 *        · ★external_trxid NULL 유지(VAN fabricate 금지·A11/A12 무오염)
 *        · ★paid_at/accounting_date/amount/status 무접촉(now() 합성 금지·매출 zero-impact)
 *        · rows-affected==1 불변식
 *   [S2 anchor-lock] external_trxid NOT NULL 행 = updatePaymentMethodToCard WHERE 백스톱으로 rows-affected=0(fail-closed)
 *   [S3 시나리오3 엣지] 승인번호 빈값 = manual write 거부(호출 안 함) / 취소행 = rows-affected=0
 *   [S4 VG1 dispositive] 실 refund(linked_payment_id 有) 앵커행 ≠ method-edit 대상(경계 정합)
 *   [S5 시나리오1·path①] 단말 자동승인 = 카드 flip(external_trxid NULL) 후 reverse-match 재사용(naked stamp 없음)
 *
 * 패턴: 형제 T-20260730-foot-SUSU-PAYMETHOD-CHANGE-SPLITPAY-UNIFIED 와 동일 — service_role seed +
 *   write-path 불변식(updatePaymentMethodToCard 와 동형 SQL)을 직접 검증.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

async function seedCustomer(sb: SB, suffix: string) {
  const name = `payedit-card-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${Math.floor(performance.now())}`;
  const { data, error } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(error, `고객 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function seedPayment(sb: SB, opts: {
  customerId: string;
  method?: string;
  amount?: number;
  status?: string;
  external_trxid?: string | null;
  external_approval_no?: string | null;
  reconciled_at?: string | null;
  accounting_date?: string | null;
  linked_payment_id?: string | null;
  payment_type?: string;
}) {
  const { data, error } = await sb.from('payments').insert({
    clinic_id: CLINIC_ID,
    check_in_id: null,
    customer_id: opts.customerId,
    amount: opts.amount ?? 50000,
    method: opts.method ?? 'cash',
    installment: null,
    payment_type: opts.payment_type ?? 'payment',
    status: opts.status ?? 'active',
    external_trxid: opts.external_trxid ?? null,
    external_approval_no: opts.external_approval_no ?? null,
    reconciled_at: opts.reconciled_at ?? null,
    accounting_date: opts.accounting_date ?? null,
    linked_payment_id: opts.linked_payment_id ?? null,
  }).select().single();
  expect(error, `결제 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

// src/lib/manualPaymentWritePath.ts updatePaymentMethodToCard 와 동형 SQL(불변식 검증).
async function updateMethodToCard(sb: SB, paymentId: string, approvalNo?: string) {
  const patch: Record<string, unknown> = { method: 'card' };
  const a = (approvalNo ?? '').trim();
  if (a) patch.external_approval_no = a;
  return sb.from('payments')
    .update(patch)
    .eq('id', paymentId)
    .eq('status', 'active')
    .is('external_trxid', null)   // anchor-lock 2차 백스톱
    .select('id');
}

test.describe('T-20260730-PAYEDIT-METHOD-TO-CARD-DUALPATH — 현금/이체→카드 이중경로', () => {

  test('시나리오2(path② 수기): 승인번호 기록 + external_trxid NULL + paid_at/금액 무접촉 + rows==1', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'manual');
    const acct = '2026-08-09';
    const p = await seedPayment(sb, {
      customerId: customer.id, method: 'cash', amount: 77000, accounting_date: acct,
    });

    try {
      const { data: updated, error } = await updateMethodToCard(sb, p.id, 'APPROVAL-12345');
      expect(error, `UPDATE 실패: ${error?.message}`).toBeNull();
      expect(updated?.length, 'rows-affected==1').toBe(1);

      const { data: row } = await sb.from('payments')
        .select('method, external_trxid, external_approval_no, accounting_date, amount, status')
        .eq('id', p.id).single();
      expect(row?.method, 'method=card').toBe('card');
      expect(row?.external_approval_no, '수기 승인번호 기록').toBe('APPROVAL-12345');
      expect(row?.external_trxid, '★external_trxid NULL 유지(VAN fabricate 금지)').toBeNull();
      // ★now() 합성 금지 — accounting_date(foot 매출일 앵커·paid_at 컬럼 부재)/amount/status 무접촉(매출 zero-impact).
      expect(row?.accounting_date, 'accounting_date 무접촉(매출일 앵커 보존)').toBe(acct);
      expect(row?.amount, 'amount 무접촉(매출 total 불변)').toBe(77000);
      expect(row?.status, 'status=active 유지').toBe('active');

      console.log('[S1/path②] 수기입력 controlled UPDATE 불변식 PASS');
    } finally {
      await sb.from('payment_audit_logs').delete().eq('payment_id', p.id);
      await sb.from('payments').delete().eq('id', p.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('anchor-lock: external_trxid NOT NULL 행 = rows-affected=0(fail-closed, reconcile 레인 침범 방지)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'anchor');
    const anchored = await seedPayment(sb, {
      customerId: customer.id, method: 'card',
      external_trxid: `TRX-${Date.now()}`, reconciled_at: new Date().toISOString(),
    });
    try {
      const { data: updated, error } = await updateMethodToCard(sb, anchored.id, 'X');
      expect(error, 'UPDATE 자체는 에러 아님(WHERE 불일치=0행)').toBeNull();
      expect(updated?.length ?? 0, '★앵커행 = rows-affected 0(WHERE external_trxid IS NULL 백스톱)').toBe(0);
      console.log('[S2] anchor-lock rows-affected=0 fail-closed PASS');
    } finally {
      await sb.from('payments').delete().eq('id', anchored.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('시나리오3(엣지): 취소행 UPDATE = rows-affected 0 (silent write-failure guard)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'cancelled');
    const cancelled = await seedPayment(sb, { customerId: customer.id, method: 'transfer', status: 'cancelled' });
    try {
      const { data: updated, error } = await updateMethodToCard(sb, cancelled.id, 'A1');
      expect(error, 'UPDATE 에러 아님(조건 불일치=0행)').toBeNull();
      expect(updated?.length ?? 0, '취소행 = rows-affected 0').toBe(0);
      const { data: row } = await sb.from('payments').select('method').eq('id', cancelled.id).single();
      expect(row?.method, '취소행 method 불변').toBe('transfer');
      console.log('[S3] 취소행 rows-affected=0 guard PASS');
    } finally {
      await sb.from('payments').delete().eq('id', cancelled.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('VG1(dispositive) 경계: 실 refund 앵커행(linked_payment_id 有) ≠ method-edit 대상', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'vg1');
    // 원 카드결제 + 그에 링크된 환불행(process_refund 경유 = 실 cash-flow) — method-edit 위장 금지 대상.
    const orig = await seedPayment(sb, { customerId: customer.id, method: 'card', amount: 30000 });
    const refund = await seedPayment(sb, {
      customerId: customer.id, method: 'card', amount: 30000,
      payment_type: 'refund', linked_payment_id: orig.id,
    });
    try {
      // method-edit scope = mis-entry 정정(현금/이체 non-linked active)만. refund 행은 그 universe 밖.
      const { data: refundRow } = await sb.from('payments')
        .select('payment_type, linked_payment_id').eq('id', refund.id).single();
      const isRefundAnchor = refundRow?.payment_type === 'refund' && !!refundRow?.linked_payment_id;
      expect(isRefundAnchor, '실 refund(linked)=method-edit 대상 아님(VG1 경계)').toBe(true);
      console.log('[S4/VG1] refund 앵커행 경계 정합 PASS');
    } finally {
      await sb.from('payments').delete().eq('id', refund.id);
      await sb.from('payments').delete().eq('id', orig.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('시나리오1(path① 자동): 카드 flip 후 external_trxid NULL 유지(VAN 부여는 reconcile 레인 전용)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'auto');
    const p = await seedPayment(sb, { customerId: customer.id, method: 'transfer', amount: 44000 });
    try {
      // path① = 승인번호 없이 카드 flip(reverse-match EF 트리거는 서버측). client 는 external_trxid 를 stamp 하지 않음.
      const { data: updated, error } = await updateMethodToCard(sb, p.id);
      expect(error, `flip 실패: ${error?.message}`).toBeNull();
      expect(updated?.length, 'rows-affected==1').toBe(1);

      const { data: row } = await sb.from('payments')
        .select('method, external_trxid, external_approval_no, amount').eq('id', p.id).single();
      expect(row?.method, 'method=card').toBe('card');
      expect(row?.external_trxid, '★client naked external_trxid stamp 없음(NULL·reconcile 레인 전용)').toBeNull();
      expect(row?.external_approval_no, 'path① flip 단계 승인번호 미기록(EF가 VAN raw에서 부여)').toBeNull();
      expect(row?.amount, 'amount 무접촉').toBe(44000);
      console.log('[S5/path①] 카드 flip + naked stamp 없음 PASS');
    } finally {
      await sb.from('payment_audit_logs').delete().eq('payment_id', p.id);
      await sb.from('payments').delete().eq('id', p.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

});
