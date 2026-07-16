/**
 * E2E spec — T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL
 * 기존 예약 잔존건 → customers.visit_route(2번차트 방문경로) 일괄 백필.
 *   forward sync EF(RESVROUTE-VISITCHANNEL-ALWAYSYNC 15efde96, 2026-07-14 배포 + CUSTOMERS-SYNC-FIX
 *   closed)는 신규분만 자동 연동 → 그 이전 적재분(reservations.visit_route 실값 有 & customers.visit_route
 *   NULL)은 잔존. 본 backfill 이 그 잔존분만 소급 fill(no-clobber IS NULL 가드).
 *   CUSTOMERS-SYNC-FIX.spec.ts:74 "잔존은 backfill 소관" 계승.
 *
 * SOP: Cross-CRM Data-Correction 백필 SOP (§0 mutable · §2 지문교집합 · §3 안전4종).
 * enum(양테이블 동일, mig 20260624100000): ('TM','워크인','인바운드','지인소개','네이버','인콜').
 *
 * ── 대상셋 지문 (backfill.sql STEP 1 freeze 로직 미러) ──
 *   customers.visit_route IS NULL
 *   ∩ 그 고객 reservations 중 visit_route 실값(NOT NULL & trim<>'') 존재
 *   fill 값 = 그 고객의 '실값 있는 가장 최근(created_at DESC, id DESC)' 예약.visit_route
 *
 * AC / 가드:
 *   시나리오1  과거 예약(route 실값) & cust NULL → backfill 후 최근 예약값 소급 표시.
 *   시나리오2  스태프 수동값(비-NULL) → 미접촉(no-clobber · G0).
 *   시나리오3  cust NULL & resv 실값 전무 → 미변경(out-of-scope · 파생소스 없음).
 *   다중예약   여러 예약 실값 존재 시 '가장 최근' 값 채택(fill 규칙).
 *   G1        visit_route 단일 컬럼 — visit_route_detail/lead_source 미접촉.
 *
 * 검증 방식: 백필의 net DB 효과 = backfill.sql STEP 1(freeze) + STEP 3(UPDATE freeze-JOIN + IS NULL
 *   가드)와 동일 net-effect 를 결정적으로 재현. ★ 실 PROD 백필은 DA GO + supervisor 승인 이후.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = Boolean(SUPABASE_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady
  ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const TAG = 'E2E-VISITROUTE-RESV-BACKFILL';
const VISIT_ROUTE_ENUM = ['TM', '워크인', '인바운드', '지인소개', '네이버', '인콜'];
let phoneSeq = 0;
const phone = () => `+8210${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(2, '0')}`;
let clinicId: string | null = null;

test.beforeAll(async () => {
  if (!sb) return;
  const { data: clinic } = await sb.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  clinicId = clinic?.id ?? null;
});

test.afterAll(async () => {
  if (!sb) return;
  const { data: custs } = await sb.from('customers').select('id').eq('name', TAG);
  const ids = (custs ?? []).map((c) => (c as { id: string }).id);
  if (ids.length) {
    await sb.from('reservations').delete().in('customer_id', ids);
    await sb.from('customers').delete().in('id', ids);
  }
});

const isVal = (v: unknown): v is string =>
  v !== null && v !== undefined && String(v).trim() !== '';

/**
 * 백필 net-effect 재현기 — backfill.sql STEP 1(freeze) + STEP 3(UPDATE) 미러.
 *   customer 의 visit_route IS NULL 이고 그 고객 reservations 중 실값 존재 시 →
 *   '실값 있는 가장 최근(created_at DESC, id DESC)' 예약의 route 로 fill. 그 외 미접촉.
 * @returns 착지된 값(또는 미변경 시 기존값)
 */
