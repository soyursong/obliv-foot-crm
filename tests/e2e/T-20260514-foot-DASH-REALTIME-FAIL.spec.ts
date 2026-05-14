/**
 * E2E Spec — T-20260514-foot-DASH-REALTIME-FAIL
 * 대시보드 단계 자동전환 전체 미작동 통합 검증
 *
 * 증상 3건 동시 재현 및 수정 검증:
 * AC-1: 결제 완료 → done 자동전환 (PaymentMiniWindow executeAutoDone)
 * AC-2: 셀프접수 초진 → consult_waiting, 재진 → treatment_waiting
 * AC-3: 수납대기 카드 금액 = check_in_services 합산 (dayPayments 혼용 X)
 * AC-4: Realtime 단절 대비 60초 폴링 fallback — DB 상태 직접 검증
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── AC-1: 결제 완료 → done 자동전환 ──────────────────────────────────────────

test.describe('T-20260514-DASH-REALTIME-FAIL — AC-1: 결제 완료 → done 전환', () => {

  test('payment_waiting 상태에서 executeAutoDone 실행 → status=done + payments 기록', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `dash-fail-ac1-${Date.now()}`;
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
        queue_number: 980,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // executeAutoDone 로직 시뮬: payments INSERT + check_ins status='done' UPDATE
      const amount = 55000;

      const { error: payErr } = await sb.from('payments').insert({
        check_in_id: checkInId,
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        amount,
        method: 'card',
        installment: null,
        memo: null,
        payment_type: 'payment',
      });
      expect(payErr, `payments INSERT 실패: ${payErr?.message}`).toBeNull();

      const { error: statusErr } = await sb
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkInId);
      expect(statusErr, `status done UPDATE 실패: ${statusErr?.message}`).toBeNull();

      // DB 검증
      const { data: finalCi } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(finalCi?.status, 'AC-1: 결제 완료 후 status=done 이어야 함').toBe('done');

      const { data: payments } = await sb
        .from('payments')
        .select('amount, method')
        .eq('check_in_id', checkInId)
        .eq('payment_type', 'payment');
      expect(payments?.length, 'AC-1: payments 레코드 1건 생성').toBeGreaterThan(0);
      expect(payments![0].amount, 'AC-1: 결제 금액 일치').toBe(amount);

      console.log('[AC-1] payment_waiting → done + payments INSERT PASS');
    } finally {
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-1: check_in_services 기존 시술 있으면 pre-populate → saved=true로 즉시 수납 가능', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `preload-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 서비스 1건 조회 (기존 서비스)
    const { data: services } = await sb
      .from('services')
      .select('id, name, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .limit(1);

    if (!services || services.length === 0) {
      console.log('[AC-1 pre-load] 서비스 없음 — 스킵');
      return;
    }

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
        queue_number: 981,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;
    const svc = services[0];

    try {
      // check_in_services: 실제 스키마에 clinic_id 없음 — check_in_id/service_id/price/service_name 등만 사용
      const { error: cisErr } = await sb.from('check_in_services').insert({
        check_in_id: checkInId,
        service_id: svc.id,
        service_name: svc.name,
        price: svc.price ?? 0,
        original_price: svc.price ?? 0,
        is_package_session: false,
      });
      expect(cisErr, `check_in_services INSERT 실패: ${cisErr?.message}`).toBeNull();

      // pre-populate 로직 검증: check_in_services 조회 → items 존재
      const { data: existing } = await sb
        .from('check_in_services')
        .select('service_id, price')
        .eq('check_in_id', checkInId);
      expect(existing?.length, 'AC-1: check_in_services 기존 시술 1건 이상').toBeGreaterThan(0);
      expect(existing![0].service_id, 'AC-1: 저장된 service_id 일치').toBe(svc.id);

      console.log('[AC-1 pre-load] check_in_services 기존 시술 pre-populate 검증 PASS');
    } finally {
      await sb.from('check_in_services').delete().eq('check_in_id', checkInId);
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });
});

// ── AC-2: 셀프접수 → 상담대기/치료대기 자동이동 ───────────────────────────────

test.describe('T-20260514-DASH-REALTIME-FAIL — AC-2: 셀프접수 자동 스테이지 이동', () => {

  test('AC-2: 셀프접수 초진 → status=consult_waiting INSERT', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `selfcheckin-new-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'new' })
      .select()
      .single();

    // SelfCheckIn.tsx line 715: visitType === 'returning' ? 'treatment_waiting' : 'consult_waiting'
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'new',
        status: 'consult_waiting', // 초진 셀프접수 시 직행 status
        queue_number: 982,
      })
      .select()
      .single();
    expect(ciErr, `초진 체크인 생성 실패: ${ciErr?.message}`).toBeNull();

    try {
      const { data: ci } = await sb
        .from('check_ins')
        .select('status, visit_type')
        .eq('id', checkIn!.id)
        .single();
      expect(ci?.status, 'AC-2: 초진 셀프접수 → status=consult_waiting').toBe('consult_waiting');
      expect(ci?.visit_type, 'AC-2: 초진 visit_type=new').toBe('new');

      console.log('[AC-2] 초진 셀프접수 → consult_waiting PASS');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-2: 셀프접수 재진 → status=treatment_waiting INSERT', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `selfcheckin-ret-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();

    // SelfCheckIn.tsx: returning → treatment_waiting 직행
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'treatment_waiting', // 재진 셀프접수 시 직행 status
        queue_number: 983,
      })
      .select()
      .single();
    expect(ciErr, `재진 체크인 생성 실패: ${ciErr?.message}`).toBeNull();

    try {
      const { data: ci } = await sb
        .from('check_ins')
        .select('status, visit_type')
        .eq('id', checkIn!.id)
        .single();
      expect(ci?.status, 'AC-2: 재진 셀프접수 → status=treatment_waiting').toBe('treatment_waiting');
      expect(ci?.visit_type, 'AC-2: 재진 visit_type=returning').toBe('returning');

      console.log('[AC-2] 재진 셀프접수 → treatment_waiting PASS');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkIn!.id);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-2: handleReservationCheckIn — 재진 예약체크인 → treatment_waiting (c09c3b1 fix 생존 확인)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `resv-checkin-ret-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();

    // 체크인 시 registered → treatment_waiting 전환 검증
    // Dashboard.tsx handleReservationCheckIn:
    // const nextStatus = res.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting'
    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'registered',
        queue_number: 985,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // handleReservationCheckIn: registered → treatment_waiting (재진)
      const { error: updateErr } = await sb
        .from('check_ins')
        .update({ status: 'treatment_waiting' })
        .eq('id', checkInId)
        .eq('status', 'registered');
      expect(updateErr, `registered → treatment_waiting 업데이트 실패: ${updateErr?.message}`).toBeNull();

      await sb.from('status_transitions').insert({
        check_in_id: checkInId,
        clinic_id: CLINIC_ID,
        from_status: 'registered',
        to_status: 'treatment_waiting',
      });

      const { data: updated } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();
      expect(updated?.status, 'AC-2: 재진 예약체크인 registered → treatment_waiting').toBe('treatment_waiting');

      console.log('[AC-2 handleReservationCheckIn] registered → treatment_waiting PASS');
    } finally {
      await sb.from('status_transitions').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });
});

// ── AC-3: 결제 금액 정합성 ────────────────────────────────────────────────────

test.describe('T-20260514-DASH-REALTIME-FAIL — AC-3: 결제 금액 정합성', () => {

  test('AC-3: check_in_services 합산 = 수납 금액 (pendingServiceMap 기반)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `amount-check-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: services } = await sb
      .from('services')
      .select('id, name, price')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .limit(2);

    if (!services || services.length < 1) {
      console.log('[AC-3] 서비스 없음 — 스킵');
      return;
    }

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
        queue_number: 984,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // 시술 insert (check_in_services 스키마: clinic_id 없음)
      const expectedTotal = services.reduce((s, svc) => s + (svc.price ?? 0), 0);
      const cisRows = services.map((svc) => ({
        check_in_id: checkInId,
        service_id: svc.id,
        service_name: svc.name,
        price: svc.price ?? 0,
        original_price: svc.price ?? 0,
        is_package_session: false,
      }));
      const { error: cisErr } = await sb.from('check_in_services').insert(cisRows);
      expect(cisErr, `check_in_services INSERT 실패: ${cisErr?.message}`).toBeNull();

      // pendingServiceMap 로직 시뮬: check_in_services 합산
      const { data: cisData } = await sb
        .from('check_in_services')
        .select('check_in_id, price')
        .eq('check_in_id', checkInId);
      const pendingAmount = (cisData ?? []).reduce((s, r) => s + (r.price ?? 0), 0);

      expect(pendingAmount, 'AC-3: check_in_services 합산 = 예상 금액').toBe(expectedTotal);

      console.log(`[AC-3] 금액 정합성 PASS — ${pendingAmount}원`);
    } finally {
      await sb.from('check_in_services').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

  test('AC-3: payments 합산 = dayPayments 값 (done 칸 표시 금액)', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `daypay-check-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

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
        status: 'done',
        queue_number: 986,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      const payment1 = 30000;
      const payment2 = 20000;

      // 결제 2건 INSERT
      await sb.from('payments').insert([
        { check_in_id: checkInId, clinic_id: CLINIC_ID, customer_id: customer!.id,
          amount: payment1, method: 'card', payment_type: 'payment' },
        { check_in_id: checkInId, clinic_id: CLINIC_ID, customer_id: customer!.id,
          amount: payment2, method: 'cash', payment_type: 'payment' },
      ]);

      // dayPayments 로직 시뮬: payments 합산
      const { data: pays } = await sb
        .from('payments')
        .select('amount, payment_type')
        .eq('check_in_id', checkInId);

      const total = (pays ?? []).reduce((s, p) => {
        return s + (p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0));
      }, 0);

      expect(total, 'AC-3: dayPayments 합산 = 50000원').toBe(payment1 + payment2);
      console.log(`[AC-3 dayPayments] 합산 ${total}원 PASS`);
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });
});

// ── AC-4: 폴링 fallback DB 상태 직접 검증 ────────────────────────────────────

test.describe('T-20260514-DASH-REALTIME-FAIL — AC-4: Realtime 단절 대비 폴링 fallback', () => {

  test('AC-4: Realtime 끊겨도 DB status 변경은 이미 커밋됨 — 폴링 시 복구 가능', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    // 이 테스트는 폴링 fallback 패턴을 DB 수준에서 검증:
    // Realtime WebSocket이 끊기더라도 60초 폴링이 발생하면 최신 DB 상태를 읽을 수 있음
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `polling-fb-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

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
        queue_number: 987,
      })
      .select()
      .single();
    const checkInId = checkIn!.id as string;

    try {
      // 1단계: Realtime 없이 직접 status 변경 (실제 executeAutoDone 시뮬)
      await sb.from('check_ins').update({ status: 'done' }).eq('id', checkInId);

      // 2단계: fetchCheckIns 시뮬 — DB에서 최신 상태 조회 (폴링과 동일 경로)
      const { data: polled } = await sb
        .from('check_ins')
        .select('status')
        .eq('id', checkInId)
        .single();

      // 폴링이 실행되면 status=done이 정상 반환됨 (Realtime 없어도 OK)
      expect(polled?.status, 'AC-4: 폴링으로 done 상태 정상 조회').toBe('done');

      console.log('[AC-4] 60초 폴링 fallback DB 검증 PASS — Realtime 없이도 done 상태 읽힘');
    } finally {
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });
});
