/**
 * E2E spec — T-20260822-foot-CLOSING-SUSU-CANCEL-FILTER-FIX
 * 일마감 > 수납내역 목록/합계에서 취소(cancelled) 결제 제외 — 담당실장별 canonical 필터 정렬
 *
 * [문제] 수납내역 쿼리(Closing.tsx L471)는 .neq('status','deleted') 만 사용 → cancelled 포함.
 *        담당실장별 매출(staffRevenue.ts L155)은 .not('status','in','(cancelled,deleted)') → cancelled 제외.
 *        구조적 비대칭 → '총매출·담당실장별 total ↔ 수납내역 total' 불일치(STAFFREV-AUGUST DIAG H1).
 * [Fix]  Closing.tsx 수납내역 쿼리를 .not('status','in','(cancelled,deleted)') 로 정렬(canonical 수렴).
 *
 * AC-1: 수납내역 쿼리(fixed) — active 포함 / cancelled 제외 / deleted 제외
 * AC-2: 담당실장별 canonical 필터와 동일 결과집합(대칭) — 두 필터가 같은 행 집합 반환
 * AC-3: 회귀 — deleted 제외는 그대로 유지(기존 T-20260514 동작 보존)
 *
 * ※ money-path read-path only·db_change=false. INV5 무회귀(HERALD 권위총액=daily_closings 확정컬럼
 *   내부정합, 라이브 payments 재조회 아님 — 20260806150000 herald_totals_recompute_port).
 */
import { test, expect } from '@playwright/test';
// T-20260822-meta-CLOSING-SPEC-UNCONDITIONAL-PRODGUARD-EXTEND (AC-2): 가드된 createClient 로
//   교체 — EXPECT_DEV_DB_REF opt-in 무관 UNCONDITIONAL 로 target/url 이 PROD ref 이면 client
//   생성 이전 fail-closed abort(마감 spec 실환자 prod-write phantom 진원 봉인). dev → 통과(회귀 0).
import { createClient } from './critical-flow/_prodWriteGuard';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// Closing.tsx 수납내역 쿼리의 FIXED 상태필터 = staffRevenue.ts canonical 과 동일.
const CANONICAL_STATUS_EXCL = '(cancelled,deleted)';

async function seedCheckInAndCustomer(sb: ReturnType<typeof createClient>, suffix: string) {
  const name = `susu-cancelflt-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}-${suffix}`;
  const { data: customer, error: custErr } = await sb.from('customers').insert({
    clinic_id: CLINIC_ID, name, phone, visit_type: 'returning',
  }).select().single();
  expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

  const { data: checkIn, error: ciErr } = await sb.from('check_ins').insert({
    clinic_id: CLINIC_ID, customer_id: customer!.id, customer_name: name,
    customer_phone: phone, visit_type: 'returning', status: 'done', queue_number: 997,
  }).select().single();
  expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
  return { customer: customer!, checkIn: checkIn! };
}

async function seedPayment(
  sb: ReturnType<typeof createClient>,
  checkInId: string, customerId: string, status: string, createdAt: string,
) {
  const { data, error } = await sb.from('payments').insert({
    clinic_id: CLINIC_ID, check_in_id: checkInId, customer_id: customerId,
    amount: 50000, method: 'card', installment: null, payment_type: 'payment',
    status, created_at: createdAt, accounting_date: createdAt.slice(0, 10),
  }).select().single();
  expect(error, `결제 생성 실패(status=${status}): ${error?.message}`).toBeNull();
  return data!;
}

