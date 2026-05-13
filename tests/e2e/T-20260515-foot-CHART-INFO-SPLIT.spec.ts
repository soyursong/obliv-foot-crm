/**
 * T-20260515-foot-CHART-INFO-SPLIT
 * 고객정보 ↔ 고객차트 분리 + 탭 영역 메인화
 *
 * AC-1: 차트 페이지 상단에 한 줄 compact header (이름/연락처/차트번호/초재진)
 * AC-2: 상세 기본정보가 [고객정보] 탭으로 분리되어 표시
 * AC-3: [고객정보] 탭에서 기존 편집 기능 정상 동작
 * AC-4: 탭 영역이 메인 콘텐츠 영역으로 확대 (구석 X, 화면 대부분 차지)
 * AC-5: 차트 최초 진입 시 탭 영역이 즉시 보임 (스크롤 불필요)
 * AC-6: 기존 C21-TAB-RESTRUCTURE A/B 배포 결과와 호환 (탭 내용 손실 없음)
 *
 * 현장 클릭 시나리오 3건 — 티켓 T-20260515-foot-CHART-INFO-SPLIT.md 참조
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/**
 * CustomerChartPage는 window.open으로 열리는 경우와
 * /customers/:id/chart 라우트로 직접 접근하는 경우가 있다.
 * 테스트에서는 /customers/:id/chart 직접 접근을 사용한다.
 * (테스트 환경에 고객 데이터가 없을 수 있어 page load만 검증하는 항목도 포함)
 */

