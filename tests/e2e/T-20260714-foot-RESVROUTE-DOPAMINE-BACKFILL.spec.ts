/**
 * E2E spec — T-20260714-foot-RESVROUTE-DOPAMINE-BACKFILL
 * TM/도파민 '최초접점' 고객의 과거 customers.visit_route NULL 소급 backfill.
 *   forward 시딩 EF(부모 T-…-DOPAMINE-SEED, b128c2ee 라이브)는 신규 도파민 유입분부터만 seed →
 *   그 이전 생성된 도파민 최초접점 고객은 여전히 NULL → 2번차트 방문경로 공란 잔존.
 *   본 backfill 이 그 잔존분만 소급 fill(no-clobber IS NULL 가드).
 *
 * DA GO: CONSULT-REPLY MSG-b3ns Q3 — DESTRUCTIVE-class DML·LOW severity·no-clobber 레인.
 * SOP: Cross-CRM Data-Correction 백필 SOP v1.4 (§0 mutable·§2 지문교집합·§3 안전4종).
 *
 * ── 대상셋 지문 (backfill.sql STEP 1 freeze 로직 미러) ──
 *   visit_route IS NULL
 *   ∩ 고객의 '생성(최초)' 예약.source_system = 'dopamine'
 *   ∩ 최초예약.visit_route ∈ enum4
 *   ∩ 최초예약.created_at ≤ 소스닫힘시각
 *
 * AC / 가드:
 *   시나리오1  과거 dopamine '최초접점' & visit_route NULL → backfill 후 'TM' 소급 표시.
 *   시나리오2  오가닉 최초접점(+이후 dopamine 예약) → 미오염(TM 오라벨 금지 · ticket #2 오분류 방지).
 *   시나리오3  스태프 수동값(비-NULL) → 미접촉(no-clobber · G0).
 *   G1        visit_route 단일 컬럼 — lead_source/customer_memo 미접촉.
 *
 * 검증 방식: 백필의 net DB 효과 = (freeze 지문에 해당하는 customer 의 visit_route NULL→최초 dopamine
 *   예약의 route) 를 결정적으로 재현. 실 백필 SQL(STEP 3)의 freeze-JOIN + IS NULL 가드와 동일 net-effect.
 *   ★ 실제 PROD 백필은 field-soak confirm(2026-07-15 15:04) + supervisor DML-diff 게이트 이후.
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

const TAG = 'E2E-RESVROUTE-DOPA-BACKFILL';
const VISIT_ROUTE_ENUM = ['TM', '워크인', '인바운드', '지인소개'];
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

/**
 * 백필 net-effect 재현기 — backfill.sql STEP 1(freeze) + STEP 3(UPDATE) 미러.
 *   한 customer 에 대해: '최초(생성)' 예약의 source_system='dopamine' & route∈enum & visit_route IS NULL 이면
 *   그 최초 dopamine 예약의 route 로 fill. 그 외(오가닉 최초접점·non-NULL)는 미접촉.
 * @returns 착지된 값(또는 미변경 시 기존값)
 */
async function applyBackfillNetEffect(customerId: string): Promise<string | null> {
  // 현재 visit_route (no-clobber 판정)
  const { data: cur } = await sb!
    .from('customers')
    .select('visit_route')
    .eq('id', customerId)
    .single();
  const curRoute = (cur as { visit_route: string | null }).visit_route;
  if (curRoute !== null) return curRoute; // G0 no-clobber: 비-NULL 미접촉

  // 고객의 '생성(최초)' 예약 (created_at ASC, id ASC tiebreak)
  const { data: rsvs } = await sb!
    .from('reservations')
    .select('source_system, visit_route, created_at, id')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1);
  const first = (rsvs ?? [])[0] as
    | { source_system: string | null; visit_route: string | null }
    | undefined;
  if (!first) return null;

  // 지문: 최초접점 dopamine + route enum 검증
  const eligible =
    first.source_system === 'dopamine' &&
    typeof first.visit_route === 'string' &&
    VISIT_ROUTE_ENUM.includes(first.visit_route);
  if (!eligible) return null; // 오가닉 최초접점 등 → 미오염

  await sb!
    .from('customers')
    .update({ visit_route: first.visit_route })
    .eq('id', customerId)
    .is('visit_route', null); // 멱등·no-clobber 가드 (STEP 3 미러)
  return first.visit_route as string;
}

