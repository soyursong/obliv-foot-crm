/**
 * E2E spec — T-20260721-foot-CHECKIN-RECEIPT-SOFTVOID-PHANTOM
 * payments.status 유령수납 — 체크인상세/영수증재발행 축 active-only(fail-closed allow-list) 계약
 *
 * RC: 부모 CHARTPAGE-SOFTVOID(d626260f, deployed) 스코프 밖 잔존 표면 2파일.
 *     CheckInDetailSheet(718 결제조회 / 951 삭제가드 count) · DocumentPrintPanel(701 영수증재발행 조회)
 *     의 payments read 가 `.neq('status','deleted')` 블랙리스트 → cancelled 결제 누수.
 * FIX: 3 read 전부 `.eq('status','active')` fail-closed allow-list 로 교정.
 *     낙관적 업데이트 파생 state 도 `status === 'active'` allow-list 정합(AC2).
 *
 * ※ 축 구분: payments.status(체크인상세/영수증 표시 축) — sales/Closing/DailyHistory(매출·마감 축,
 *   OUT OF SCOPE) · MedicalChartPanel(gated) 과 별개. 본 spec 은 체크인상세/영수증 축만 검증.
 *
 * 시나리오 1: 체크인 상세 결제조회 — 취소결제 제외(정상화)
 * 시나리오 2: 영수증 재발행 조회 — 취소결제 제외 (재무-법적 문서 오표시 방지)
 * 시나리오 3: 정상 고객 불변(회귀 가드) + 삭제가드 count active-only
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

type SB = ReturnType<typeof createClient>;

async function seedCheckInWithPayments(
  sb: SB,
  suffix: string,
  statuses: string[],
) {
  const name = `phantom-ci-${suffix}-${Date.now()}`;
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

  // 각 status 당 amount = 10,000 (active 만 유효 표시 대상)
  const rows = statuses.map((s) => ({
    clinic_id: CLINIC_ID, check_in_id: checkIn!.id, customer_id: customer!.id,
    amount: 10000, method: 'card', installment: null, payment_type: 'payment',
    status: s,
  }));
  const { error: payErr } = await sb.from('payments').insert(rows);
  expect(payErr, `결제 seed 실패: ${payErr?.message}`).toBeNull();

  return { customerId: customer!.id as string, checkInId: checkIn!.id as string };
}

async function cleanup(sb: SB, customerId: string, checkInId: string) {
  await sb.from('payments').delete().eq('customer_id', customerId);
  await sb.from('check_ins').delete().eq('id', checkInId);
  await sb.from('customers').delete().eq('id', customerId);
}

test.describe('T-20260721-CHECKIN-RECEIPT-SOFTVOID-PHANTOM — 체크인상세/영수증 유령수납', () => {

  test('시나리오 1: 체크인 상세 결제조회(CheckInDetailSheet:718) — 취소결제 제외', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    // active 2건 / cancelled 1건 / deleted 1건
    const { customerId, checkInId } = await seedCheckInWithPayments(
      sb, 's1', ['active', 'active', 'cancelled', 'deleted']);
    try {
      // CheckInDetailSheet:718 조회 계약 (check_in_id 스코프 + active-only)
      const { data } = await sb.from('payments')
        .select('id, amount, method, installment, payment_type, created_at, status, check_in_id, clinic_id')
        .eq('check_in_id', checkInId).eq('status', 'active');
      expect(data!.length, 'active 2건만 조회(cancelled/deleted 배제)').toBe(2);
      const total = (data as { amount: number }[]).reduce((s, p) => s + p.amount, 0);
      expect(total, '체크인 상세 결제 합계 = active 20,000').toBe(20000);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 2: 영수증 재발행 조회(DocumentPrintPanel:701) — 취소결제 제외', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { customerId, checkInId } = await seedCheckInWithPayments(
      sb, 's2', ['active', 'cancelled']);
    try {
      // 영수증 재발행 조회 (active-only) — 재무-법적 문서라 취소결제 표시가 곧 오표시
      const { data: reissue } = await sb.from('payments')
        .select('id, amount, method, payment_type, created_at')
        .eq('check_in_id', checkInId).eq('status', 'active')
        .order('created_at');
      expect(reissue!.length, '영수증 재발행 대상 = active 1건').toBe(1);

      // 대조: 블랙리스트(.neq deleted)였다면 cancelled 가 영수증에 누출됐을 것
      const { data: blacklist } = await sb.from('payments')
        .select('status').eq('check_in_id', checkInId).neq('status', 'deleted');
      const bStatuses = new Set((blacklist as { status: string }[]).map((r) => r.status));
      expect(bStatuses.has('cancelled'), '블랙리스트였다면 cancelled 영수증 누출(대조)').toBe(true);
    } finally {
      await cleanup(sb, customerId, checkInId);
    }
  });

  test('시나리오 3: 정상 고객 불변(회귀) + 삭제가드 count(CheckInDetailSheet:951) active-only', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB env 미설정');
    const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    // 회귀: active 만 있는 정상 고객 — 표시·합계 불변
    const clean = await seedCheckInWithPayments(sb, 's3a', ['active', 'active', 'active']);
    try {
      const { data } = await sb.from('payments')
        .select('amount, status').eq('check_in_id', clean.checkInId).eq('status', 'active');
      expect(data!.length, '정상고객 active 3건 그대로').toBe(3);
      const total = (data as { amount: number }[]).reduce((s, p) => s + p.amount, 0);
      expect(total, '정상고객 합계 불변 = 30,000').toBe(30000);
    } finally {
      await cleanup(sb, clean.customerId, clean.checkInId);
    }

    // 삭제가드 count(951): active 결제만 삭제 차단, 취소/삭제 결제는 차단 대상 아님
    const voided = await seedCheckInWithPayments(sb, 's3b', ['cancelled', 'deleted']);
    try {
      const { count } = await sb.from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('check_in_id', voided.checkInId).eq('status', 'active');
      expect(count ?? 0, '취소·삭제만 있는 체크인은 active count=0 → 삭제 허용').toBe(0);
    } finally {
      await cleanup(sb, voided.customerId, voided.checkInId);
    }
  });
});