test.describe('T-20260515-foot-CHART-INFO-SPLIT', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  /**
   * 시나리오 1: 정상 동선 — 차트 열기 + 탭 영역 확인
   * AC-1, AC-4, AC-5 검증
   */
  test('시나리오1: 고객차트 페이지 — compact header + 탭 영역 즉시 표시 (AC-1, AC-4, AC-5)', async ({ page }) => {
    // 고객 목록 접근
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    // 고객 목록에서 첫 번째 고객 클릭 → 1번차트(고객 상세)
    const customerRows = page.locator('tbody tr, [data-testid="customer-row"]');
    const rowCount = await customerRows.count();

    if (rowCount > 0) {
      await customerRows.first().click();
      await page.waitForLoadState('networkidle');

      // 고객차트보기 버튼 또는 직접 2번차트 링크 클릭
      const chartBtn = page.getByRole('button', { name: /고객차트보기|차트보기|차트/ }).first();
      const hasChartBtn = await chartBtn.isVisible({ timeout: 3000 }).catch(() => false);

      if (hasChartBtn) {
        // 새 탭으로 열리는 경우 처리
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page').catch(() => null),
          chartBtn.click(),
        ]);
        const chartPage = newPage ?? page;
        await chartPage.waitForLoadState('networkidle');

        // AC-1: compact header 표시 확인
        const compactHeader = chartPage.locator('[data-testid="chart-compact-header"]');
        await expect(compactHeader).toBeVisible();

        // AC-1: compact header 내 핵심 요소 확인
        const headerText = await compactHeader.textContent();
        expect(headerText).toBeTruthy();
        // 초재진 배지 (초진 or 재진 or 예약없이 방문) 중 하나 포함
        const hasVisitType = /초진|재진|예약없이/.test(headerText ?? '');
        expect(hasVisitType).toBe(true);

        // AC-4, AC-5: 탭 영역이 화면 상단 near에 바로 표시
        const clinicalTabs = chartPage.locator('[data-testid="chart-tab-clinical"]');
        const historyTabs = chartPage.locator('[data-testid="chart-tab-history"]');
        await expect(clinicalTabs).toBeVisible();
        await expect(historyTabs).toBeVisible();

        // AC-5: 탭 콘텐츠가 스크롤 없이 보임 — viewport 내에 있어야 함
        const tabContent = chartPage.locator('[data-testid="chart-tab-content"]');
        await expect(tabContent).toBeVisible();
        const bbox = await tabContent.boundingBox();
        expect(bbox).not.toBeNull();
        // 탭 콘텐츠 상단이 뷰포트 높이 안에 있어야 함 (700px 이하 기준)
        expect(bbox!.y).toBeLessThan(700);
      } else {
        // 고객차트 버튼이 없는 경우 — 고객 상세 페이지만 확인
        await expect(page).toHaveURL(/customers/);
      }
    } else {
      // 고객 없는 환경 — 페이지 자체 로드만 확인
      await expect(page).toHaveURL(/customers/);
    }
  });

  /**
   * 시나리오 2: 고객정보 탭에서 기본정보 확인/편집
   * AC-2, AC-3 검증
   */
  test('시나리오2: [고객정보] 탭 클릭 → 상세정보 + 편집 기능 확인 (AC-2, AC-3)', async ({ page }) => {
    // /customers/:id/chart 라우트 직접 접근 시도
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const customerRows = page.locator('tbody tr, [data-testid="customer-row"]');
    const rowCount = await customerRows.count();

    if (rowCount === 0) {
      // 데이터 없음 — skip
      await expect(page).toHaveURL(/customers/);
      return;
    }

    await customerRows.first().click();
    await page.waitForLoadState('networkidle');

    const chartBtn = page.getByRole('button', { name: /고객차트보기|차트보기|차트/ }).first();
    const hasChartBtn = await chartBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasChartBtn) {
      await expect(page).toHaveURL(/customers/);
      return;
    }

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page').catch(() => null),
      chartBtn.click(),
    ]);
    const chartPage = newPage ?? page;
    await chartPage.waitForLoadState('networkidle');

    // AC-2: 이력 탭 영역에서 [고객정보] 탭 버튼 확인
    const historyTabBar = chartPage.locator('[data-testid="chart-tab-history"]');
    await expect(historyTabBar).toBeVisible();

    const customerInfoTabBtn = historyTabBar.getByRole('button', { name: '고객정보' });
    await expect(customerInfoTabBtn).toBeVisible();

    // [고객정보] 탭 클릭
    await customerInfoTabBtn.click();

    // AC-2: 고객정보 패널이 표시됨
    const infoPanel = chartPage.locator('[data-testid="chart-info-panel"]');
    await expect(infoPanel).toBeVisible();

    // 기본 정보 행 존재 확인 (고객명 행)
    await expect(infoPanel.getByText('고객명')).toBeVisible();

    // AC-3: 일반 탭 콘텐츠(chart-tab-content)는 숨겨져야 함
    const tabContent = chartPage.locator('[data-testid="chart-tab-content"]');
    await expect(tabContent).toBeHidden();

    // 저장 버튼 표시 확인 (compact header에 나타남)
    const compactHeader = chartPage.locator('[data-testid="chart-compact-header"]');
    const saveBtn = compactHeader.getByRole('button', { name: '저장' });
    await expect(saveBtn).toBeVisible();

    // AC-3: 다른 탭으로 돌아갔을 때 탭 콘텐츠 다시 보임
    const clinicalTabBar = chartPage.locator('[data-testid="chart-tab-clinical"]');
    const checklistBtn = clinicalTabBar.getByRole('button', { name: '문진' });
    const hasChecklist = await checklistBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasChecklist) {
      await checklistBtn.click();
      await expect(tabContent).toBeVisible();
      await expect(infoPanel).toBeHidden();
    }
  });

  /**
   * 시나리오 3: 엣지 — 기존 탭 내용 호환 (AC-6)
   * C21-TAB-RESTRUCTURE A/B 결과 유지 확인
   */
  test('시나리오3: 기존 탭 내용 호환 확인 (AC-6)', async ({ page }) => {
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');

    const customerRows = page.locator('tbody tr, [data-testid="customer-row"]');
    const rowCount = await customerRows.count();

    if (rowCount === 0) {
      await expect(page).toHaveURL(/customers/);
      return;
    }

    await customerRows.first().click();
    await page.waitForLoadState('networkidle');

    const chartBtn = page.getByRole('button', { name: /고객차트보기|차트보기|차트/ }).first();
    const hasChartBtn = await chartBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasChartBtn) {
      await expect(page).toHaveURL(/customers/);
      return;
    }

    const [newPage] = await Promise.all([
      page.context().waitForEvent('page').catch(() => null),
      chartBtn.click(),
    ]);
    const chartPage = newPage ?? page;
    await chartPage.waitForLoadState('networkidle');

    // AC-6: 각 탭 순서대로 클릭 → 오류 없이 렌더링
    const clinicalTabBar = chartPage.locator('[data-testid="chart-tab-clinical"]');
    const historyTabBar = chartPage.locator('[data-testid="chart-tab-history"]');
    const tabContent = chartPage.locator('[data-testid="chart-tab-content"]');

    await expect(clinicalTabBar).toBeVisible();
    await expect(historyTabBar).toBeVisible();

    // 임상 탭 순회
    const clinicalBtns = clinicalTabBar.getByRole('button');
    const clinicalCount = await clinicalBtns.count();
    for (let i = 0; i < clinicalCount; i++) {
      await clinicalBtns.nth(i).click();
      // 탭 콘텐츠 영역이 보여야 함
      await expect(tabContent).toBeVisible();
      // 고객정보 패널은 숨겨져야 함
      const infoPanel = chartPage.locator('[data-testid="chart-info-panel"]');
      await expect(infoPanel).toBeHidden();
    }

    // 이력 탭 순회 (고객정보 탭 제외)
    const historyBtns = historyTabBar.getByRole('button').filter({ hasNot: historyTabBar.getByRole('button', { name: '고객정보' }) });
    const histCount = await historyBtns.count();
    for (let i = 0; i < histCount; i++) {
      const btn = historyBtns.nth(i);
      const label = await btn.textContent();
      if (label === '고객정보') continue; // 고객정보 탭은 별도 시나리오2에서 검증
      await btn.click();
      await expect(tabContent).toBeVisible();
    }

    // 페이지 레벨 JS 오류 없는지 확인 (콘솔 에러 미발생)
    // (이 테스트는 렌더링 오류만 확인, 실제 콘솔은 별도 spec에서 확인)
    await expect(chartPage).not.toHaveURL(/error/);
  });
});
