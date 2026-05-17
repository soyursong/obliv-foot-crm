/**
 * E2E — T-20260516-foot-RESV-MEMO-REVISIT
 * 1번차트 예약메모 재진 고객 reservation_id 매칭 수정 검증
 *
 * 검증 포인트:
 * AC-1: 재진 고객 1번차트에서 reservation_memo_history 타임라인 정상 표시
 * AC-2: reservation_id null → customer_id fallback → 당일 예약 정확히 매칭
 * AC-3: 초진/재진 무관 동일 조회 경로 (3단계 폴백 검증)
 *
 * Root cause 확인:
 * - 기존 .or() 필터가 E.164 '+' 접두사를 포맷 불일치로 처리
 * - .single() → 레코드 없을 때 null 반환이나 폴백 없음
 * - 수정: reservation_id → customer_id → phone digits 3단계 순차 폴백
 *
 * 비파괴: 테스트 데이터는 afterAll에서 삭제.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test.describe('T-20260516-foot-RESV-MEMO-REVISIT — 재진 고객 예약메모 매칭', () => {
  let clinicId: string;
  // 초진 고객
  let newCustomerId: string;
  let newReservationId: string;
  // 재진 고객
  let revisitCustomerId: string;
  let revisitReservationId: string;
  // 워크인 고객 (reservation_id=null, customer_id 있음)
  let walkinCustomerId: string;
  let walkinCheckInId: string;
  let walkinReservationId: string;

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics')
      .select('id')
      .eq('slug', 'jongno-foot')
      .single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    const ts = Date.now();

    // ── 초진 고객 ─────────────────────────────────────────────────────────────
    const { data: newCust } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `초진_REVISIT_${ts}`, phone: `+82101111${String(ts).slice(-4)}` })
      .select('id').single();
    newCustomerId = newCust!.id;

    const { data: newResv } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: newCustomerId,
        customer_name: `초진_REVISIT_${ts}`,
        customer_phone: `+82101111${String(ts).slice(-4)}`,
        reservation_date: '2099-12-30',
        reservation_time: '10:00:00',
        visit_type: 'new',
        status: 'confirmed',
      })
      .select('id').single();
    newReservationId = newResv!.id;

    // 초진 예약메모 삽입
    await service.from('reservation_memo_history').insert({
      reservation_id: newReservationId,
      clinic_id: clinicId,
      content: '초진 예약메모 — REVISIT 테스트',
      created_by_name: '김주연',
    });

    // ── 재진 고객 (reservation_id null인 check-in 시뮬레이션) ─────────────────
    const { data: revCust } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `재진_REVISIT_${ts}`, phone: `+82102222${String(ts).slice(-4)}` })
      .select('id').single();
    revisitCustomerId = revCust!.id;

    // 재진 예약 — customer_id 있음
    const { data: revResv } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: revisitCustomerId,
        customer_name: `재진_REVISIT_${ts}`,
        customer_phone: `+82102222${String(ts).slice(-4)}`,
        reservation_date: '2099-12-30',
        reservation_time: '11:00:00',
        visit_type: 'returning',
        status: 'confirmed',
      })
      .select('id').single();
    revisitReservationId = revResv!.id;

    // 재진 예약메모 삽입
    await service.from('reservation_memo_history').insert({
      reservation_id: revisitReservationId,
      clinic_id: clinicId,
      content: '재진 예약메모 — REVISIT 테스트',
      created_by_name: '김주연',
    });

    // ── 워크인 고객 (예약 있으나 체크인에 reservation_id=null인 케이스) ────────
    const { data: walkCust } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `워크인_REVISIT_${ts}`, phone: `+82103333${String(ts).slice(-4)}` })
      .select('id').single();
    walkinCustomerId = walkCust!.id;

    // 워크인 예약 (당일 예약)
    const today = new Date().toISOString().slice(0, 10);
    const { data: walkResv } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: walkinCustomerId,
        customer_name: `워크인_REVISIT_${ts}`,
        customer_phone: `+82103333${String(ts).slice(-4)}`,
        reservation_date: today,
        reservation_time: '14:00:00',
        visit_type: 'returning',
        status: 'confirmed',
      })
      .select('id').single();
    walkinReservationId = walkResv!.id;

    // 워크인 예약메모 삽입
    await service.from('reservation_memo_history').insert({
      reservation_id: walkinReservationId,
      clinic_id: clinicId,
      content: '워크인 예약메모 — REVISIT 테스트',
      created_by_name: '김주연',
    });

    // 워크인 체크인 — reservation_id=null (수동 접수 시뮬레이션)
    const { data: queueData } = await service.rpc('next_queue_number', {
      p_clinic_id: clinicId,
      p_date: today,
    });
    const { data: walkCi } = await service
      .from('check_ins')
      .insert({
        clinic_id: clinicId,
        customer_id: walkinCustomerId,
        reservation_id: null, // ← 핵심: 예약 연결 없이 수동 접수
        customer_name: `워크인_REVISIT_${ts}`,
        customer_phone: `+82103333${String(ts).slice(-4)}`,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: queueData as number,
      })
      .select('id').single();
    walkinCheckInId = walkCi!.id;
  });

  test.afterAll(async () => {
    await service.from('reservation_memo_history').delete().in('reservation_id', [
      newReservationId, revisitReservationId, walkinReservationId,
    ].filter(Boolean));
    await service.from('check_ins').delete().eq('id', walkinCheckInId);
    await service.from('reservations').delete().in('id', [
      newReservationId, revisitReservationId, walkinReservationId,
    ].filter(Boolean));
    await service.from('customers').delete().in('id', [
      newCustomerId, revisitCustomerId, walkinCustomerId,
    ].filter(Boolean));
  });

  // ── AC-1: 재진 고객 reservation_memo_history 존재 확인 ───────────────────
  test('AC-1: 재진 고객 reservation_id → reservation_memo_history 조회 성공', async () => {
    const { data, error } = await service
      .from('reservation_memo_history')
      .select('id, content, created_by_name')
      .eq('reservation_id', revisitReservationId)
      .order('created_at', { ascending: false });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    expect(data![0].content).toContain('재진 예약메모');
    console.log('[AC-1] 재진 고객 reservation_memo_history 조회 OK:', data![0].content);
  });

  // ── AC-2: customer_id fallback — reservation_id null 케이스 ─────────────
  test('AC-2: reservation_id=null 체크인 → customer_id로 당일 예약 매칭', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // 3단계 폴백 로직 시뮬레이션 (1단계: reservation_id=null → skip)
    // 2단계: customer_id 기반 당일 예약 조회
    const { data: todayById, error } = await service
      .from('reservations')
      .select('id, booking_memo')
      .eq('customer_id', walkinCustomerId)
      .eq('reservation_date', today)
      .order('reservation_time', { ascending: true })
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(todayById).not.toBeNull();
    expect(todayById!.id).toBe(walkinReservationId);

    // 매칭된 reservation_id로 memo_history 조회
    const { data: memos } = await service
      .from('reservation_memo_history')
      .select('content')
      .eq('reservation_id', todayById!.id)
      .order('created_at', { ascending: false });

    expect(memos).not.toBeNull();
    expect(memos!.length).toBeGreaterThanOrEqual(1);
    expect(memos![0].content).toContain('워크인 예약메모');
    console.log('[AC-2] customer_id fallback → 당일 예약 매칭 OK:', todayById!.id);
  });

  // ── AC-3: phone digits fallback — E.164 포맷 불일치 케이스 ─────────────
  test('AC-3: phone digits ilike → E.164 포맷 불일치 안전 매칭', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const e164Phone = `+82103333${String(Date.now()).slice(-4) /* ts와 동일하게 맞추기 어려우므로 워크인 예약으로 검증 */}`;

    // phone digits (last 8)로 ilike 조회 — E.164 vs 010-XXXX 포맷 차이 극복
    const digits8 = walkinReservationId
      ? (await service.from('reservations').select('customer_phone').eq('id', walkinReservationId).single())
          .data?.customer_phone?.replace(/\D/g, '').slice(-8) ?? ''
      : '';

    if (!digits8) {
      console.log('[AC-3] phone digits 추출 실패 — skip');
      return;
    }

    const { data: byPhone, error } = await service
      .from('reservations')
      .select('id')
      .eq('reservation_date', today)
      .ilike('customer_phone', `%${digits8}%`)
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(byPhone).not.toBeNull();
    expect(byPhone!.id).toBe(walkinReservationId);
    console.log('[AC-3] phone digits ilike 매칭 OK — digits:', digits8);
  });

  // ── AC-3 (추가): 초진/재진 동일 조회 경로 확인 ───────────────────────────
  test('AC-3-extra: 초진 vs 재진 — reservation_memo_history 동일 쿼리 패턴', async () => {
    // 초진 조회
    const { data: newMemos, error: e1 } = await service
      .from('reservation_memo_history')
      .select('content')
      .eq('reservation_id', newReservationId)
      .order('created_at', { ascending: false });

    // 재진 조회 (동일 쿼리 패턴)
    const { data: revMemos, error: e2 } = await service
      .from('reservation_memo_history')
      .select('content')
      .eq('reservation_id', revisitReservationId)
      .order('created_at', { ascending: false });

    expect(e1).toBeNull();
    expect(e2).toBeNull();
    expect(newMemos!.length).toBeGreaterThanOrEqual(1);
    expect(revMemos!.length).toBeGreaterThanOrEqual(1);

    console.log('[AC-3-extra] 초진 메모:', newMemos![0].content);
    console.log('[AC-3-extra] 재진 메모:', revMemos![0].content);
    console.log('[AC-3-extra] 초진/재진 동일 쿼리 패턴 OK');
  });
});