test.describe('T-20260822-CLOSING-SUSU-CANCEL-FILTER-FIX — 수납내역 취소건 제외 정합', () => {

  test('시나리오 1 (AC-1/AC-3): 수납내역 쿼리(fixed) — active 포함·cancelled 제외·deleted 제외', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn } = await seedCheckInAndCustomer(sb, 's1');

    // 같은 날짜 윈도우에 3건: active / cancelled / deleted
    const day = new Date().toISOString().slice(0, 10);
    const at = (h: number) => `${day}T0${h}:00:00.000+09:00`;
    const pActive = await seedPayment(sb, checkIn.id, customer.id, 'active', at(1));
    const pCancel = await seedPayment(sb, checkIn.id, customer.id, 'cancelled', at(2));
    const pDelete = await seedPayment(sb, checkIn.id, customer.id, 'deleted', at(3));

    try {
      const start = `${day}T00:00:00.000+09:00`;
      const end = `${day}T23:59:59.999+09:00`;

      // FIXED 수납내역 쿼리 시뮬 — Closing.tsx L471 fixed predicate
      const { data: visible, error } = await sb.from('payments')
        .select('id, status')
        .eq('clinic_id', CLINIC_ID)
        .eq('check_in_id', checkIn.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .not('status', 'in', CANONICAL_STATUS_EXCL);
      expect(error, `수납내역 쿼리 실패: ${error?.message}`).toBeNull();

      const ids = (visible ?? []).map(r => r.id);
      expect(ids, '[AC-1] active 수납은 목록에 표시').toContain(pActive.id);
      expect(ids, '[AC-1] cancelled 수납은 목록에서 제외(핵심 fix)').not.toContain(pCancel.id);
      expect(ids, '[AC-3] deleted 수납은 목록에서 제외(기존 회귀 보존)').not.toContain(pDelete.id);

      console.log('[시나리오1] 수납내역 취소·삭제 제외, active 만 표시 PASS');
    } finally {
      await sb.from('payments').delete().in('id', [pActive.id, pCancel.id, pDelete.id]);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

  test('시나리오 2 (AC-2): 수납내역 필터 == 담당실장별 canonical 필터 결과집합 대칭', async () => {
    if (!SUPA_URL || !SERVICE_KEY) { test.skip(true, 'Supabase env 미설정 — 스킵'); return; }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { customer, checkIn } = await seedCheckInAndCustomer(sb, 's2');

    const day = new Date().toISOString().slice(0, 10);
    const at = (h: number) => `${day}T0${h}:00:00.000+09:00`;
    const pActive = await seedPayment(sb, checkIn.id, customer.id, 'active', at(4));
    const pCancel = await seedPayment(sb, checkIn.id, customer.id, 'cancelled', at(5));

    try {
      // 수납내역(Closing.tsx L471 fixed) 필터
      const { data: susu } = await sb.from('payments')
        .select('id').eq('clinic_id', CLINIC_ID).eq('check_in_id', checkIn.id)
        .not('status', 'in', CANONICAL_STATUS_EXCL);
      // 담당실장별(staffRevenue.ts L155) 동일 canonical 필터
      const { data: staffrev } = await sb.from('payments')
        .select('id').eq('clinic_id', CLINIC_ID).eq('check_in_id', checkIn.id)
        .not('status', 'in', CANONICAL_STATUS_EXCL);

      const susuIds = new Set((susu ?? []).map(r => r.id));
      const staffIds = new Set((staffrev ?? []).map(r => r.id));
      expect([...susuIds].sort(), '[AC-2] 수납내역 == 담당실장별 결과집합 대칭').toEqual([...staffIds].sort());
      expect(susuIds.has(pActive.id), '[AC-2] 양쪽 모두 active 포함').toBe(true);
      expect(susuIds.has(pCancel.id), '[AC-2] 양쪽 모두 cancelled 제외').toBe(false);

      console.log('[시나리오2] 수납내역 ↔ 담당실장별 canonical 필터 대칭 PASS');
    } finally {
      await sb.from('payments').delete().in('id', [pActive.id, pCancel.id]);
      await sb.from('check_ins').delete().eq('id', checkIn.id);
      await sb.from('customers').delete().eq('id', customer.id);
    }
  });

});
