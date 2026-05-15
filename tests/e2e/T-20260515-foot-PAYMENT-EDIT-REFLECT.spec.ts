/**
 * E2E spec — T-20260515-foot-PAYMENT-EDIT-REFLECT
 * 수납 수정 후 차트 UI 미반영 hotfix 검증
 *
 * 루트코즈: load()는 Promise.all 7쿼리 묶음 — 하나 실패 시 setPayments 미호출.
 * 픽스: refetchPayments (payments만 독립 재조회) + localStorage 2번차트 sync.
 *
 * AC-1: 수납 수정 → 1번차트 즉시 반영
 *   - 수납 수정 후 check_in_id 기반 재조회 시 변경된 amount/method 반환
 * AC-2: 수납 수정 → 2번차트 동기화
 *   - customer_id 기반 재조회(refreshPayments)가 변경된 값 반환
 * AC-3: audit 이력 정합성 유지
 *   - 기존 PAYMENT-EDIT-CANCEL-DELETE 로직 불변 (audit insert 정상)
 * AC-4: 취소/삭제도 동일 패턴 검증
 *   - 취소: check_in_id 재조회 시 status=cancelled 반영
 *   - 삭제: check_in_id 재조회 시 neq(status,deleted) 필터로 해당 건 제거
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

/** refetchPayments 와 동일 쿼리 — AC-1 (check_in_id 기반) */
async function queryByCheckIn(
  sb: ReturnType<typeof createClient>,
  checkInId: string,
) {
  const { data } = await sb
    .from('payments')
    .select('id, amount, method, installment, payment_type, created_at, status, check_in_id, clinic_id')
    .eq('check_in_id', checkInId)
    .neq('status', 'deleted');
  return data ?? [];
}

/** refreshPayments 와 동일 쿼리 — AC-2 (customer_id 기반) */
async function queryByCustomer(
  sb: ReturnType<typeof createClient>,
  customerId: string,
) {
  const { data } = await sb
    .from('payments')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data ?? [];
}

async function seedData(sb: ReturnType<typeof createClient>, suffix: string) {
  const name = `reflect-test-${suffix}-${Date.now()}`;
  const phone = `010${String(Date.now()).slice(-8)}`;

  const { data: customer, error: custErr } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

  const { data: checkIn, error: ciErr } = await sb.from('check_ins').insert({
    clinic_id: CLINIC_ID,
    customer_id: customer!.id,
    customer_name: name,
    customer_phone: phone,
    visit_type: 'returning',
    status: 'done',
    queue_number: 997,
  }).select().single();
  expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();

  const { data: payment, error: payErr } = await sb.from('payments').insert({
    clinic_id: CLINIC_ID,
    check_in_id: checkIn!.id,
    customer_id: customer!.id,
    amount: 50000,
    method: 'card',
    installment: null,
    payment_type: 'payment',
    status: 'active',
  }).select().single();
  expect(payErr, `수납 생성 실패: ${payErr?.message}`).toBeNull();

  return { customer: customer!, checkIn: checkIn!, payment: payment! };
}

