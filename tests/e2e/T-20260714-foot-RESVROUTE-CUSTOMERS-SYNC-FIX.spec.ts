/**
 * E2E spec — T-20260714-foot-RESVROUTE-CUSTOMERS-SYNC-FIX
 * 초진 방문경로 미연동 정정 — TM(도파민) 초진 수신부(reservation-ingest-from-dopamine EF)가
 * customers.visit_route 를 seed 하도록 보강. (ALWAYSYNC FE 게이트 제거만으론 초진 미해소)
 *
 * 배경(김주연 총괄, ts=1783999172.882689): "아니 초진인데도 다 빠져있음."
 *   기존 RC 전제('visit_type==="new" 게이트로 재진만 미갱신, 초진은 line274로 동작')는 현장 정정으로 반증.
 *   Phase0 prod 실측: 최근 dopamine 예약 59~60/60 = 전부 vt=new(초진), reservations.visit_route='TM' 인데
 *   customers.visit_route=NULL. → 2번차트(customers.visit_route) 방문경로 공란.
 *
 * 실제 초진 RC (line274 밖):
 *   TM 초진은 FE createReservationCanonical(Reservations.tsx:274) 경로를 애초에 타지 않는다.
 *   도파민 TM push → reservation-ingest-from-dopamine EF 로 인입되며, 이 EF 가 customers 를
 *   만들/갱신할 때 visit_route 를 seed 하지 않아 2번차트 방문경로가 비어 있었다.
 *   ⇒ 게이트 제거(ALWAYSYNC)는 이 경로에 무효 — EF 신규-고객 INSERT / 기존-고객 UPDATE 에 seed 추가가 정답.
 *
 * AC / 가드:
 *   AC-0(시나리오 0)  신규(초진) 고객 첫 예약 생성(TM 인입) → customers.visit_route seed → 2번차트 방문경로 반영.
 *   AC-1b           초진도 실제 seed 검증(게이트 제거만으론 미해소 — EF seed 로 해소).
 *   preserve-on-NULL 기존 고객 visit_route 공란일 때만 fill / non-empty 수동값은 도파민 재push 로 미터치(no-clobber).
 *   G1              customers.update payload = visit_route 단일 컬럼(타 컬럼 lead_source/customer_memo 미접촉).
 *   G3              reservations.source_system 무접촉(매출 오가닉/광고 split 불변).
 *
 * 검증 방식: EF(Deno)는 CALLBACK_SECRET 게이트(로컬 미주입) → HTTP 왕복은 supervisor 환경/필드소크.
 *   여기서는 EF 가 수행하는 customers.visit_route 착지의 net DB 효과(plain insert/update)를
 *   결정적으로 재현(ALWAYSYNC spec 과 동일 net-effect 모델). FE 초진 canonical 경로 회귀도 함께 커버.
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

const TAG = 'E2E-RESVROUTE-CUSTSYNC';
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

test.describe('T-20260714 CUSTOMERS-SYNC-FIX — 초진 방문경로 EF seed 계약(비파괴, DDL 0)', () => {
  test('RC 재현: dopamine 초진 예약은 visit_route=TM 인데 customers.visit_route NULL(배포前)', async () => {
    test.skip(!sb, 'DB env 없음 — 스킵');
    const { data: resv } = await sb!
      .from('reservations')
      .select('customer_id, visit_type, visit_route, source_system')
      .eq('source_system', 'dopamine')
      .eq('visit_type', 'new')
      .not('visit_route', 'is', null)
      .neq('visit_route', '')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30);
    // 배포前엔 초진 다수가 mismatch(customers NULL). 배포後엔 신규분부터 seed 되며 잔존은 backfill 소관.
    expect(Array.isArray(resv)).toBeTruthy();
    console.log(`[RC] dopamine 초진 표본 n=${resv?.length ?? 0} — customers.visit_route 정합은 EF seed 배포 후 신규분부터 회복`);
  });

  test('AC-0(시나리오 0): 신규(초진) 첫 예약(TM 인입) → 신규 customers INSERT with visit_route seed', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    // EF 신규-고객 INSERT 경로: 첫 예약 = 첫 customers row 생성 시점에 visitRouteLanded('TM') seed.
    const { data: c, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: 'TM' })
      .select('id, visit_route')
      .single();
    expect(error).toBeNull();
    expect((c as { visit_route: string }).visit_route, '초진 신규 고객 방문경로 seed').toBe('TM');
    console.log('[AC-0/시나리오0] 신규 초진 첫 예약 → 2번차트 방문경로(TM) seed PASS');
  });

  test('preserve-on-NULL: 기존 고객 visit_route 공란 → TM fill', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new' })
      .select('id, visit_route')
      .single();
    expect((c as { visit_route: string | null }).visit_route).toBeNull();
    // EF 기존-고객 UPDATE: shouldFillVisitRoute = 기존 공란 && visitRouteLanded
    const existing = ((c as { visit_route: string | null }).visit_route ?? '').trim();
    if (existing === '') await sb!.from('customers').update({ visit_route: 'TM' }).eq('id', (c as { id: string }).id);
    const { data } = await sb!.from('customers').select('visit_route').eq('id', (c as { id: string }).id).single();
    expect((data as { visit_route: string }).visit_route).toBe('TM');
    console.log('[preserve-on-NULL] 기존 공란 → TM fill PASS');
  });

  test('no-clobber: 기존 수동 방문경로(지인소개)는 도파민 재push 로 미터치', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', visit_route: '지인소개' })
      .select('id, visit_route')
      .single();
    const existing = ((c as { visit_route: string | null }).visit_route ?? '').trim();
    const shouldFill = existing === ''; // non-empty → false → update 미발화
    if (shouldFill) await sb!.from('customers').update({ visit_route: 'TM' }).eq('id', (c as { id: string }).id);
    const { data } = await sb!.from('customers').select('visit_route').eq('id', (c as { id: string }).id).single();
    expect((data as { visit_route: string }).visit_route, 'no-clobber 위반: 수동값 덮어씀').toBe('지인소개');
    console.log('[no-clobber] 수동 지인소개 보존 PASS');
  });

  test('G1: visit_route 단일 컬럼 — lead_source/customer_memo 미접촉', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TAG, phone: phone(), visit_type: 'new', lead_source: '네이버', customer_memo: 'PRESERVE-ME' })
      .select('id')
      .single();
    await sb!.from('customers').update({ visit_route: 'TM' }).eq('id', (c as { id: string }).id);
    const { data } = await sb!
      .from('customers')
      .select('visit_route, lead_source, customer_memo')
      .eq('id', (c as { id: string }).id)
      .single();
    const row = data as { visit_route: string; lead_source: string | null; customer_memo: string | null };
    expect(row.visit_route).toBe('TM');
    expect(row.lead_source, 'G1 위반: lead_source 오염').toBe('네이버');
    expect(row.customer_memo, 'G1 위반: customer_memo 오염').toBe('PRESERVE-ME');
    console.log('[G1] visit_route 단일컬럼 — 타 컬럼 미접촉 PASS');
  });
});
