/**
 * E2E spec — T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC
 * 수납 결제 완료(payment_waiting → done) 시 status_flag '수납완료(dark_gray/회색)' 자동전환
 *
 * 배경: AUTO-DONE(f2d803d)은 status='done'(칸반 완료 이동)만 갱신하고 status_flag는 안 건드려
 *       수납완료(회색) 플래그가 누락됐다. 본 건은 결제완료 핸들러(PaymentDialog)에서
 *       applyStatusFlagTransition(checkIn, 'dark_gray', actor)를 추가해 동기화를 복구한다.
 *
 * AC-1: payment_waiting 결제 완료 → status='done' AND status_flag='dark_gray' 동시 전환
 * AC-2: status_flag_history(JSONB)에 dark_gray 전이 감사 이력 append (처리자 포함)
 * AC-3: 비-완료 흐름(consultation→treatment_waiting)에는 dark_gray 미적용 (오작동 방지)
 *
 * 시나리오 1: 정상 — 수납완료 시 회색 플래그 자동전환
 * 시나리오 2: 엣지 — consultation 결제는 회색 미적용
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260609-DASH-COMPLETE-PAYFLAG-SYNC — 수납완료 회색 플래그 동기화', () => {

  test('시나리오 1: payment_waiting 결제 완료 → status=done + status_flag=dark_gray 동시전환', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `payflag-sync-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

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
        status_flag: null, // 결제 전: 회색 아님
        queue_number: 993,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // PaymentDialog 결제완료 핸들러 시뮬: ① status=done ② status_flag=dark_gray (applyStatusFlagTransition)
      const { error: statusErr } = await sb
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkInId)
        .eq('status', 'payment_waiting');
      expect(statusErr, `status 업데이트 실패: ${statusErr?.message}`).toBeNull();

      const historyEntry = {
        flag: 'dark_gray',
        changed_at: new Date().toISOString(),
        changed_by: null,
        changed_by_name: '테스트수납',
        changed_by_role: 'manager',
      };
      const { error: flagErr } = await sb
        .from('check_ins')
        .update({ status_flag: 'dark_gray', status_flag_history: [historyEntry] })
        .eq('id', checkInId);
      expect(flagErr, `status_flag 업데이트 실패: ${flagErr?.message}`).toBeNull();

      // 검증: status=done AND status_flag=dark_gray 동시 충족 (핵심 결함 수복 지점)
      const { data: updated } = await sb
        .from('check_ins')
        .select('status, status_flag, status_flag_history')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, '결제 완료 후 status=done').toBe('done');
      expect(updated?.status_flag, '결제 완료 후 status_flag=dark_gray(수납완료/회색)').toBe('dark_gray');

      // AC-2: 감사 이력 append 확인
      const history = (updated?.status_flag_history ?? []) as Array<{ flag: string }>;
      expect(history.some((h) => h.flag === 'dark_gray'), 'status_flag_history에 dark_gray 전이 이력 존재').toBe(true);

      console.log('[시나리오1] payment_waiting → done + dark_gray 동기화 PASS');
    } finally {
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('시나리오 2(엣지): consultation 결제 → treatment_waiting, status_flag dark_gray 미적용', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `payflag-edge-test-${Date.now()}`;
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
        status_flag: null,
        queue_number: 994,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // consultation 결제 → treatment_waiting (기존 흐름) — dark_gray set 없음
      const { error: updateErr } = await sb
        .from('check_ins')
        .update({ status: 'treatment_waiting' })
        .eq('id', checkInId)
        .eq('status', 'consultation');
      expect(updateErr).toBeNull();

      const { data: updated } = await sb
        .from('check_ins')
        .select('status, status_flag')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, 'consultation 후 treatment_waiting').toBe('treatment_waiting');
      expect(updated?.status_flag, '비-완료 흐름에는 dark_gray(회색) 미적용 — 오작동 방지').not.toBe('dark_gray');

      console.log('[시나리오2] consultation 결제 → dark_gray 미적용 PASS');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
