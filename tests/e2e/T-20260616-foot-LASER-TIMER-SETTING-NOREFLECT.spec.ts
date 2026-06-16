/**
 * E2E spec — T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT
 * (parent: T-20260616-foot-LASER-TIMER-SETTING-CONNECT, deploy e019a7ac)
 *
 * 현장 실패: 김주연 총괄 "설정 변경해도 2번차트에 반영 안 됨" — F5 후에도 미반영.
 *
 * 진단(코드+prod DB 직접 검증):
 *   - 저장 경로 정상: 김주연=admin·approved, RLS UPDATE rowCount=1. laser_time_units jsonb 라운드트립 OK.
 *   - 라이브 번들에 READ 코드 포함, CHECK 마이그(1~180) prod 적용됨. read/write 모두 jongno-foot 동일 row.
 *   ⇒ 데이터 경로엔 버그 없음. RC = getClinic() 모듈 싱글톤이 프로세스 수명 내내 절대 만료되지 않아,
 *      한 스테이션에서 설정을 바꿔도 다른 스테이션(2번차트 태블릿)이 먼저 캐시한 stale 단위를 계속 반환.
 *      clearClinicCache는 "저장한 그 탭"에서만 호출 → 타 디바이스/탭 미전파. 키오스크 webview의
 *      '새로고침'은 모듈 재초기화를 보장 못 해 F5 후에도 미반영처럼 보였다.
 *
 *   ⚠️ 기존 CONNECT spec이 이 RC를 못 잡은 이유: openSeededChartSheet가 page.goto(풀 리로드)로
 *      진입 → 매번 캐시 초기화 → 항상 최신값 fetch. 즉 "풀 리로드"가 버그를 가렸다.
 *      → 본 spec은 네비게이션 없이 설정을 바꾸고 window focus/visibility 만으로 반영을 검증한다.
 *
 * 수정: getClinic 캐시 TTL(30s)+force 옵션, useClinic 이 window focus/visibilitychange 시 force 재조회.
 *
 * AC:
 *   AC-1(핵심): 차트가 열린 상태에서 다른 스테이션이 설정을 바꾸면(=DB 갱신), 하드리로드 없이
 *               refocus(visibilitychange/focus) 만으로 버튼이 새 설정값으로 갱신된다.
 *   AC-2: 단위 추가/제거 양방향 반영(추가된 버튼 등장 + 제거된 버튼 소멸).
 *   AC-3(회귀): 풀 리로드 경로 반영도 여전히 정상(CONNECT 동작 회귀 없음).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CLINIC_SLUG = 'jongno-foot';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
let seededCheckInId: string | null = null;
let seededCustomerId: string | null = null;
let seededName = '';
let originalUnits: number[] | null = null;

async function setClinicUnits(units: number[] | null) {
  if (!sb) return;
  const { error } = await sb.from('clinics').update({ laser_time_units: units }).eq('slug', CLINIC_SLUG);
  if (error) throw new Error(`[setClinicUnits] 갱신 실패: ${error.message}`);
}

// 다른 스테이션이 화면을 다시 봤다고 가정 — 네비게이션 없이 focus/visibility 이벤트만 발생
async function simulateRefocus(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

test.describe('T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT — 하드리로드 없이 설정 반영', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);

    const { data: clinicRow } = await sb
      .from('clinics').select('laser_time_units').eq('slug', CLINIC_SLUG).single();
    originalUnits = (clinicRow?.laser_time_units as number[] | null) ?? null;

    seededName = `laser-noreflect-qa-${Date.now()}`;
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: seededName, phone, visit_type: 'returning' })
      .select('id').single();
    if (custErr || !customer) throw new Error(`[seed] 고객 생성 실패: ${custErr?.message ?? 'no row'}`);
    seededCustomerId = customer.id;

    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID, customer_id: seededCustomerId,
        customer_name: seededName, customer_phone: phone,
        visit_type: 'returning', status: 'treatment_waiting',
        queue_number: 9100 + (Date.now() % 400),
      })
      .select('id').single();
    if (ciErr || !checkIn) throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);
    seededCheckInId = checkIn.id;
  });

  test.afterAll(async () => {
    if (!sb) return;
    await setClinicUnits(originalUnits);
    if (seededCheckInId) {
      await sb.from('timer_records').delete().eq('check_in_id', seededCheckInId);
      await sb.from('check_ins').delete().eq('id', seededCheckInId);
    }
    if (seededCustomerId) await sb.from('customers').delete().eq('id', seededCustomerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) { test.skip(true, 'Supabase service env 미설정 — 스킵'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  async function openSeededChartSheet(page: Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${seededCheckInId}"]`);
    await card.first().waitFor({ state: 'visible', timeout: 15_000 });
    await card.first().click();
    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.waitFor({ state: 'visible', timeout: 10_000 });
    await sheet.locator('[data-testid="laser-timer-panel"]').waitFor({ state: 'visible', timeout: 10_000 });
    return sheet;
  }

  // AC-1 + AC-2 핵심: 차트 오픈 후 설정 변경 → 네비게이션 없이 refocus → 버튼 갱신
  test('S-1: 하드리로드 없이 refocus 만으로 설정값 반영 (추가+제거 양방향)', async ({ page }) => {
    // 초기 단위 [10,15] 로 차트 진입
    await setClinicUnits([10, 15]);
    const sheet = await openSeededChartSheet(page);
    await expect(sheet.locator('[data-testid="laser-timer-btn-10"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-40"]')).toHaveCount(0);

    // 다른 스테이션이 [10,40] 으로 저장(15 제거, 40 추가) — 본 페이지는 네비게이션 없음
    await setClinicUnits([10, 40]);

    // refocus(설정 화면 → 차트 화면 전환 시 발생) 만으로 갱신되어야 함 (RC 수정 검증)
    await simulateRefocus(page);

    // 추가된 40 등장
    await expect(sheet.locator('[data-testid="laser-timer-btn-40"]')).toBeVisible({ timeout: 5_000 });
    // 제거된 15 소멸
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toHaveCount(0);
    // 유지된 10 보존
    await expect(sheet.locator('[data-testid="laser-timer-btn-10"]')).toBeVisible();
  });

  // AC-3 회귀: 풀 리로드 경로 반영 정상 (CONNECT 동작 보존)
  test('S-2: 풀 리로드 경로 반영 회귀 없음', async ({ page }) => {
    await setClinicUnits([12, 25]);
    const sheet = await openSeededChartSheet(page);
    await expect(sheet.locator('[data-testid="laser-timer-btn-12"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-25"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toHaveCount(0);
  });

  // AC-1 폴백 회귀: 빈 설정에서 refocus 시 폴백 유지 + 이후 채워지면 반영
  test('S-3: 빈 설정 폴백 유지 → 값 채우면 refocus 로 반영', async ({ page }) => {
    await setClinicUnits([]); // 폴백 [5,15,20]
    const sheet = await openSeededChartSheet(page);
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-20"]')).toBeVisible();

    // 다른 스테이션이 [18] 로 설정 → refocus → 폴백 대신 [18] 반영
    await setClinicUnits([18]);
    await simulateRefocus(page);
    await expect(sheet.locator('[data-testid="laser-timer-btn-18"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toHaveCount(0);
  });
});
