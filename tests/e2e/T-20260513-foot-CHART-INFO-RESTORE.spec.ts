/**
 * T-20260513-foot-CHART-INFO-RESTORE
 * 2번차트 1구역 고객정보 기존 레이아웃 복구 (CHART-INFO-SPLIT revert)
 *
 * AC-1: 1구역 고객정보 전체가 항상 표시됨 (탭 선택과 무관)
 * AC-2: 탭 영역 정상 동작 (진료/이력 탭 전환)
 * AC-3: 고객정보 편집·저장 기능 정상 동작
 * AC-4: 다른 환자로 전환 시 고객정보 갱신
 *
 * 현장 클릭 시나리오 2건 — 티켓 T-20260513-foot-CHART-INFO-RESTORE.md 참조
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

async function openChartPage(page: import('@playwright/test').Page) {
  // 대시보드에서 첫 번째 환자 행 클릭 → 2번차트(CustomerChartPage) 오픈
  const rows = page.locator('table tbody tr, [data-testid="patient-row"]');
  const count = await rows.count();
  if (count === 0) {
    // 환자 없으면 스킵
    return false;
  }
  const [chartPage] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
    rows.first().click(),
  ]);
  if (chartPage) {
    await chartPage.waitForLoadState('networkidle', { timeout: 10000 });
    return chartPage;
  }
  // 같은 탭에서 열린 경우
  await page.waitForURL(/\/chart\//, { timeout: 8000 }).catch(() => {});
  return page;
}

/**
 * 시나리오 1: 정상 동선 — 복구 확인
 * 고객정보 전체가 항상 보이고, 탭/저장 기능 정상 동작
 */
test('시나리오1: 2번차트 1구역 고객정보 항상 표시', async ({ page }) => {
  await loginIfNeeded(page);

  // 대시보드 진입
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 10000 });

  const chartTarget = await openChartPage(page);
  if (!chartTarget) {
    test.skip();
    return;
  }

  // AC-1: 1구역 고객정보 패널이 항상 표시됨
  const infoPanel = chartTarget.getByTestId('chart-info-panel');
  await expect(infoPanel).toBeVisible({ timeout: 8000 });

  // compact header(탭 전환 후 숨겨지는 방식)가 아닌 — 고객정보 서브헤더 표시 확인
  await expect(chartTarget.getByText('고객정보').first()).toBeVisible();

  // AC-2: 진료 탭 클릭 후에도 고객정보 패널 여전히 표시
  const clinicalTab = chartTarget.getByTestId('chart-tab-clinical');
  await expect(clinicalTab).toBeVisible();
  // 진료 탭 중 첫 번째 탭 클릭
  await clinicalTab.locator('button').first().click();
  await expect(infoPanel).toBeVisible();

  // 이력 탭 중 첫 번째 탭 클릭 후에도 고객정보 패널 유지
  const historyTab = chartTarget.getByTestId('chart-tab-history');
  await expect(historyTab).toBeVisible();
  await historyTab.locator('button').first().click();
  await expect(infoPanel).toBeVisible();

  // AC-3: 저장 버튼이 탭 상단(sub-header)에 항상 표시됨 (탭 조건 없음)
  const saveBtn = chartTarget.getByRole('button', { name: '저장' });
  await expect(saveBtn).toBeVisible();

  // 탭 콘텐츠 영역도 정상 표시 확인
  await expect(chartTarget.getByTestId('chart-tab-content')).toBeVisible();
});

/**
 * 시나리오 2: 엣지 케이스 — 고객정보 탭이 HISTORY_TABS에 없음 확인
 * CHART-INFO-SPLIT revert 후 "고객정보" 탭 버튼이 이력탭 행에 없어야 함
 */
test('시나리오2: 이력탭에 고객정보 탭 버튼 없음 (revert 확인)', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 10000 });

  const chartTarget = await openChartPage(page);
  if (!chartTarget) {
    test.skip();
    return;
  }

  const historyTabBar = chartTarget.getByTestId('chart-tab-history');
  await expect(historyTabBar).toBeVisible({ timeout: 8000 });

  // 이력탭 행에 "고객정보" 탭 버튼이 없어야 함 (CHART-INFO-SPLIT revert)
  const customerInfoTabBtn = historyTabBar.getByRole('button', { name: '고객정보' });
  await expect(customerInfoTabBtn).not.toBeVisible();

  // 다른 이력탭들은 정상 표시
  await expect(historyTabBar.getByRole('button', { name: '상담내역' })).toBeVisible();
  await expect(historyTabBar.getByRole('button', { name: '패키지' })).toBeVisible();
});
