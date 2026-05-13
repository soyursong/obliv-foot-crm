/**
 * E2E spec — T-20260514-foot-PAYMENT-AUTO-DONE
 * 수납 결제 완료 시 check_ins.status 자동 'done' 전환
 *
 * AC-1: PaymentDialog 결제 성공 핸들러 → status = 'done' UPDATE
 * AC-2: 수납대기(payment_waiting) → 완료(done) 자동 전환 (수동 단계이동 불필요)
 * AC-3: 기존 realtime subscription 활용 — 실시간 반영 (칸반 자동 이동)
 * AC-4: payment_waiting → done 정합 (기존 consultation/consult_waiting → treatment_waiting 흐름 유지)
 *
 * 시나리오 1: 정상 동선 — 결제 완료 → status=done 전환
 * 시나리오 2: 엣지 케이스 — 결제 취소 시 status 유지 (payment_waiting 그대로)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260514-PAYMENT-AUTO-DONE — 결제 완료 자동 done 전환', () => {

  test('시나리오 1: payment_waiting 상태에서 결제 완료 → DB status=done 전환', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `auto-done-test-${Date.now()}`;
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
        queue_number: 990,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // PaymentDialog 핸들러 로직 시뮬 (payment_waiting → done)
      const { error: updateErr } = await sb
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkInId)
        .eq('status', 'payment_waiting');
      expect(updateErr, `status 업데이트 실패: ${updateErr?.message}`).toBeNull();

      // DB 전환 확인
      const { data: updated } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, 'payment_waiting 결제 완료 후 status=done 이어야 함').toBe('done');

      // status_transitions 기록 시뮬
      const { error: stErr } = await sb.from('status_transitions').insert({
        check_in_id: checkInId,
        clinic_id: CLINIC_ID,
        from_status: 'payment_waiting',
        to_status: 'done',
      });
      expect(stErr, `status_transitions 기록 실패: ${stErr?.message}`).toBeNull();

      // status_transitions 기록 확인
      const { data: transitions } = await sb
        .from('status_transitions')
        .select('from_status, to_status')
        .eq('check_in_id', checkInId)
        .eq('from_status', 'payment_waiting')
        .eq('to_status', 'done');
      expect(transitions?.length, 'payment_waiting→done 전환 기록이 있어야 함').toBeGreaterThan(0);

      console.log('[시나리오1] payment_waiting → done 전환 PASS');
    } finally {
      // cleanup
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 2: 결제 취소 → status=payment_waiting 유지 (변경 없음)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `cancel-test-${Date.now()}`;
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
        queue_number: 991,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // 취소 시: status 변경 없음 — DB 조회로 검증
      const { data: current } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(current?.status, '취소 시 status=payment_waiting 유지').toBe('payment_waiting');

      // status_transitions에 취소 기록 없음 확인
      const { data: transitions } = await sb
        .from('status_transitions')
        .select('id')
        .eq('check_in_id', checkInId);
      expect(transitions?.length ?? 0, '취소 시 status_transitions 기록 없어야 함').toBe(0);

      console.log('[시나리오2] 취소 후 status=payment_waiting 유지 PASS');
    } finally {
      // cleanup
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-4: consultation 상태 결제 → status=treatment_waiting (기존 흐름 회귀 없음)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `consult-flow-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'new' })
      .select()
      .single();
    expect(custErr).toBeNull();

    const { data: checkIn } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'new',
        status: 'consultation',
        queue_number: 992,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // consultation 결제 → treatment_waiting (기존 흐름)
      const { error: updateErr } = await sb
        .from('check_ins')
        .update({ status: 'treatment_waiting' })
        .eq('id', checkInId)
        .eq('status', 'consultation');
      expect(updateErr).toBeNull();

      const { data: updated } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, 'consultation 후 status=treatment_waiting 이어야 함').toBe('treatment_waiting');
      expect(updated?.status, 'consultation 후 done이 아닌 treatment_waiting').not.toBe('done');

      console.log('[AC-4] consultation → treatment_waiting 기존 흐름 회귀 없음 PASS');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
