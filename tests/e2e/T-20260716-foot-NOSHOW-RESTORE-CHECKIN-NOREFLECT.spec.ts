/**
 * E2E/DB spec — T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT
 * 노쇼→예약복원→체크인 동선에서 예약관리 상태값 미반영 버그 (예약↔체크인 divergence)
 *
 * RC: fn_checkin_sync_reservation()(AFTER INSERT on check_ins, SECURITY DEFINER) 이
 *   `WHERE status = 'confirmed'` 정확일치로만 sync → BEFORE 가드(check_reservation_status)가
 *   허용하는 'reserved'(및 노쇼↔복원 race)에서는 check_in 생성됐는데 reservations.status 미동기화.
 *   대시보드(check_ins 조회)는 반영, 예약관리(reservations.status 유일 소스)만 미반영.
 * Fix: sync WHERE 를 pre-checkin 전진대상 allowlist `status IN ('reserved','confirmed')` 로 확장
 *   (DA CONSULT-REPLY 정정 채택 — denylist 는 no_show/미래 enum 자동전이 위험으로 반려).
 *
 * AC1: 체크인 생성 시 예약이 checked_in 으로 착지 (버튼 정상 동작 = 상태 전환 실행).
 * AC2: reservations.status 즉시 반영 (예약관리 목록 소스 동기화).
 * AC3: 기존 정상 동선(confirmed→checked_in)에 영향 없음 (회귀 방지) + 멱등.
 *
 * ⚠️ 마이그레이션 20260716120000_foot_checkin_sync_reservation_broaden.sql 적용된 DB 에서만 PASS.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function sb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

const created: { table: string; id: string }[] = [];

async function seedReservation(status: string) {
  const client = sb();
  const phone = `010${String(Date.now()).slice(-8)}`;
  const { data, error } = await client
    .from('reservations')
    .insert({
      clinic_id: CLINIC_ID,
      customer_name: `noshow-sync-test-${Date.now()}`,
      customer_phone: phone,
      reservation_date: '2026-07-16',
      reservation_time: '10:00:00',
      status,
      visit_type: 'new',
    })
    .select('id')
    .single();
  if (error) throw new Error(`예약 seed 실패(${status}): ${error.message}`);
  created.push({ table: 'reservations', id: data!.id });
  return data!.id as string;
}

async function insertCheckIn(reservationId: string) {
  const client = sb();
  const { data, error } = await client
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      reservation_id: reservationId,
      customer_name: 'noshow-sync-test',
      visit_type: 'new',
      status: 'receiving',
      queue_number: Math.floor(Date.now() % 1_000_000),
    })
    .select('id')
    .single();
  if (!error && data) created.push({ table: 'check_ins', id: data.id });
  return { id: data?.id as string | undefined, error };
}

async function resvStatus(id: string) {
  const { data } = await sb().from('reservations').select('status').eq('id', id).single();
  return data?.status as string;
}

test.afterAll(async () => {
  const client = sb();
  for (const row of created.reverse()) {
    await client.from(row.table).delete().eq('id', row.id);
  }
});

test('AC1/AC2 — reserved 예약도 체크인 생성 시 checked_in 으로 sync (버그 재현→수정)', async () => {
  // BEFORE 가드는 통과하지만 구 sync 는 미동기화하던 상태('reserved')
  const rid = await seedReservation('reserved');
  const { error } = await insertCheckIn(rid);
  expect(error, `체크인 생성은 허용되어야 함(BEFORE 가드 no_show/cancelled 만 차단): ${error?.message}`).toBeNull();
  expect(await resvStatus(rid), '체크인 생성 후 예약이 checked_in 으로 동기화되어야 함(예약관리 반영)').toBe('checked_in');
});

test('AC3 회귀 — confirmed→checked_in 정상 동선 유지', async () => {
  const rid = await seedReservation('confirmed');
  const { error } = await insertCheckIn(rid);
  expect(error).toBeNull();
  expect(await resvStatus(rid)).toBe('checked_in');
});

test('AC3 멱등 — 이미 checked_in 예약은 유지(no-op)', async () => {
  const rid = await seedReservation('confirmed');
  await insertCheckIn(rid);
  expect(await resvStatus(rid)).toBe('checked_in');
  // 상태 유지 확인(추가 sync 가 checked_in 을 덮어쓰지 않음)
  await sb().from('reservations').update({ status: 'checked_in' }).eq('id', rid);
  expect(await resvStatus(rid)).toBe('checked_in');
});

test('가드 — no_show 예약은 체크인 생성 차단(BEFORE 가드), 상태 불변', async () => {
  const rid = await seedReservation('no_show');
  const { error } = await insertCheckIn(rid);
  expect(error, 'no_show 예약은 체크인 생성이 거부되어야 함').not.toBeNull();
  expect(await resvStatus(rid)).toBe('no_show');
});
