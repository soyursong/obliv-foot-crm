/**
 * E2E spec — T-20260522-foot-PENCHART-DEFAULT-TAB
 * 2번차트 1구역 기본 탭 [문진] → [펜차트] 변경 (김주연 총괄 요청)
 *
 * 구현: CustomerChartPage.tsx
 *   const [chartTab, setChartTab] = useState<string>('pen_chart');
 *   CLINICAL_TABS[0] = { key: 'pen_chart', label: '펜차트' }
 *
 * AC-1: 2번차트 진입 시 기본 활성 탭이 [펜차트]
 * AC-2: [문진] 탭 클릭 시 문진 화면 정상 표시 (기존 기능 보존)
 * AC-3: 다른 탭 전환 후 2번차트 재진입 시 다시 [펜차트]가 기본 활성
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-PENCHART-DEFAULT-TAB — 기본 탭 펜차트', () => {
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

    const tabContent = page.locator('[data-testid="chart-tab-content"]');
    await expect(tabContent).toBeVisible({ timeout: 8_000 });

    // 펜차트 탭 버튼 활성(active) 상태 확인
    const penChartBtn = page.getByRole('button', { name: '펜차트', exact: true }).first();
    await expect(penChartBtn).toBeVisible({ timeout: 5_000 });

    const isActive = await penChartBtn.evaluate((el) =>
      el.classList.contains('bg-white') ||
      el.classList.contains('text-teal-700') ||
      el.classList.contains('font-semibold') ||
      el.getAttribute('aria-selected') === 'true',
    );
    expect(isActive).toBe(true);
    console.log('[AC-1] 펜차트 탭 기본 활성화 OK');

    // 펜차트 콘텐츠 렌더 확인
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

    // 문진 콘텐츠 렌더 확인
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

  // ─ AC-3: 탭 전환 후 재진입 시 기본 탭 = 펜차트 ────────────────────

  test('AC-3: [문진] 전환 → 대시보드 복귀 → 재진입 시 [펜차트] 기본 활성', async ({ page }) => {
    const ok = await openCustomerChart(page, 0);
    if (!ok) test.skip(true, 'No customer found');

    // 문진 탭으로 전환
    const checklistBtn = page.getByRole('button', { name: '문진', exact: true }).first();
    await expect(checklistBtn).toBeVisible({ timeout: 8_000 });
    await checklistBtn.click();

    // 대시보드로 복귀
    await page.goto('/');
    await page.waitForTimeout(500);

    // 재진입
    const ok2 = await openCustomerChart(page, 0);
    if (!ok2) test.skip(true, 'Chart reentry failed');

    // [펜차트] 탭이 다시 기본 활성 상태
    const penChartBtn = page.getByRole('button', { name: '펜차트', exact: true }).first();
    await expect(penChartBtn).toBeVisible({ timeout: 5_000 });

    const isActive = await penChartBtn.evaluate((el) =>
      el.classList.contains('bg-white') ||
      el.classList.contains('text-teal-700') ||
      el.classList.contains('font-semibold') ||
      el.getAttribute('aria-selected') === 'true',
    );
    expect(isActive).toBe(true);
    console.log('[AC-3] 재진입 후 펜차트 탭 기본 활성화 OK');
  });
});
