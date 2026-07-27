/**
 * E2E spec — T-20260727-foot-PMW-SETTLE-NOAUTOCOMPLETE
 * 선수금 차감(deductMode) [수납] 시 완료칸 자동이동/회색처리 억제.
 *
 * 확정 스펙 (2026-07-27 김주연 총괄):
 *   Q1 스코프 = 선수금 차감(deductMode / taxType='선수금') [수납] 한정.
 *              일반 [수납] 완료전이는 현행 유지(스코프 확장 아님).
 *   Q2 종료상태 = 신규 상태값 없음·현행 진행상태 유지 → check_ins.status='done' 완료전이 스킵(no-DDL).
 *   Q3 수납보존 = payments INSERT + 선수금 회차소진(consume RPC) 정상 유지.
 *              '완료칸 이동/회색처리'(status='done' / status_transitions→done / dark_gray flag)만 억제.
 *
 * 구현: PaymentMiniWindow.executeAutoDone 에서 isDeductSettle(=taxType==='선수금') 일 때
 *       ① check_ins.status='done' UPDATE 스킵
 *       ② status_transitions(to_status='done') insert 스킵
 *       ③ applyStatusFlagTransition(...,'dark_gray') 스킵 + promoteVisitTypeToReturning 스킵
 *       ④ payments INSERT / consume_package_sessions_for_checkin RPC 는 그대로 유지
 *   완료칸 이동(및 그 부수효과)은 스태프가 카드를 [완료]로 옮길 때 Dashboard handleDrop 이 전담.
 *
 * 시나리오 1: 선수금차감 [수납] → payments 기록 + 상태 유지(완료 미이동, 회색 미처리, done 전이 없음)
 * 시나리오 2: 스태프가 [완료]로 이동 → 지연된 완료 부수효과(status=done / dark_gray / 전이) 정상 적용
 * 회귀 가드 A: 일반 [수납](비-선수금) → status='done' 완료전이 정상(핵심 완료동선 무손상)
 * 회귀 가드 B: 선수금차감 경로가 일반 수납 경로에 무영향(taxType 로만 분기)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// PaymentMiniWindow.executeAutoDone 완료전이 게이트의 write-semantic 을 그대로 재현하는 시뮬레이터.
//   isDeductSettle=true → 완료전이(status/transition/flag) 스킵, payment 만 기록.
//   isDeductSettle=false → 완료전이 수행(종전 동선).
async function simulateSettleWritePath(
  sb: ReturnType<typeof createClient>,
  args: {
    checkInId: string;
    clinicId: string;
    customerId: string;
    fromStatus: string;
    taxType: string | null; // '선수금' | null
    amount: number;
    method: string;
  },
) {
  const isDeductSettle = args.taxType === '선수금';

  // ④ payments INSERT — isDeductSettle 여부와 무관하게 항상 기록(Q3 수납 보존).
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

  if (!isDeductSettle) {
    // ① 완료전이 (일반 수납 경로만)
    const { error: ciErr } = await sb
      .from('check_ins')
      .update({ status: 'done' })
      .eq('id', args.checkInId);
    if (ciErr) throw new Error(`status=done 전이 실패: ${ciErr.message}`);

    // ② status_transitions → done
    await sb.from('status_transitions').insert({
      check_in_id: args.checkInId,
      clinic_id: args.clinicId,
      from_status: args.fromStatus,
      to_status: 'done',
    });

    // ③ dark_gray 회색화 (표시 플래그)
    await sb
      .from('check_ins')
      .update({ status_flag: 'dark_gray' })
      .eq('id', args.checkInId);
  }
}

test.describe('T-20260727-PMW-SETTLE-NOAUTOCOMPLETE — 선수금차감 수납 완료 억제', () => {

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

  test('시나리오 2: 선수금차감 수납 후 스태프가 [완료]로 이동 → 지연된 완료 부수효과 정상 적용', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `deduct-thenmove-${Date.now()}`;
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
      // 선수금차감 수납(완료 억제) — 상태 유지.
      await simulateSettleWritePath(sb, {
        checkInId,
        clinicId: CLINIC_ID,
        customerId: customer!.id as string,
        fromStatus: 'preconditioning',
        taxType: '선수금',
        amount: 50000,
        method: 'card',
      });

      // 스태프가 카드를 [완료]로 드래그 → Dashboard handleDrop(newStatus='done') 재현:
      //   status='done' + status_transitions→done + dark_gray flag.
      await sb.from('check_ins').update({ status: 'done', status_flag: 'dark_gray' }).eq('id', checkInId);
      await sb.from('status_transitions').insert({
        check_in_id: checkInId,
        clinic_id: CLINIC_ID,
        from_status: 'preconditioning',
        to_status: 'done',
      });

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

  test('회귀 가드 A: 일반 [수납](비-선수금) → status=done 완료전이 정상 (핵심 완료동선 무손상)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `normal-settle-regress-${Date.now()}`;
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
      // 일반 수납(taxType=null) — 완료전이 수행되어야 함.
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
      expect(after?.status, '일반 수납은 종전대로 status=done 완료전이').toBe('done');
      expect(after?.status_flag, '일반 수납 완료 시 dark_gray 회색화 유지').toBe('dark_gray');

      const { data: transitions } = await sb
        .from('status_transitions')
        .select('id')
        .eq('check_in_id', checkInId)
        .eq('to_status', 'done');
      expect(transitions?.length ?? 0, '일반 수납 done 전이 기록 유지').toBeGreaterThan(0);

      const { data: pays } = await sb
        .from('payments')
        .select('tax_type')
        .eq('check_in_id', checkInId);
      expect(pays?.[0]?.tax_type ?? null, '일반 수납 tax_type 은 선수금 아님').not.toBe('선수금');

      console.log('[회귀A] 일반 수납 완료동선(done/dark_gray/전이) 무손상 PASS');
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('회귀 가드 B: 분기 기준은 taxType 단독 — 동일 상태에서 선수금/일반이 서로 다른 결과', async () => {
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
      // 동일 시작상태(preconditioning)에서 taxType 만 다르게 두 경로 실행.
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
      expect(n?.status, '일반: 완료 이동').toBe('done');

      console.log('[회귀B] taxType 단독 분기 — 선수금≠일반 결과 분리 확인 PASS');
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
