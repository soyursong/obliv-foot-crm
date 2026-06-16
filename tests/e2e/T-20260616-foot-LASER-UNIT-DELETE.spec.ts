/**
 * E2E spec — T-20260616-foot-LASER-UNIT-DELETE
 * 클리닉 설정 > 레이저 시간 단위 — 개별 값 삭제 기능 (추가 동선 T-20260502 의 역연산)
 *
 * 배경: 직원/공간 > 클리닉 설정 > "레이저 시간 단위" 섹션은 추가만 가능하고
 *       삭제해도 별도 [저장]을 눌러야 반영돼 현장에서 "지워지지 않는다"고 느꼈음.
 *       → 칩 삭제(X) 클릭 시 즉시 제거 + 저장(persistUnits, T-20260502 저장 경로 재사용).
 *
 * AC-1: 각 시간 단위 칩 옆에 삭제 버튼(X) 표시
 * AC-2: 삭제 클릭 → clinics.laser_time_units 에서 제거 + 즉시 저장
 * AC-3: 재진입(풀 리로드) 시 삭제 값이 사라진 상태로 유지
 * AC-4: 마지막 1개도 삭제 가능(빈 배열 저장 허용) + 빈 상태 안내 문구 노출
 * AC-5: 추가 동선/타이머 회귀 없음 — 새 값 추가→삭제 왕복
 *
 * 시나리오 (티켓 "현장 클릭 시나리오"):
 *   S-1: [5,10,15,20] 중 10 삭제 → 즉시 제거·저장 → 리로드 후 [5,15,20] 유지
 *   S-2: 전부 삭제 → 빈 배열 저장 + 안내 문구 노출 (AC-4)
 *   S-3: 회귀 — 새 값 25 추가·저장 → 25 삭제 → 목록에서 사라짐 (AC-5)
 *
 * 구현 노트:
 *   - 설정 화면은 clinics.laser_time_units 를 직접 READ/WRITE 하므로 service_role 로 시드/원복.
 *   - page.goto('/admin/staff') 후 "클리닉 설정" 탭 진입 → settings 탭은 admin/manager 한정.
 *   - 시드/복원: 원래 laser_time_units 를 beforeAll 백업, afterAll 원복(비파괴).
 *   - Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
let originalUnits: number[] | null = null;

async function setClinicUnits(units: number[] | null) {
  if (!sb) return;
  const { error } = await sb.from('clinics').update({ laser_time_units: units }).eq('slug', CLINIC_SLUG);
  if (error) throw new Error(`[setClinicUnits] 갱신 실패: ${error.message}`);
}

async function readClinicUnits(): Promise<number[] | null> {
  if (!sb) return null;
  const { data } = await sb.from('clinics').select('laser_time_units').eq('slug', CLINIC_SLUG).single();
  return (data?.laser_time_units as number[] | null) ?? null;
}

test.describe('T-20260616-foot-LASER-UNIT-DELETE — 레이저 시간 단위 개별 삭제', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);
    originalUnits = await readClinicUnits();
    console.log(`[seed] originalUnits=${JSON.stringify(originalUnits)}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    await setClinicUnits(originalUnits); // 비파괴 원복
    console.log('[seed] 설정값 원복 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // 클리닉 설정 탭 진입 (풀 리로드로 최신 laser_time_units fetch)
  async function openClinicSettings(page: Page) {
    await page.goto('/admin/staff');
    const settingsTab = page.getByRole('tab', { name: /클리닉 설정/ });
    await settingsTab.waitFor({ state: 'visible', timeout: 15_000 });
    await settingsTab.click();
    // 레이저 시간 단위 카드 렌더 대기
    await page.getByText('레이저 시간 단위 설정', { exact: false }).first().waitFor({ timeout: 10_000 });
  }

  // S-1: [5,10,15,20] 에서 10 삭제 → 즉시 제거·저장 → 리로드 후 유지
  test('S-1: AC-1/AC-2/AC-3 — 개별 값 삭제가 즉시 저장되고 재진입 후 유지', async ({ page }) => {
    await setClinicUnits([5, 10, 15, 20]);
    await openClinicSettings(page);

    // AC-1: 삭제 버튼 표시
    const delBtn10 = page.locator('[data-testid="laser-unit-delete-10"]');
    await expect(delBtn10).toBeVisible({ timeout: 5_000 });

    // AC-2: 10 삭제 클릭 → 칩 즉시 사라짐
    await delBtn10.click();
    await expect(page.locator('[data-testid="laser-unit-chip-10"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-testid="laser-unit-chip-5"]')).toBeVisible();
    await expect(page.locator('[data-testid="laser-unit-chip-15"]')).toBeVisible();
    await expect(page.locator('[data-testid="laser-unit-chip-20"]')).toBeVisible();

    // AC-2: DB 에 즉시 반영 확인 (저장됨)
    await expect.poll(async () => (await readClinicUnits())?.join(','), { timeout: 5_000 }).toBe('5,15,20');

    // AC-3: 풀 리로드 재진입 → 10 미표시 유지
    await openClinicSettings(page);
    await expect(page.locator('[data-testid="laser-unit-chip-10"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="laser-unit-chip-5"]')).toBeVisible();
  });

  // S-2: 전부 삭제 → 빈 배열 저장 + 안내 문구 노출
  test('S-2: AC-4 — 마지막 값까지 삭제 가능, 빈 상태 안내 노출', async ({ page }) => {
    await setClinicUnits([15]); // 한 개만 남긴 상태
    await openClinicSettings(page);

    const delBtn15 = page.locator('[data-testid="laser-unit-delete-15"]');
    await expect(delBtn15).toBeVisible({ timeout: 5_000 });

    // 마지막 1개 삭제 → 가드 없이 빈 배열 저장
    await delBtn15.click();
    await expect(page.locator('[data-testid="laser-unit-chip-15"]')).toHaveCount(0, { timeout: 5_000 });

    // 빈 상태 안내 문구 노출 (AC-4)
    await expect(page.locator('[data-testid="laser-unit-empty-hint"]')).toBeVisible({ timeout: 5_000 });

    // DB 빈 배열 저장 확인
    await expect
      .poll(async () => (await readClinicUnits())?.length ?? -1, { timeout: 5_000 })
      .toBe(0);
  });

  // S-3: 회귀 — 새 값 추가·저장 → 삭제 왕복
  test('S-3: AC-5 — 추가 동선 회귀 없음(추가→삭제 왕복)', async ({ page }) => {
    await setClinicUnits([5, 15, 20]);
    await openClinicSettings(page);

    // 직접 추가 입력으로 25 추가
    const input = page.getByPlaceholder('분 입력');
    await input.fill('25');
    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 저장 → DB 반영
    await page.getByRole('button', { name: /^저장/ }).click();
    await expect.poll(async () => (await readClinicUnits())?.includes(25), { timeout: 5_000 }).toBe(true);

    // 재진입 후 25 칩 + 삭제 버튼 확인 → 삭제 → 사라짐
    await openClinicSettings(page);
    const delBtn25 = page.locator('[data-testid="laser-unit-delete-25"]');
    await expect(delBtn25).toBeVisible({ timeout: 5_000 });
    await delBtn25.click();
    await expect(page.locator('[data-testid="laser-unit-chip-25"]')).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(async () => (await readClinicUnits())?.includes(25), { timeout: 5_000 }).toBe(false);
  });
});
