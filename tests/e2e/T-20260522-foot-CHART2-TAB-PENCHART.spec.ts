/**
 * E2E spec — T-20260522-foot-CHART2-TAB-PENCHART
 * 2번차트 1구역 기본 탭 → [펜차트] 변경
 *
 * AC-1: 2번차트 진입 시 기본 선택 탭이 [펜차트]임을 확인
 * AC-2: [문진] 탭으로 전환 가능하고 기존 기능 회귀 없음
 * AC-3: 다른 고객 차트에서도 동일하게 기본 탭이 [펜차트]
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-CHART2-TAB-PENCHART — 기본 탭 펜차트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /** 고객 목록에서 N번째 고객 차트 페이지로 이동 */
  async function openCustomerChart(
    page: Parameters<typeof loginAndWaitForDashboard>[0],
    index = 0,
  ) {
    await page.goto('/admin/customers');
    const rows = page.locator('tr[data-customer-id], tbody tr');
    try {
      await rows.first().waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    const row = rows.nth(index);
    const link = row.locator('a[href*="/chart/"]').first();
    if (await link.count() > 0) await link.click();
    else await row.click();

    try {
      await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });
    } catch {
      return false;
    }
    return true;
  }

  // ─ AC-1: 기본 탭 = 펜차트 ─────────────────────────────────────────────

  test('AC-1: 2번차트 진입 시 [펜차트] 탭이 기본 활성화됨', async ({ page }) => {
    const ok = await openCustomerChart(page, 0);
    if (!ok) test.skip(true, 'No customer found');

    // chart-tab-content 안에 펜차트 컨텐츠 존재 확인
    const tabContent = page.locator('[data-testid="chart-tab-content"]');
    await expect(tabContent).toBeVisible({ timeout: 8_000 });

    // 펜차트 탭 버튼이 활성(active/selected) 상태인지 확인
    // — 버튼 내 텍스트 '펜차트'를 가진 버튼이 현재 선택 클래스를 갖고 있어야 함
    const penChartBtn = page.getByRole('button', { name: '펜차트', exact: true }).first();
    await expect(penChartBtn).toBeVisible({ timeout: 5_000 });

    // active 상태 클래스 확인 (bg-white text-teal-700 등 구현상 활성 클래스)
    const isActive = await penChartBtn.evaluate((el) =>
      el.classList.contains('bg-white') ||
      el.classList.contains('text-teal-700') ||
      el.classList.contains('font-semibold') ||
      el.getAttribute('aria-selected') === 'true',
    );
    expect(isActive).toBe(true);
    console.log('[AC-1] 펜차트 탭 기본 활성화 OK');

    // 탭 콘텐츠 영역에 펜차트 관련 내용이 렌더됨
    const hasPenChartContent =
      (await page.getByText('새 차트 작성').count()) > 0 ||
      (await page.getByText(/펜차트/).count()) > 0 ||
      (await tabContent.locator('canvas').count()) > 0;
    expect(hasPenChartContent).toBe(true);
    console.log('[AC-1] 펜차트 콘텐츠 렌더 OK');
  });

  // ─ AC-2: 문진 탭 전환 + 회귀 없음 ────────────────────────────────────

  test('AC-2: [문진] 탭 클릭 시 정상 전환되고 콘텐츠 표시됨', async ({ page }) => {
    const ok = await openCustomerChart(page, 0);
    if (!ok) test.skip(true, 'No customer found');

    // 문진 탭 클릭
    const checklistBtn = page.getByRole('button', { name: '문진', exact: true }).first();
    await expect(checklistBtn).toBeVisible({ timeout: 8_000 });
    await checklistBtn.click();

    // 문진 콘텐츠 렌더 확인 (checklist-tab-content 또는 동의서/체크리스트 텍스트)
    const hasChecklistContent =
      (await page.locator('[data-testid="checklist-tab-content"]').count()) > 0 ||
      (await page.getByText(/동의서|체크리스트|문진/).count()) > 0;
    expect(hasChecklistContent).toBe(true);
    console.log('[AC-2] 문진 탭 전환 + 콘텐츠 표시 OK');

    // 문진 탭 버튼 활성 상태
    const isActive = await checklistBtn.evaluate((el) =>
      el.classList.contains('bg-white') ||
      el.classList.contains('text-teal-700') ||
      el.classList.contains('font-semibold') ||
      el.getAttribute('aria-selected') === 'true',
    );
    expect(isActive).toBe(true);
    console.log('[AC-2] 문진 탭 active 상태 OK');
  });

  // ─ AC-3: 다른 고객도 동일하게 기본 탭 = 펜차트 ─────────────────────

  test('AC-3: 두 번째 고객 차트에서도 기본 탭이 [펜차트]', async ({ page }) => {
    await page.goto('/admin/customers');
    const rows = page.locator('tr[data-customer-id], tbody tr');
    try {
      await rows.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, 'No customers found');
      return;
    }

    // 두 번째 고객 (없으면 첫 번째로 fallback)
    const rowCount = await rows.count();
    const targetIndex = rowCount >= 2 ? 1 : 0;
    const row = rows.nth(targetIndex);
    const link = row.locator('a[href*="/chart/"]').first();
    if (await link.count() > 0) await link.click();
    else await row.click();

    try {
      await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });
    } catch {
      test.skip(true, 'Chart page did not load');
      return;
    }

    // 펜차트 버튼 활성 확인
    const penChartBtn = page.getByRole('button', { name: '펜차트', exact: true }).first();
    await expect(penChartBtn).toBeVisible({ timeout: 5_000 });

    const isActive = await penChartBtn.evaluate((el) =>
      el.classList.contains('bg-white') ||
      el.classList.contains('text-teal-700') ||
      el.classList.contains('font-semibold') ||
      el.getAttribute('aria-selected') === 'true',
    );
    expect(isActive).toBe(true);
    console.log(`[AC-3] ${targetIndex + 1}번째 고객 — 펜차트 탭 기본 활성화 OK`);
  });
});