test.describe('T-20260714 DOPAMINE-BACKFILL — visit_route historical 소급 (no-clobber, DDL 0)', () => {
  test('시나리오1: 과거 dopamine 최초접점 & visit_route NULL → backfill 후 TM 소급', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    // 배포前 상태: 고객 visit_route NULL (forward EF 이전 생성분 재현)
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new' })
      .select('id, visit_route')
      .single();
    const cid = (c as { id: string }).id;
    expect((c as { visit_route: string | null }).visit_route, '전제: NULL').toBeNull();
    // 최초(생성) 예약 = dopamine, visit_route='TM'
    await sb!.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: cid,
      source_system: 'dopamine',
      visit_route: 'TM',
      visit_type: 'new',
      reservation_date: '2026-07-01',
    });
    const landed = await applyBackfillNetEffect(cid);
    expect(landed, '과거 TM 최초접점 소급').toBe('TM');
    const { data } = await sb!.from('customers').select('visit_route').eq('id', cid).single();
    expect((data as { visit_route: string }).visit_route).toBe('TM');
    console.log('[시나리오1] 과거 dopamine 최초접점 NULL → TM 소급 PASS');
  });

  test('시나리오2: 오가닉 최초접점 + 이후 dopamine 예약 → 미오염(TM 오라벨 금지)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new' })
      .select('id, visit_route')
      .single();
    const cid = (c as { id: string }).id;
    // 최초(생성) 예약 = 오가닉(워크인, source_system NULL), 그 다음 dopamine 예약 존재
    await sb!.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: cid,
      source_system: null, // 오가닉 최초접점
      visit_route: '워크인',
      visit_type: 'new',
      reservation_date: '2026-06-20',
    });
    await sb!.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: cid,
      source_system: 'dopamine', // 이후 dopamine 재예약 (있어도 최초접점 아님)
      visit_route: 'TM',
      visit_type: 'returning',
      reservation_date: '2026-07-05',
    });
    const landed = await applyBackfillNetEffect(cid);
    expect(landed, 'ticket #2 오분류 방지: 오가닉 최초접점은 TM 오라벨 금지').not.toBe('TM');
    const { data } = await sb!.from('customers').select('visit_route').eq('id', cid).single();
    // 최초접점 dopamine 아님 → backfill 대상 아님 → NULL 유지(2번차트 공란, 현장 수동 판단 몫)
    expect((data as { visit_route: string | null }).visit_route, '미대상 → NULL 유지').toBeNull();
    console.log('[시나리오2] 오가닉 최초접점 미오염 PASS');
  });

  test('시나리오3: 스태프 수동 visit_route(지인소개) → backfill 미접촉(no-clobber)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: '지인소개' })
      .select('id, visit_route')
      .single();
    const cid = (c as { id: string }).id;
    // 최초 예약이 dopamine 이더라도 — 수동값 비-NULL 이면 no-clobber
    await sb!.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: cid,
      source_system: 'dopamine',
      visit_route: 'TM',
      visit_type: 'new',
      reservation_date: '2026-07-02',
    });
    const landed = await applyBackfillNetEffect(cid);
    expect(landed, 'no-clobber: 수동값 보존').toBe('지인소개');
    const { data } = await sb!.from('customers').select('visit_route').eq('id', cid).single();
    expect((data as { visit_route: string }).visit_route, 'G0 no-clobber 위반: 수동값 덮어씀').toBe('지인소개');
    console.log('[시나리오3] 스태프 수동값(지인소개) 보존 PASS');
  });

  test('G1: backfill 은 visit_route 단일 컬럼 — lead_source/customer_memo 미접촉', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({
        clinic_id: clinicId,
        name: TAG,
        phone: phone(),
        visit_type: 'new',
        lead_source: '네이버',
        customer_memo: 'PRESERVE-ME',
      })
      .select('id')
      .single();
    const cid = (c as { id: string }).id;
    await sb!.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: cid,
      source_system: 'dopamine',
      visit_route: 'TM',
      visit_type: 'new',
      reservation_date: '2026-07-03',
    });
    await applyBackfillNetEffect(cid);
    const { data } = await sb!
      .from('customers')
      .select('visit_route, lead_source, customer_memo')
      .eq('id', cid)
      .single();
    const row = data as { visit_route: string; lead_source: string | null; customer_memo: string | null };
    expect(row.visit_route).toBe('TM');
    expect(row.lead_source, 'G1 위반: lead_source 오염').toBe('네이버');
    expect(row.customer_memo, 'G1 위반: customer_memo 오염').toBe('PRESERVE-ME');
    console.log('[G1] visit_route 단일컬럼 — 타 컬럼 미접촉 PASS');
  });
});
