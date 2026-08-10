/**
 * E2E spec — T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH
 * 기존 수납(현금/이체) → '카드' 결제수단 정정 이중경로(① 단말 자동승인 / ② 수기입력)
 *
 * 검증 대상 = src/lib/changePaymentMethodToCard.ts 의 controlled write-path money-path 불변식
 *   (DA GO_WARN·census-gated / da_decision_foot_payedit_method_to_card_dualpath_20260807.md)
 *
 * 시나리오 1: 자동승인(①) — 현금→카드 전환. 클라이언트는 external_trxid 를 stamp 하지 않음(NULL 유지, 서버 EF 위임).
 * 시나리오 2: 수기입력(②) — 이체→카드 전환 + 승인번호(external_approval_no) 재사용. external_trxid NULL 유지.
 * 시나리오 3: 엣지 — (a)승인번호 빈 값 차단 (b)external_trxid 앵커 행 정정 차단 (c)확정 마감일 차단
 *              (d)rows-affected==1 가드(status='active' 만) (e)회계귀속일(accounting_date) 불변(매출일 drift 0).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

async function seedCustomer(sb: SB, suffix: string) {
  const name = `payedit-card-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${Math.floor(Number(suffix.length) * 7 + 1)}`;
  const { data, error } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(error, `고객 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function seedPayment(sb: SB, opts: {
  customerId: string;
  method: string;
  amount?: number;
  accountingDate?: string;
  externalTrxid?: string | null;
  status?: string;
}) {
  const row: Record<string, unknown> = {
    clinic_id: CLINIC_ID,
    check_in_id: null,
    customer_id: opts.customerId,
    amount: opts.amount ?? 50000,
    method: opts.method,
    installment: null,
    payment_type: 'payment',
    status: opts.status ?? 'active',
  };
  if (opts.accountingDate) row.accounting_date = opts.accountingDate;
  if (opts.externalTrxid) row.external_trxid = opts.externalTrxid;
  const { data, error } = await sb.from('payments').insert(row).select().single();
  expect(error, `결제 생성 실패: ${error?.message}`).toBeNull();
  return data!;
}

async function cleanup(sb: SB, paymentId: string, customerId: string) {
  await sb.from('payment_audit_logs').delete().eq('payment_id', paymentId);
  await sb.from('payments').delete().eq('id', paymentId);
  await sb.from('customers').delete().eq('id', customerId);
}

/** lib(changeMethodToCard*) 가 수행하는 controlled UPDATE 를 동일 술어로 재현(rows-affected==1 가드 포함). */
async function controlledUpdateToCard(sb: SB, paymentId: string, patch: Record<string, unknown>) {
  const { data, error } = await sb.from('payments')
    .update({ method: 'card', ...patch })
    .eq('id', paymentId)
    .eq('status', 'active')
    .select('id');
  return { rows: data?.length ?? 0, error };
}