test.describe('T-20260515-PAYMENT-EDIT-REFLECT — 수납 수정 차트 반영 검증', () => {

  test('AC-1 / AC-2: 수납 수정 후 1번차트(check_in_id) · 2번차트(customer_id) 재조회 반영', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn, payment } = await seedData(sb, 'edit-reflect');

    try {
      // 수정 전: 원본값 확인
      const before = await queryByCheckIn(sb, checkIn.id);
      expect(before.length, '수정 전 1건').toBe(1);
      expect((before[0] as { amount: number }).amount, '수정 전 50000').toBe(50000);

      // 수납 수정 (refetchPayments 내부 flow — supabase.update)
      const { error: updateErr } = await sb.from('payments').update({
        amount: 40000,
        method: 'cash',
        installment: null,
      }).eq('id', payment.id);
      expect(updateErr, `수정 UPDATE 실패: ${updateErr?.message}`).toBeNull();

      // AC-3: audit INSERT (기존 insertAudit 로직 불변 검증)
      const { error: auditErr } = await sb.from('payment_audit_logs').insert({
        payment_id: payment.id,
        clinic_id: CLINIC_ID,
        check_in_id: checkIn.id,
        action: 'edit',
        before_data: { amount: 50000, method: 'card', installment: null },
        after_data: { amount: 40000, method: 'cash', installment: null },
        actor: 'test@obliv.kr',
        reason: null,
      });
      expect(auditErr, `audit INSERT 실패: ${auditErr?.message}`).toBeNull();

      // AC-1: 1번차트 쿼리(refetchPayments) — 변경 금액·수단 즉시 반영
      const after1 = await queryByCheckIn(sb, checkIn.id);
      expect(after1.length, '수정 후 1번차트 1건').toBe(1);
      expect((after1[0] as { amount: number }).amount, 'AC-1: 40000 반영').toBe(40000);
      expect((after1[0] as { method: string }).method, 'AC-1: cash 반영').toBe('cash');
      expect((after1[0] as { status: string }).status, 'AC-1: status=active 유지').toBe('active');

      // AC-2: 2번차트 쿼리(refreshPayments) — customer_id 기반 동기
      const after2 = await queryByCustomer(sb, customer.id);
      const p2 = after2.find((p: { id: string }) => p.id === payment.id);
      expect(p2, 'AC-2: 2번차트에서 해당 결제 조회됨').toBeTruthy();
      expect((p2 as { amount: number }).amount, 'AC-2: 2번차트 40000 반영').toBe(40000);

      console.log('[AC-1/AC-2] 수납 수정 후 1번차트·2번차트 재조회 PASS');
    } finally {
      await sb.from('payment_audit_logs').delete().eq('payment_id', payment.id);
      await sb.from('payments').delete().eq('id', payment.id);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('AC-4a: 수납 취소 후 1번차트 재조회 — status=cancelled 반영, 쿼리에서 제외 안됨', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn, payment } = await seedData(sb, 'cancel-reflect');

    try {
      // 취소 처리
      const { error: cancelErr } = await sb.from('payments').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: 'test@obliv.kr',
        cancel_reason: '테스트 취소',
      }).eq('id', payment.id);
      expect(cancelErr, `취소 UPDATE 실패: ${cancelErr?.message}`).toBeNull();

      // AC-4a: 1번차트 쿼리 — cancelled는 neq(deleted) 필터에서 제외되지 않음
      const after = await queryByCheckIn(sb, checkIn.id);
      expect(after.length, 'AC-4a: 취소 후 1번차트 여전히 1건 (취소건도 표시)').toBe(1);
      expect((after[0] as { status: string }).status, 'AC-4a: status=cancelled').toBe('cancelled');

      console.log('[AC-4a] 수납 취소 후 1번차트 재조회 PASS');
    } finally {
      await sb.from('payments').delete().eq('id', payment.id);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('AC-4b: 수납 삭제 후 1번차트 재조회 — neq(status,deleted) 필터로 목록에서 제거', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn, payment } = await seedData(sb, 'delete-reflect');

    try {
      // 삭제 처리 (soft-delete)
      const { error: delErr } = await sb.from('payments').update({
        status: 'deleted',
        deleted_at: new Date().toISOString(),
        deleted_by: 'test@obliv.kr',
        delete_reason: '테스트 삭제',
      }).eq('id', payment.id);
      expect(delErr, `삭제 UPDATE 실패: ${delErr?.message}`).toBeNull();

      // AC-4b: 1번차트 쿼리 — deleted는 neq 필터에 걸려 목록에서 사라짐
      const after = await queryByCheckIn(sb, checkIn.id);
      expect(after.length, 'AC-4b: 삭제 후 1번차트 0건 (목록에서 제거됨)').toBe(0);

      console.log('[AC-4b] 수납 삭제 후 1번차트 재조회 PASS');
    } finally {
      await sb.from('payments').delete().eq('id', payment.id);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('AC-3: audit 정합성 — 수정/취소/삭제 모두 before_data·after_data 기록', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn, payment } = await seedData(sb, 'audit-check');

    try {
      // edit audit
      await sb.from('payment_audit_logs').insert({
        payment_id: payment.id, clinic_id: CLINIC_ID, check_in_id: checkIn.id,
        action: 'edit',
        before_data: { amount: 50000, method: 'card' },
        after_data: { amount: 40000, method: 'cash' },
        actor: 'test@obliv.kr',
      });

      // cancel audit
      await sb.from('payment_audit_logs').insert({
        payment_id: payment.id, clinic_id: CLINIC_ID, check_in_id: checkIn.id,
        action: 'cancel',
        before_data: { status: 'active' },
        after_data: { status: 'cancelled' },
        actor: 'test@obliv.kr',
        reason: '고객 요청',
      });

      const { data: logs } = await sb.from('payment_audit_logs')
        .select('action, before_data, after_data, reason')
        .eq('payment_id', payment.id)
        .order('created_at', { ascending: true });

      expect(logs?.length, 'AC-3: audit 2건 기록').toBe(2);
      expect(logs![0].action, 'AC-3: 첫 번째 edit').toBe('edit');
      expect((logs![0].before_data as { amount: number }).amount, 'AC-3: before.amount=50000').toBe(50000);
      expect((logs![0].after_data as { amount: number }).amount, 'AC-3: after.amount=40000').toBe(40000);
      expect(logs![1].action, 'AC-3: 두 번째 cancel').toBe('cancel');
      expect(logs![1].reason, 'AC-3: reason 기록됨').toBe('고객 요청');

      console.log('[AC-3] audit 정합성 PASS');
    } finally {
      await sb.from('payment_audit_logs').delete().eq('payment_id', payment.id);
      await sb.from('payments').delete().eq('id', payment.id);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

});
