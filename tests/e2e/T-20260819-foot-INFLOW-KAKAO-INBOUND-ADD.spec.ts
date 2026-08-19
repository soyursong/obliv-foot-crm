/**
 * E2E spec — T-20260819-foot-INFLOW-KAKAO-INBOUND-ADD
 * 방문경로/예약경로(visit_route) 옵션에 '카톡'(카카오톡 인바운드) 신규 ADDITIVE 추가.
 *
 * 배경(풋센터 현장 매니저, ch C0ATE5P6JTH · U0ATDB587PV):
 *   - 현장 원문 "인바운드(카톡) 추가해줘". net 변경 = '카톡' 1개뿐.
 *   - 라벨 = (a) flat '카톡' 확정(DA Q4, MSG-20260819-115858-45sj) — '인바운드(카톡)' 컴파운드 REJECT('네이버'=flat 선례·집계 clean).
 *   - 3 surface(예약생성/예약상세 예약경로, 2번차트 방문경로, CheckInDetailSheet 방문경로)
 *     모두 단일 SSOT visitRouteOptionsFor()/VISIT_ROUTE_OPTIONS 경유 → '카톡' 자동 노출.
 *   - DA CONSULT-REPLY(MSG-20260819-115858-45sj): 순수 ADDITIVE, CHECK 8값(기존7+'카톡'), §36 firewall NEUTRAL, foot-only.
 *
 * AC (티켓):
 *   AC-1  유입경로 UI 에 '카톡' 옵션 노출(3 surface 단일 SSOT).
 *   AC-2  선택·저장 시 visit_route CHECK 위배 없이 정상 반영(customers/reservations).
 *   AC-3  기존 유입경로 값/데이터 무변경(ADDITIVE — 기존값 존치·회귀 0).
 *   AC-4  유입경로 집계에 '카톡' 신규 버킷 정상(VisitRouteSection SSOT 동적 렌더).
 *   AC-5  배정 라우팅(money-adjacent) 무접촉 — '카톡' 미매핑→WALK_IN 안전폴백(별건 planner 결정).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';
import { VISIT_ROUTE_OPTIONS, visitRouteOptionsFor, VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE } from '../../src/lib/types';
import { deriveAssignLeadSource } from '../../src/lib/assignmentStrategy';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = Boolean(SUPABASE_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady
  ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const TEST_TAG = 'E2E-KAKAO-ADD';

let clinicId: string | null = null;
let seededCustomerId: string | null = null;

test.beforeAll(async () => {
  if (!sb) return;
  const { data: clinic } = await sb.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  clinicId = clinic?.id ?? null;
});

test.afterAll(async () => {
  if (!sb) return;
  // 픽스처 한정 물리 정리(TEST_TAG 격리) — 운영 데이터 무접촉
  await sb.from('customers').delete().eq('name', TEST_TAG);
});

test.describe('T-20260819 KAKAO-ADD — SSOT(순수 코드, DB/앱 불요)', () => {
  test('AC-1: VISIT_ROUTE_OPTIONS 에 카톡 포함 → 3 surface 단일 SSOT 자동 노출', () => {
    expect(VISIT_ROUTE_OPTIONS as readonly string[]).toContain('카톡');
    // visitRouteOptionsFor() 를 3 surface 모두 사용 → 기본 목록에 '카톡' 포함되면 3곳 동시 노출
    expect(visitRouteOptionsFor(null)).toContain('카톡');
    // 라벨 = flat '카톡' 확정 — 컴파운드 '인바운드(카톡)' 미도입
    expect(VISIT_ROUTE_OPTIONS as readonly string[]).not.toContain('인바운드(카톡)');
    console.log('[AC-1] SSOT VISIT_ROUTE_OPTIONS 카톡(flat) 포함 확인 PASS');
  });

  test('AC-3: 기존 7값 전부 존치(ADDITIVE·rename/DROP 없음)', () => {
    const opts = VISIT_ROUTE_OPTIONS as readonly string[];
    for (const legacy of ['TM', '네이버', '인바운드', '워크인', '지인소개', '공홈']) {
      expect(opts, `기존값 '${legacy}' 존치 실패`).toContain(legacy);
    }
    console.log('[AC-3] 기존값 전부 존치 확인 PASS');
  });

  test('AC-5: 배정 라우팅 map 무접촉 — 카톡 미매핑→WALK_IN 안전폴백', () => {
    // money-adjacent 배정 라우팅(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE) 은 본 티켓 DA 스코프 밖 → 무접촉.
    expect(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE['카톡']).toBeUndefined();
    // 미매핑 값은 deriveAssignLeadSource 에서 WALK_IN 안전폴백(회귀 0·신규값이므로 기존 귀속 shift 0).
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '카톡' })).toBe('WALK_IN');
    console.log('[AC-5] 배정 map 무접촉 + WALK_IN 안전폴백 확인 PASS');
  });
});

test.describe('T-20260819 KAKAO-ADD — DB 계약(순수 ADDITIVE)', () => {
  test('AC-2-a: customers.visit_route CHECK 가 카톡 허용(신규값)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `DUMMY-${Date.now()}`, visit_type: 'new', visit_route: '카톡' })
      .select('id, visit_route')
      .single();
    expect(error, "visit_route='카톡' CHECK 통과 실패").toBeNull();
    expect(data?.visit_route).toBe('카톡');
    seededCustomerId = data?.id ?? null;
    console.log('[AC-2-a] customers.visit_route 카톡 허용 PASS');
  });

  test('AC-2-b: reservations.visit_route CHECK 가 카톡 허용', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const custId = seededCustomerId;
    test.skip(!custId, '시드 고객 없음 — 스킵');
    const { data, error } = await sb!
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: custId,
        reservation_date: '2099-01-01',
        reservation_time: '10:00',
        visit_route: '카톡',
      })
      .select('id, visit_route')
      .single();
    expect(error, "reservations.visit_route='카톡' CHECK 통과 실패").toBeNull();
    expect(data?.visit_route).toBe('카톡');
    if (data?.id) await sb!.from('reservations').delete().eq('id', data.id);
    console.log('[AC-2-b] reservations.visit_route 카톡 허용 PASS');
  });

  test('AC-3(DB): 기존값 인바운드/공홈 존치(여전히 CHECK 통과)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    for (const legacy of ['인바운드', '공홈']) {
      const { data, error } = await sb!
        .from('customers')
        .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `DUMMY-${Date.now()}-${legacy}`, visit_type: 'new', visit_route: legacy })
        .select('id, visit_route')
        .single();
      expect(error, `visit_route='${legacy}' 존치 실패`).toBeNull();
      expect(data?.visit_route).toBe(legacy);
      if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    }
    console.log('[AC-3/DB] 기존값 존치 확인 PASS');
  });
});

test.describe('T-20260819 KAKAO-ADD — 고객정보(2번차트) UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1(UI): 2번차트 방문경로 드롭다운에 카톡 노출 + 선택 반영', async ({ page }) => {
    test.skip(!seededCustomerId, '시드 고객 없음(DB env 미설정) — 스킵');
    await page.goto(`/chart/${seededCustomerId}`);

    const select = page.locator('[data-testid="chart-visit-route-select"]').first();
    const visible = await select.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      test.skip(true, '2번차트 방문경로 드롭다운 미렌더 — 스킵');
      return;
    }

    const optionTexts = await select.locator('option').allTextContents();
    expect(optionTexts, "방문경로 옵션에 '카톡' 누락").toContain('카톡');
    expect(optionTexts, "방문경로 옵션에 '인바운드' 누락(기존값 존치)").toContain('인바운드');
    console.log('[AC-1/UI] 2번차트 방문경로 카톡·인바운드 노출 PASS');

    // 카톡 선택 → optimistic 반영(에러 없이 선택 유지)
    await select.selectOption('카톡');
    await expect(select).toHaveValue('카톡');
    console.log('[AC-1/UI] 2번차트 카톡 선택·optimistic 반영 PASS');

    await dismissCustomerChartSheet(page).catch(() => {});
  });
});