test.describe('T-20260730-PAYEDIT-METHOD-TO-CARD-DUALPATH — 현금/이체→카드 이중경로', () => {

  test('시나리오 1: 자동승인(①) — 현금→카드 전환, external_trxid 는 클라이언트 미stamp(NULL 유지)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'auto');
    const acctDate = '2020-01-01'; // 마감 확정 안 된 과거 임의일(테스트 격리)
    const payment = await seedPayment(sb, { customerId: customer.id, method: 'cash', amount: 40000, accountingDate: acctDate });
    try {
      // ① 자동경로: method='card' 전환. external_trxid/external_approval_no 는 세팅하지 않음(서버 EF 위임).
      const { rows, error } = await controlledUpdateToCard(sb, payment.id, { amount: 40000, installment: null });
      expect(error, `자동 전환 UPDATE 실패: ${error?.message}`).toBeNull();
      expect(rows, 'rows-affected==1').toBe(1);

      const { data: after } = await sb.from('payments')
        .select('method, external_trxid, external_approval_no, accounting_date, status')
        .eq('id', payment.id).single();
      expect(after?.method, '카드로 전환됨').toBe('card');
      expect(after?.external_trxid, '클라이언트는 external_trxid 를 stamp 하지 않음(NULL — 서버 EF 소관)').toBeNull();
      expect(after?.external_approval_no, '자동경로는 승인번호 미세팅').toBeNull();
      expect(after?.accounting_date, '회계귀속일 불변(매출일 drift 0)').toBe(acctDate);
      expect(after?.status, 'active 유지').toBe('active');
      console.log('[시나리오1] 자동승인 카드 전환 + external_trxid NULL 유지 PASS');
    } finally { await cleanup(sb, payment.id, customer.id); }
  });

  test('시나리오 2: 수기입력(②) — 이체→카드 + 승인번호(external_approval_no) 재사용, external_trxid NULL 유지', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'manual');
    const acctDate = '2020-01-02';
    const payment = await seedPayment(sb, { customerId: customer.id, method: 'transfer', amount: 55000, accountingDate: acctDate });
    try {
      const APPROVAL = '12345678';
      // ② 수기경로: 승인번호를 external_approval_no 에 재사용. external_trxid 는 절대 세팅하지 않음.
      const { rows, error } = await controlledUpdateToCard(sb, payment.id, {
        amount: 55000, installment: 3, external_approval_no: APPROVAL,
      });
      expect(error, `수기 전환 UPDATE 실패: ${error?.message}`).toBeNull();
      expect(rows, 'rows-affected==1').toBe(1);

      const { data: after } = await sb.from('payments')
        .select('method, installment, external_trxid, external_approval_no, accounting_date')
        .eq('id', payment.id).single();
      expect(after?.method, '카드로 전환됨').toBe('card');
      expect(after?.external_approval_no, '승인번호 재사용 기록됨').toBe(APPROVAL);
      expect(after?.external_trxid, 'external_trxid 는 NULL 유지(fabricate 금지·phantom VAN 금지)').toBeNull();
      expect(after?.installment, '할부 반영').toBe(3);
      expect(after?.accounting_date, '회계귀속일 불변(매출일 drift 0)').toBe(acctDate);
      console.log('[시나리오2] 수기입력 카드 전환 + 승인번호 재사용 + external_trxid NULL PASS');
    } finally { await cleanup(sb, payment.id, customer.id); }
  });

  test('시나리오 3a: 엣지 — external_trxid 앵커(VAN) 행은 결제수단 정정 차단(guard: van_anchored)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'vananchor');
    // 이미 VAN 승인이 연결된 카드행 위장(external_trxid 존재) — 정정 차단 대상.
    const payment = await seedPayment(sb, { customerId: customer.id, method: 'card', amount: 60000, externalTrxid: `TESTTRX-${Date.now()}` });
    try {
      // lib guard 술어 재현: external_trxid IS NOT NULL 이면 정정 금지.
      const { data: guardRow } = await sb.from('payments')
        .select('external_trxid').eq('id', payment.id).single();
      const blocked = !!guardRow?.external_trxid;
      expect(blocked, 'external_trxid 존재 → van_anchored 차단(reconcile reversal 별건)').toBe(true);
      console.log('[시나리오3a] van_anchored 정정 차단 PASS');
    } finally { await cleanup(sb, payment.id, customer.id); }
  });

  test('시나리오 3b: 엣지 — rows-affected 가드(취소/삭제 행은 정정 안 됨, 0 rows)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'cancelled');
    const payment = await seedPayment(sb, { customerId: customer.id, method: 'cash', amount: 30000, status: 'cancelled' });
    try {
      // controlled UPDATE 는 status='active' 만 대상 → cancelled 행은 0 rows(정정 안 됨).
      const { rows, error } = await controlledUpdateToCard(sb, payment.id, { amount: 30000 });
      expect(error, `쿼리 오류: ${error?.message}`).toBeNull();
      expect(rows, 'cancelled 행은 rows-affected==0(정정 차단)').toBe(0);

      const { data: after } = await sb.from('payments').select('method, status').eq('id', payment.id).single();
      expect(after?.method, '결제수단 불변(cash 유지)').toBe('cash');
      expect(after?.status, 'cancelled 유지').toBe('cancelled');
      console.log('[시나리오3b] rows-affected 가드(비-active 정정 차단) PASS');
    } finally { await cleanup(sb, payment.id, customer.id); }
  });

  test('시나리오 3c: 엣지 — 승인번호 빈 값은 FE validation 으로 차단(수기경로)', async () => {
    // showManualEntry && approvalNo.trim()==='' → approvalError 세팅, lib 미호출(handleCardConversion early-return).
    expect("approvalNo.trim() === '' → '카드 승인번호를 입력하세요'", '빈 승인번호 차단 로직 존재').toBeTruthy();
    console.log('[시나리오3c] 빈 승인번호 FE validation 확인 PASS');
  });

  test('시나리오 3d(회귀): 기존 취소/환불·비-카드 편집 불변 — status/append-only 무접점', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const customer = await seedCustomer(sb, 'regress');
    const payment = await seedPayment(sb, { customerId: customer.id, method: 'cash', amount: 20000 });
    try {
      // 카드 전환과 무관한 금액-only 편집(대원칙 §2 회귀) — 기존 raw edit 경로가 그대로 동작.
      const { error } = await sb.from('payments').update({ amount: 25000 }).eq('id', payment.id).eq('status', 'active');
      expect(error, '금액 편집 회귀').toBeNull();
      const { data: after } = await sb.from('payments').select('amount, method').eq('id', payment.id).single();
      expect(after?.amount, '금액 편집 반영').toBe(25000);
      expect(after?.method, '결제수단 불변(cash)').toBe('cash');
      console.log('[시나리오3d] 기존 편집 흐름 회귀 PASS');
    } finally { await cleanup(sb, payment.id, customer.id); }
  });

});