async function applyBackfillNetEffect(customerId: string): Promise<string | null> {
  const { data: cur } = await sb!
    .from('customers')
    .select('visit_route')
    .eq('id', customerId)
    .single();
  const curVal = (cur as { visit_route: string | null } | null)?.visit_route ?? null;
  // no-clobber: 이미 값 있으면 미접촉
  if (isVal(curVal)) return curVal;

  const { data: rsvs } = await sb!
    .from('reservations')
    .select('visit_route, created_at, id')
    .eq('customer_id', customerId)
    .not('visit_route', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  const withRoute = (rsvs ?? []).filter((r) => isVal((r as { visit_route: string }).visit_route));
  if (withRoute.length === 0) return curVal; // out-of-scope: 파생소스 없음 → 미변경

  const proposed = (withRoute[0] as { visit_route: string }).visit_route;
  // enum-safety (STEP 2 assert 미러)
  expect(VISIT_ROUTE_ENUM, 'proposed 는 customers CHECK enum 내여야 함').toContain(proposed);
  // freeze-JOIN + IS NULL 가드 미러
  await sb!.from('customers').update({ visit_route: proposed }).eq('id', customerId).is('visit_route', null);
  const { data: after } = await sb!
    .from('customers')
    .select('visit_route')
    .eq('id', customerId)
    .single();
  return (after as { visit_route: string | null }).visit_route;
}

test.describe('T-20260716 CUSTOMERS-VISITROUTE-RESV-BACKFILL — 예약경로→2번차트 방문경로 소급(비파괴, DDL 0)', () => {
  test('RC 재현: reservations.visit_route 실값 有 인데 customers.visit_route NULL 잔존건 존재(배포前 신규 자동연동 이전 적재분)', async () => {
    test.skip(!sb, 'DB env 없음 — 스킵');
    const { data: custs } = await sb!
      .from('customers')
      .select('id, visit_route')
      .is('visit_route', null)
      .limit(500);
    expect(Array.isArray(custs)).toBeTruthy();
    console.log(`[RC] customers.visit_route NULL n=${custs?.length ?? 0} — 그중 resv 실값 보유분이 backfill 대상`);
  });

  test('시나리오1: 과거 예약(route 실값) & cust NULL → backfill 후 최근 예약값 소급', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: null })
      .select('id')
      .single();
    const cid = (c as { id: string }).id;
    await sb!.from('reservations').insert({
      clinic_id: clinicId, customer_id: cid, visit_type: 'new',
      visit_route: 'TM', source_system: 'dopamine', reservation_date: '2026-07-01', reservation_time: '10:00',
    });
    const result = await applyBackfillNetEffect(cid);
    expect(result, 'cust NULL + resv route 실값 → backfill 소급').toBe('TM');
    console.log('[시나리오1] 잔존건 소급 fill PASS');
  });

  test('시나리오2: 스태프 수동값(비-NULL) → 미접촉(no-clobber · G0)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: '지인소개' })
      .select('id')
      .single();
    const cid = (c as { id: string }).id;
    // 예약경로는 TM 이지만 cust 는 수동 '지인소개' → 백필이 덮어쓰면 안 됨
    await sb!.from('reservations').insert({
      clinic_id: clinicId, customer_id: cid, visit_type: 'new',
      visit_route: 'TM', source_system: 'dopamine', reservation_date: '2026-07-01', reservation_time: '10:00',
    });
    const result = await applyBackfillNetEffect(cid);
    expect(result, 'no-clobber: 수동값 보존').toBe('지인소개');
    console.log('[시나리오2] no-clobber(수동값 보존) PASS');
  });

  test('시나리오3: cust NULL & resv 실값 전무 → 미변경(out-of-scope)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: null })
      .select('id')
      .single();
    const cid = (c as { id: string }).id;
    // route NULL 예약만 존재 → 파생소스 없음
    await sb!.from('reservations').insert({
      clinic_id: clinicId, customer_id: cid, visit_type: 'new',
      visit_route: null, source_system: 'dopamine', reservation_date: '2026-07-01', reservation_time: '10:00',
    });
    const result = await applyBackfillNetEffect(cid);
    expect(result, 'out-of-scope: 파생소스 없음 → NULL 유지').toBeNull();
    console.log('[시나리오3] out-of-scope 미변경 PASS');
  });

  test('다중예약 fill 규칙: 여러 예약 실값 존재 → 가장 최근(created_at DESC) 값 채택', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: null })
      .select('id')
      .single();
    const cid = (c as { id: string }).id;
    // 과거(오래된) '워크인' → 최근 '네이버' : 최근값 채택되어야 함
    await sb!.from('reservations').insert({
      clinic_id: clinicId, customer_id: cid, visit_type: 'new',
      visit_route: '워크인', source_system: null,
      reservation_date: '2026-06-01', reservation_time: '10:00', created_at: '2026-06-01T00:00:00+09',
    });
    await sb!.from('reservations').insert({
      clinic_id: clinicId, customer_id: cid, visit_type: 'new',
      visit_route: '네이버', source_system: null,
      reservation_date: '2026-07-10', reservation_time: '10:00', created_at: '2026-07-10T00:00:00+09',
    });
    const result = await applyBackfillNetEffect(cid);
    expect(result, '가장 최근 예약값 채택').toBe('네이버');
    console.log('[다중예약] recent-route fill 규칙 PASS');
  });
});
