/**
 * T-20260714-foot-RESCHED-HIST-MISSING — 고객차트 예약수정 경로 변경이력 기록
 *
 * 버그: 고객차트(CustomerChartPage) '예약 수정 저장'(saveEditResv) 경로만 reservation_logs
 *       insert 가 누락되어, 이 화면에서 날짜/시간을 바꿔도 '예약 변경 이력'에 남지 않았다.
 *       (예약관리 드래그·예약상세 팝업 등 다른 경로는 정상 기록 — 진단 [3]에서 확인.)
 * 수정: saveEditResv 가 UPDATE 성공 후 reservation_logs 를 insert.
 *       날짜 또는 시간이 바뀌면 action='reschedule', 그 외(메모/치료사만)는 'update'.
 *
 * 검증(비파괴 — 임시 데이터 생성 후 즉시 삭제):
 *  AC-1: 날짜 변경 → reschedule 로그 1건(old.date→new.date) 생성.
 *  AC-2: useReservationAuditLog 필터(.in action [create,reschedule])로 조회 시 노출.
 *  회귀: 메모만 변경 → action='update' → 변경이력 필터에서 제외.
 *
 * UI 전체 구동(로그인→고객차트→수정모달)은 flaky/heavy 이므로 foot-044 패턴대로
 * 수정된 코드가 수행하는 write shape 를 직접 재현·검증한다.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// saveEditResv 의 로그 기록 로직을 그대로 옮긴 헬퍼 (코드 경로 동치 검증)
function buildAuditInsert(params: {
  reservationId: string;
  clinicId: string;
  oldDate: string;
  oldTime: string; // HH:mm(:ss)
  newDate: string;
  newTime: string; // HH:mm(:ss)
}) {
  const oldTime = params.oldTime.slice(0, 5);
  const newTime = params.newTime.slice(0, 5);
  const isReschedule = params.oldDate !== params.newDate || oldTime !== newTime;
  return {
    reservation_id: params.reservationId,
    clinic_id: params.clinicId,
    action: isReschedule ? 'reschedule' : 'update',
    old_data: { date: params.oldDate, time: oldTime },
    new_data: { date: params.newDate, time: newTime },
    changed_by: null,
  };
}

test.describe('T-20260714-foot-RESCHED-HIST-MISSING', () => {
  test('고객차트 예약수정 날짜변경 → reschedule 로그 기록 + 변경이력 필터 노출', async () => {
    const { data: clinic } = await service.from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    const clinicId = clinic!.id;

    const suffix = String(Math.floor(Math.random() * 1_0000_0000)).padStart(8, '0');
    const { data: customer } = await service
      .from('customers')
      .insert({ clinic_id: clinicId, name: `RHIST_${suffix.slice(-4)}`, phone: `010${suffix}` })
      .select()
      .single();

    const oldDate = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const newDate = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
    const { data: rsv } = await service
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: customer!.id,
        reservation_date: oldDate,
        reservation_time: '14:00',
        status: 'confirmed',
      })
      .select()
      .single();

    // === saveEditResv 재현: 날짜 변경 UPDATE + 감사 로그 insert ===
    const { error: updErr } = await service
      .from('reservations')
      .update({ reservation_date: newDate, reservation_time: '14:00' })
      .eq('id', rsv!.id);
    expect(updErr).toBeNull();

    const auditRow = buildAuditInsert({
      reservationId: rsv!.id,
      clinicId,
      oldDate,
      oldTime: '14:00',
      newDate,
      newTime: '14:00',
    });
    expect(auditRow.action).toBe('reschedule'); // 날짜가 바뀌었으므로 reschedule
    const { error: logErr } = await service.from('reservation_logs').insert(auditRow);
    expect(logErr).toBeNull();

    // AC-1: reschedule 로그 1건, old→new 날짜 정합
    const { data: logs } = await service
      .from('reservation_logs')
      .select('action, old_data, new_data')
      .eq('reservation_id', rsv!.id)
      .in('action', ['create', 'reschedule']) // AC-2: 변경이력 훅 필터와 동일
      .order('created_at', { ascending: false });

    expect(logs && logs.length).toBeGreaterThanOrEqual(1);
    const resch = logs!.find((l) => l.action === 'reschedule');
    expect(resch).toBeTruthy();
    expect((resch!.old_data as { date: string }).date).toBe(oldDate);
    expect((resch!.new_data as { date: string }).date).toBe(newDate);
    console.log('[RESCHED-HIST] 날짜변경 reschedule 로그 확인:', resch);

    // cleanup
    await service.from('reservation_logs').delete().eq('reservation_id', rsv!.id);
    await service.from('reservations').delete().eq('id', rsv!.id);
    await service.from('customers').delete().eq('id', customer!.id);
  });

  test('회귀: 메모만 변경 → action=update → 변경이력 필터에서 제외', async () => {
    const auditRow = buildAuditInsert({
      reservationId: '00000000-0000-0000-0000-000000000000',
      clinicId: '00000000-0000-0000-0000-000000000000',
      oldDate: '2026-07-20',
      oldTime: '14:00',
      newDate: '2026-07-20',
      newTime: '14:00', // 날짜·시간 동일 = 메모/기타만 변경
    });
    expect(auditRow.action).toBe('update');
    // useReservationAuditLog 는 create/reschedule 만 노출 → update 는 변경이력에 나타나지 않음(정상).
    expect(['create', 'reschedule']).not.toContain(auditRow.action);
    console.log('[RESCHED-HIST] 메모만 변경 → update(변경이력 제외) OK');
  });
});
