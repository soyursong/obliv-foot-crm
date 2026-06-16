/**
 * E2E spec — T-20260616-foot-LASER-TIMER-SETTING-CONNECT
 * 비가열 레이저 타이머 시작 버튼 ↔ 클리닉 설정(clinics.laser_time_units) 연결
 *
 * 배경: 2번차트 [상세] 비가열 레이저 타이머의 시작 버튼이 [5,15,20] 하드코딩이라
 *       직원/공간>클리닉 설정의 "레이저 시간 단위"를 바꿔도 버튼에 반영되지 않았음.
 *       → 버튼을 clinics.laser_time_units READ로 동적 생성 (T-20260523 동작 회귀 없이).
 *
 * AC-1: 타이머 버튼 = 현재 클리닉 laser_time_units 값으로 동적 생성 (하드코딩 제거)
 * AC-2: 설정 변경·저장 후 재진입/새로고침 시 버튼 반영 (실시간 push 불요)
 * AC-3: laser_time_units 비었거나 null → 기본값 [5,15,20] 폴백 (버튼 보존)
 * AC-4: 클릭 후 카운트다운·취소 등 T-20260523 기존 동작 회귀 없음
 *
 * 시나리오 (티켓 본문 "현장 클릭 시나리오"):
 *   S-1: 설정 [10,30] → 2번차트 타이머 버튼 [10분][30분] 표시 (5/15/20 미표시) + [10분] 클릭→카운트다운
 *   S-2: 폴백 — laser_time_units 비움 → 버튼 [5분][15분][20분] 기본값 표시
 *   S-3: 회귀 — 설정값 버튼 클릭→카운트다운 시작 → [취소(종료)] → 타이머 정지(시작 버튼 복귀)
 *
 * 구현 노트:
 *   - getClinic()은 모듈 레벨 캐시(slug='jongno-foot')이나 page.goto는 풀 리로드 → 캐시 초기화 →
 *     매 테스트에서 DB를 먼저 갱신한 뒤 openSeededChartSheet(page.goto)로 진입하면 새 값이 fetch된다.
 *   - 시드/복원: 원래 laser_time_units를 beforeAll에 저장, afterAll에서 원복(비파괴).
 *   - 시드 패턴(오늘 활성 check-in)은 T-20260523-foot-LASER-TIMER.spec.ts 와 동일.
 *   - Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CLINIC_SLUG = 'jongno-foot'; // getClinic()이 사용하는 slug

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
let seededCheckInId: string | null = null;
let seededCustomerId: string | null = null;
let seededName = '';
// 원래 설정값 — afterAll에서 비파괴 원복
let originalUnits: number[] | null = null;

// 클리닉 laser_time_units 를 service_role 로 직접 갱신
async function setClinicUnits(units: number[] | null) {
  if (!sb) return;
  const { error } = await sb.from('clinics').update({ laser_time_units: units }).eq('slug', CLINIC_SLUG);
  if (error) throw new Error(`[setClinicUnits] 갱신 실패: ${error.message}`);
}

test.describe('T-20260616-foot-LASER-TIMER-SETTING-CONNECT — 타이머 버튼 ↔ 클리닉 설정 연결', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);

    // 원래 설정값 백업
    const { data: clinicRow } = await sb
      .from('clinics')
      .select('laser_time_units')
      .eq('slug', CLINIC_SLUG)
      .single();
    originalUnits = (clinicRow?.laser_time_units as number[] | null) ?? null;

    // 오늘 활성 check-in 시드
    seededName = `laser-setting-qa-${Date.now()}`;
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: seededName, phone, visit_type: 'returning' })
      .select('id')
      .single();
    if (custErr || !customer) throw new Error(`[seed] 고객 생성 실패: ${custErr?.message ?? 'no row'}`);
    seededCustomerId = customer.id;

    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: seededCustomerId,
        customer_name: seededName,
        customer_phone: phone,
        visit_type: 'returning',
        status: 'treatment_waiting',
        queue_number: 9500 + (Date.now() % 400),
      })
      .select('id')
      .single();
    if (ciErr || !checkIn) throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);
    seededCheckInId = checkIn.id;
    console.log(`[seed] check-in=${seededCheckInId}, originalUnits=${JSON.stringify(originalUnits)}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    // 설정값 비파괴 원복
    await setClinicUnits(originalUnits);
    if (seededCheckInId) {
      await sb.from('timer_records').delete().eq('check_in_id', seededCheckInId);
      await sb.from('check_ins').delete().eq('id', seededCheckInId);
    }
    if (seededCustomerId) await sb.from('customers').delete().eq('id', seededCustomerId);
    console.log('[seed] 정리 + 설정값 원복 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // 대시보드 → 시드 카드 클릭 → 2번차트(CustomerChartSheet) 오픈
  async function openSeededChartSheet(page: Page) {
    await page.goto('/admin'); // 풀 리로드 → getClinic 캐시 초기화 → 최신 laser_time_units fetch
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${seededCheckInId}"]`);
    await card.first().waitFor({ state: 'visible', timeout: 15_000 });
    await card.first().click();

    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    await sheet.waitFor({ state: 'visible', timeout: 10_000 });

    const timerPanel = sheet.locator('[data-testid="laser-timer-panel"]');
    await timerPanel.waitFor({ state: 'visible', timeout: 10_000 });
    return sheet;
  }

  // S-1: 설정 [10,30] → 버튼 [10분][30분] 표시(5/15/20 미표시) + [10분] 클릭→카운트다운
  test('S-1: AC-1/AC-2 — 설정값 [10,30] 이 타이머 버튼에 반영', async ({ page }) => {
    await setClinicUnits([10, 30]);

    const sheet = await openSeededChartSheet(page);

    // 설정값 버튼 표시
    await expect(sheet.locator('[data-testid="laser-timer-btn-10"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-30"]')).toBeVisible();

    // 하드코딩 기본값(5/15/20)은 표시되지 않아야 함
    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toHaveCount(0);
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toHaveCount(0);
    await expect(sheet.locator('[data-testid="laser-timer-btn-20"]')).toHaveCount(0);

    // [10분] 클릭 → 카운트다운 시작 (AC-4 기존 동작)
    await sheet.locator('[data-testid="laser-timer-btn-10"]').click();
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByText('10분 타이머')).toBeVisible({ timeout: 5_000 });

    // 정리: 타이머 종료
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    const confirmBtn = sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]');
    if (await confirmBtn.isVisible()) await confirmBtn.click();
  });

  // S-2: 폴백 — laser_time_units 비움 → 버튼 [5분][15분][20분] 기본값
  test('S-2: AC-3 — 설정 비었을 때 기본값 [5,15,20] 폴백', async ({ page }) => {
    await setClinicUnits([]); // 빈 배열 → length 0 → 폴백

    const sheet = await openSeededChartSheet(page);

    await expect(sheet.locator('[data-testid="laser-timer-btn-5"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-btn-15"]')).toBeVisible();
    await expect(sheet.locator('[data-testid="laser-timer-btn-20"]')).toBeVisible();

    // 시작 버튼 그룹이 정상 표시 (버튼 사라지지 않음)
    await expect(sheet.locator('[data-testid="laser-timer-start-buttons"]')).toBeVisible();
  });

  // S-3: 회귀 — 설정값 버튼 클릭 → 카운트다운 → [종료] 확인 → 타이머 정지(시작 버튼 복귀)
  test('S-3: AC-4 — 설정값 버튼 클릭·카운트다운·종료 회귀 없음', async ({ page }) => {
    await setClinicUnits([10, 30]);

    const sheet = await openSeededChartSheet(page);

    // 카운트다운 시작
    await sheet.locator('[data-testid="laser-timer-btn-10"]').click();
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).toBeVisible({ timeout: 5_000 });

    // 종료 → 확인 다이얼로그 → 확인 (T-20260523 종료 동작 회귀 검증)
    await sheet.locator('[data-testid="laser-timer-stop-btn"]').click();
    await expect(sheet.locator('[data-testid="laser-timer-stop-confirm"]')).toBeVisible({ timeout: 2_000 });
    await sheet.locator('[data-testid="laser-timer-stop-confirm-btn"]').click();

    // 시작 버튼 복귀 + 카운트다운 사라짐
    await expect(sheet.locator('[data-testid="laser-timer-start-buttons"]')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.locator('[data-testid="laser-timer-countdown"]')).not.toBeVisible();
  });
});
