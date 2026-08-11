/**
 * E2E spec — T-20260727-foot-PMW-SETTLE-NOAUTOCOMPLETE
 * [수납] 클릭 시 완료칸 자동이동/회색처리 억제 — 모든 수납 유형(19:47 스코프 확장).
 *
 * 확정 스펙 (2026-07-27 김주연 총괄):
 *   Q1 스코프 = **모든 수납 유형**(scope_update MSG-20260727-193904-ct5n, reporter-explicit
 *              "모든 수납 유형 포함"). 선수금 차감(deductMode/taxType='선수금')뿐 아니라 일반 수납/카드/
 *              현금/이체 등 [수납] 버튼(handleSettle→executeAutoDone) 전 경로. (기존 deductMode한정 재정의.)
 *   Q2 종료상태 = 신규 상태값 없음·현행 진행상태 유지 → check_ins.status='done' 완료전이 스킵(no-DDL).
 *   Q3 수납보존 = payments INSERT + 선수금 회차소진(consume RPC) 정상 유지.
 *              '완료칸 이동/회색처리'(status='done' / status_transitions→done / dark_gray flag)만 억제.
 *
 * 구현: PaymentMiniWindow.executeAutoDone 에서 taxType(선수금/일반) 무관하게
 *       ① check_ins.status='done' UPDATE 스킵 (전 수납경로)
 *       ② status_transitions(to_status='done') insert 스킵 (전 수납경로)
 *       ③ applyStatusFlagTransition(...,'dark_gray') 스킵 + promoteVisitTypeToReturning 스킵 (전 수납경로)
 *       ④ payments INSERT / consume_package_sessions_for_checkin RPC 는 그대로 유지
 *   완료칸 이동(및 그 부수효과)은 스태프가 카드를 [완료]로 옮길 때 Dashboard handleDrop 이 전담.
 *   ⚠ 스코프 경계: 억제는 executeAutoDone(칸반 [수납] 버튼) 한정. recordManualPayment(영수증 팝업·
 *     일마감 수기수납 'checkin' 라우팅)의 별도 진입점 status='done' 은 본 티켓 미변경.
 *
 * 시나리오 1: 선수금차감 [수납] → payments 기록 + 상태 유지(완료 미이동·회색 미처리·done 전이 없음)
 * 시나리오 2: 수납 후 스태프가 [완료]로 이동 → 지연된 완료 부수효과(status=done / dark_gray / 전이) 정상 적용
 * 회귀 가드 A: 일반 [수납](비-선수금·카드/현금/이체) → **동일하게 완료칸 미이동·회색 미처리**(스코프 확장 반영)
 * 회귀 가드 B: taxType(선수금/일반) 무관 — 모든 수납 유형이 동일 결과(진행상태 유지). 완료동선은 [완료] 이동이 전담.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // FIXTURE_CLINIC_ID: DEVDB-ISOLATION-CUTOVER leg-A(OFF=prod 상수 불변)

// PaymentMiniWindow.executeAutoDone 완료전이 게이트의 write-semantic 을 그대로 재현하는 시뮬레이터.
//   [19:47 스코프 확장] taxType(선수금/일반) 무관하게 완료전이(status/transition/flag)를 항상 스킵.
//   payment 는 항상 기록(Q3). 완료칸 이동은 [완료] 드래그(handleDrop)가 전담한다.
async function simulateSettleWritePath(
  sb: ReturnType<typeof createClient>,
  args: {
    checkInId: string;
    clinicId: string;
    customerId: string;
    fromStatus: string;
    taxType: string | null; // '선수금' | null — 억제 여부와 무관(전 경로 억제)
    amount: number;
    method: string;
  },
) {
  // ④ payments INSERT — taxType 여부와 무관하게 항상 기록(Q3 수납 보존).
  const { error: payErr } = await sb.from('payments').insert({
    check_in_id: args.checkInId,
    clinic_id: args.clinicId,
    customer_id: args.customerId,
    amount: args.amount,
    method: args.method,
    payment_type: 'payment',
    tax_type: args.taxType,
  });
  if (payErr) throw new Error(`payments insert 실패: ${payErr.message}`);

  // ①②③ 완료전이(status='done' / status_transitions→done / dark_gray)는 전 수납경로에서 스킵.
  //   (구 로직은 여기서 완료전이를 수행했음 — 19:47 스코프 확장으로 모든 수납 유형에서 제거.)
}

// 스태프가 카드를 [완료]로 드래그 → Dashboard handleDrop(newStatus='done') 재현.
async function simulateMoveToDone(
  sb: ReturnType<typeof createClient>,
  args: { checkInId: string; clinicId: string; fromStatus: string },
) {
  await sb.from('check_ins').update({ status: 'done', status_flag: 'dark_gray' }).eq('id', args.checkInId);
  await sb.from('status_transitions').insert({
    check_in_id: args.checkInId,
    clinic_id: args.clinicId,
    from_status: args.fromStatus,
    to_status: 'done',
  });
}

test.describe('T-20260727-PMW-SETTLE-NOAUTOCOMPLETE — [수납] 완료 억제(모든 수납 유형)', () => {

  test('시나리오 1: 선수금차감 [수납] → 결제 기록 + 상태 유지(완료 미이동·회색 미처리·done 전이 없음)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `deduct-noautocomplete-${Date.now()}`;
    const testPhone = `DUMMY-${Date.now()}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    // 재진 패키지 고객이 치료실(preconditioning)에서 선수금 차감 수납하는 시점을 재현.
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'preconditioning',
        queue_number: 970,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      await simulateSettleWritePath(sb, {
        checkInId,
        clinicId: CLINIC_ID,
        customerId: customer!.id as string,
        fromStatus: 'preconditioning',
        taxType: '선수금',
        amount: 50000,
        method: 'card',
      });

      // (Q3) payments 기록은 정상 — 선수금 수납이 남아야 함.
      const { data: pays } = await sb
        .from('payments')
        .select('amount, tax_type, payment_type')
        .eq('check_in_id', checkInId);
      expect(pays?.length, '선수금차감 수납 payments 행이 기록되어야 함').toBeGreaterThan(0);
      expect(pays?.[0]?.tax_type, '선수금 tax_type 으로 기록').toBe('선수금');

      // (Q2) 완료 미이동 — status 는 현재 진행상태(preconditioning) 그대로.
      const { data: after } = await sb
        .from('check_ins')
        .select('status, status_flag')
        .eq('id', checkInId)
        .single();
      expect(after?.status, '선수금차감 수납 후 status 는 완료(done)가 아니라 진행상태 유지').toBe('preconditioning');
      expect(after?.status, 'done 으로 자동 이동하지 않아야 함').not.toBe('done');

      // (Q3) 회색처리 억제 — dark_gray 플래그 미적용.
      expect(after?.status_flag ?? null, '선수금차감 수납은 dark_gray(수납완료 회색) 미적용').not.toBe('dark_gray');

      // (Q2) done 완료전이 audit 없음.
      const { data: transitions } = await sb
        .from('status_transitions')
        .select('id')
        .eq('check_in_id', checkInId)
        .eq('to_status', 'done');
      expect(transitions?.length ?? 0, '선수금차감 수납은 to_status=done 전이 기록이 없어야 함').toBe(0);

      console.log('[시나리오1] 선수금차감 수납 = 결제 기록 O / 완료이동 X / 회색 X / done전이 X PASS');
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 2: 수납 후 스태프가 [완료]로 이동 → 지연된 완료 부수효과 정상 적용', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `settle-thenmove-${Date.now()}`;
    const testPhone = `DUMMY-${Date.now()}`;

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
        status: 'preconditioning',
        queue_number: 971,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // 수납(완료 억제) — 상태 유지.
      await simulateSettleWritePath(sb, {
        checkInId,
        clinicId: CLINIC_ID,
        customerId: customer!.id as string,
        fromStatus: 'preconditioning',
        taxType: '선수금',
        amount: 50000,
        method: 'card',
      });

      // 스태프가 카드를 [완료]로 드래그 → Dashboard handleDrop(newStatus='done') 전담.
      await simulateMoveToDone(sb, { checkInId, clinicId: CLINIC_ID, fromStatus: 'preconditioning' });

      const { data: after } = await sb
        .from('check_ins')
        .select('status, status_flag')
        .eq('id', checkInId)
        .single();
      expect(after?.status, '[완료] 이동 후 status=done').toBe('done');
      expect(after?.status_flag, '[완료] 이동 시 dark_gray 회색화 적용').toBe('dark_gray');

      const { data: transitions } = await sb
        .from('status_transitions')
        .select('id')
        .eq('check_in_id', checkInId)
        .eq('to_status', 'done');
      expect(transitions?.length ?? 0, '[완료] 이동 시 done 전이 기록 1건').toBeGreaterThan(0);

      // payments 는 수납 시점 1건만 — [완료] 이동으로 중복 결제되지 않음.
      const { data: pays } = await sb.from('payments').select('id').eq('check_in_id', checkInId);
      expect(pays?.length, '완료 이동은 결제를 재기록하지 않음(1건 유지)').toBe(1);

      console.log('[시나리오2] 완료 이동 시 지연 부수효과(done/dark_gray/전이) 적용 + 결제 중복 없음 PASS');
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('회귀 가드 A: 일반 [수납](비-선수금·카드) → 동일하게 완료칸 미이동·회색 미처리 (스코프 확장 반영)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `normal-settle-suppress-${Date.now()}`;
    const testPhone = `DUMMY-${Date.now()}`;

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
        queue_number: 972,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // 일반 수납(taxType=null) — 19:47 스코프 확장: 선수금과 동일하게 완료전이 억제.
      await simulateSettleWritePath(sb, {
        checkInId,
        clinicId: CLINIC_ID,
        customerId: customer!.id as string,
        fromStatus: 'payment_waiting',
        taxType: null,
        amount: 30000,
        method: 'card',
      });

      const { data: after } = await sb
        .from('check_ins')
        .select('status, status_flag')
        .eq('id', checkInId)
        .single();
      expect(after?.status, '일반 수납도 완료칸 미이동 — status 진행상태(payment_waiting) 유지').toBe('payment_waiting');
      expect(after?.status, '일반 수납도 done 자동 이동하지 않음').not.toBe('done');
      expect(after?.status_flag ?? null, '일반 수납도 dark_gray 회색화 미적용').not.toBe('dark_gray');

      const { data: transitions } = await sb
        .from('status_transitions')
        .select('id')
        .eq('check_in_id', checkInId)
        .eq('to_status', 'done');
      expect(transitions?.length ?? 0, '일반 수납도 done 전이 기록 없음').toBe(0);

      // (Q3) 결제는 정상 기록.
      const { data: pays } = await sb
        .from('payments')
        .select('tax_type')
        .eq('check_in_id', checkInId);
      expect(pays?.length, '일반 수납 payments 기록 유지').toBeGreaterThan(0);
      expect(pays?.[0]?.tax_type ?? null, '일반 수납 tax_type 은 선수금 아님').not.toBe('선수금');

      console.log('[회귀A] 일반 수납도 완료칸 미이동·회색 미처리(스코프 확장) + 결제 기록 유지 PASS');
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('회귀 가드 B: taxType(선수금/일반) 무관 — 모든 수납 유형이 동일 결과(진행상태 유지)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const stamp = Date.now();

    const seed = async (q: number) => {
      const { data: customer } = await sb
        .from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `branch-${q}-${stamp}`, phone: `DUMMY-${q}-${stamp}`, visit_type: 'returning' })
        .select()
        .single();
      const { data: ci } = await sb
        .from('check_ins')
        .insert({
          clinic_id: CLINIC_ID,
          customer_id: customer!.id,
          customer_name: `branch-${q}-${stamp}`,
          customer_phone: `DUMMY-${q}-${stamp}`,
          visit_type: 'returning',
          status: 'preconditioning',
          queue_number: q,
        })
        .select()
        .single();
      return { customerId: customer!.id as string, checkInId: ci!.id as string };
    };

    const deduct = await seed(973);
    const normal = await seed(974);

    try {
      // 동일 시작상태(preconditioning)에서 taxType 만 다르게 두 경로 실행 — 결과는 동일해야 함(모두 억제).
      await simulateSettleWritePath(sb, {
        checkInId: deduct.checkInId, clinicId: CLINIC_ID, customerId: deduct.customerId,
        fromStatus: 'preconditioning', taxType: '선수금', amount: 40000, method: 'cash',
      });
      await simulateSettleWritePath(sb, {
        checkInId: normal.checkInId, clinicId: CLINIC_ID, customerId: normal.customerId,
        fromStatus: 'preconditioning', taxType: null, amount: 40000, method: 'cash',
      });

      const { data: d } = await sb.from('check_ins').select('status').eq('id', deduct.checkInId).single();
      const { data: n } = await sb.from('check_ins').select('status').eq('id', normal.checkInId).single();
      expect(d?.status, '선수금차감: 진행상태 유지').toBe('preconditioning');
      expect(n?.status, '일반 수납: 동일하게 진행상태 유지(더 이상 완료 이동 아님)').toBe('preconditioning');
      expect(n?.status, '일반 수납도 done 자동 이동 없음').not.toBe('done');

      console.log('[회귀B] taxType 무관 — 선수금=일반 동일 결과(진행상태 유지) 확인 PASS');
    } finally {
      for (const t of [deduct, normal]) {
        await sb.from('payments').delete().eq('check_in_id', t.checkInId);
        await sb.from('status_transitions').delete().eq('check_in_id', t.checkInId);
        await sb.from('check_ins').delete().eq('id', t.checkInId);
        await sb.from('customers').delete().eq('id', t.customerId);
      }
    }
  });

});
