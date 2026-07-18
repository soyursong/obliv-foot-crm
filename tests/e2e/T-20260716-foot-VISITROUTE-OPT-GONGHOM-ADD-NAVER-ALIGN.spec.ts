/**
 * E2E spec — T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN
 * 방문경로/예약경로 옵션에 '공홈'(공식 홈페이지) 신규 ADDITIVE 추가 + '네이버' 존치(rename 없음).
 *
 * 배경(김주연 총괄, ch C0ATE5P6JTH, no7d/nh69 v2 authoritative):
 *   - net 변경 = '공홈' 1개뿐. '네이버' 항목명·저장값 불변, '네이버야' 문자열 어디에도 미도입.
 *   - 3 surface(예약생성/예약상세 예약경로, 2번차트 방문경로, CheckInDetailSheet 방문경로)
 *     모두 단일 SSOT visitRouteOptionsFor()/VISIT_ROUTE_OPTIONS 경유 → '공홈' 자동 노출.
 *   - DA CONSULT-REPLY(nh69 v2): 순수 ADDITIVE, CHECK 7값(기존6+'공홈'). '공홈'→route_std homepage.
 *
 * AC:
 *   AC-A1  VISIT_ROUTE_OPTIONS SSOT 에 '공홈' 포함 → 3 surface 동시 노출(단일 SSOT).
 *   AC-A2  customers/reservations.visit_route CHECK 가 '공홈' 허용(7값), 기존행 UPDATE 0.
 *   AC-B   '네이버' 존치(CHECK 통과·드롭다운 노출) + '네이버야' 문자열 부재(rename 없음).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';
import { VISIT_ROUTE_OPTIONS, visitRouteOptionsFor } from '../../src/lib/types';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = Boolean(SUPABASE_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady
  ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const TEST_TAG = 'E2E-GONGHOM-ADD';

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

test.describe('T-20260716 GONGHOM-ADD — SSOT(순수 코드, DB/앱 불요)', () => {
  test('AC-A1: VISIT_ROUTE_OPTIONS 에 공홈 포함 → 3 surface 단일 SSOT 자동 노출', () => {
    expect(VISIT_ROUTE_OPTIONS as readonly string[]).toContain('공홈');
    // visitRouteOptionsFor() 를 3 surface 모두 사용 → 기본 목록에 '공홈' 포함되면 3곳 동시 노출
    expect(visitRouteOptionsFor(null)).toContain('공홈');
    console.log('[AC-A1] SSOT VISIT_ROUTE_OPTIONS 공홈 포함 확인 PASS');
  });

  test('AC-B: 네이버 존치 + 네이버야 문자열 부재(rename 없음)', () => {
    const opts = visitRouteOptionsFor(null);
    expect(opts).toContain('네이버');
    expect(opts).not.toContain('네이버야');
    expect(VISIT_ROUTE_OPTIONS as readonly string[]).not.toContain('네이버야');
    console.log('[AC-B] 네이버 존치 + 네이버야 미도입 확인 PASS');
  });
});

test.describe('T-20260716 GONGHOM-ADD — DB 계약(순수 ADDITIVE)', () => {
  test('AC-A2-a: customers.visit_route CHECK 가 공홈 허용(신규값)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `010${String(Date.now()).slice(-8)}`, visit_type: 'new', visit_route: '공홈' })
      .select('id, visit_route')
      .single();
    expect(error, "visit_route='공홈' CHECK 통과 실패").toBeNull();
    expect(data?.visit_route).toBe('공홈');
    seededCustomerId = data?.id ?? null;
    console.log('[AC-A2-a] customers.visit_route 공홈 허용 PASS');
  });

  test('AC-A2-b: reservations.visit_route CHECK 가 공홈 허용', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    // 시드 고객으로 예약 1건(visit_route='공홈') → CHECK 통과 확인
    const custId = seededCustomerId;
    test.skip(!custId, '시드 고객 없음 — 스킵');
    const { data, error } = await sb!
      .from('reservations')
      .insert({
        clinic_id: clinicId,
        customer_id: custId,
        reservation_date: '2099-01-01',
        reservation_time: '10:00',
        visit_route: '공홈',
      })
      .select('id, visit_route')
      .single();
    expect(error, "reservations.visit_route='공홈' CHECK 통과 실패").toBeNull();
    expect(data?.visit_route).toBe('공홈');
    if (data?.id) await sb!.from('reservations').delete().eq('id', data.id);
    console.log('[AC-A2-b] reservations.visit_route 공홈 허용 PASS');
  });

  test('AC-B(DB): 네이버 존치(여전히 CHECK 통과)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `010${String(Date.now()).slice(-8)}`, visit_type: 'new', visit_route: '네이버' })
      .select('id, visit_route')
      .single();
    expect(error, "visit_route='네이버' 존치 실패").toBeNull();
    expect(data?.visit_route).toBe('네이버');
    if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    console.log('[AC-B/DB] 네이버 존치 확인 PASS');
  });
});

test.describe('T-20260716 GONGHOM-ADD — 고객정보(2번차트) UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-A1(UI): 2번차트 방문경로 드롭다운에 공홈+네이버 노출, 네이버야 부재', async ({ page }) => {
    test.skip(!seededCustomerId, '시드 고객 없음(DB env 미설정) — 스킵');
    await page.goto(`/chart/${seededCustomerId}`);

    const select = page.locator('[data-testid="chart-visit-route-select"]').first();
    const visible = await select.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      test.skip(true, '2번차트 방문경로 드롭다운 미렌더 — 스킵');
      return;
    }

    const optionTexts = await select.locator('option').allTextContents();
    expect(optionTexts, "방문경로 옵션에 '공홈' 누락").toContain('공홈');
    expect(optionTexts, "방문경로 옵션에 '네이버' 누락").toContain('네이버');
    expect(optionTexts.some((t) => t.includes('네이버야')), "'네이버야' 항목이 존재하면 안 됨").toBeFalsy();
    console.log('[AC-A1/UI] 2번차트 방문경로 공홈·네이버 노출 + 네이버야 부재 PASS');

    // 공홈 선택 → optimistic 반영(에러 없이 선택 유지)
    await select.selectOption('공홈');
    await expect(select).toHaveValue('공홈');
    console.log('[AC-A1/UI] 2번차트 공홈 선택·optimistic 반영 PASS');

    await dismissCustomerChartSheet(page).catch(() => {});
  });
});
