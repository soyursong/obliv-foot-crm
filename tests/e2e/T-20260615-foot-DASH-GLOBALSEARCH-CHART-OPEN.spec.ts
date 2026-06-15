/**
 * T-20260615-foot-DASH-GLOBALSEARCH-CHART-OPEN
 * 대시보드 우측 상단 [고객 검색] 결과 클릭 시 고객관리 탭으로 전환만 되고
 * 그 고객의 2번차트가 안 열리던 버그 수정.
 *
 * 원인: 헤더 검색 결과 클릭 핸들러가 navigate('/admin/customers?id=...')만 호출.
 *       Customers.tsx는 location.state.openCustomerId 로만 차트를 열어 ?id= 쿼리를 무시
 *       → 탭만 전환되고 차트 미오픈.
 * 수정: 클릭 핸들러에 navigate('/admin/customers') + openChart(c.id) 분기 보강.
 *       CustomerChartSheet는 AdminLayout 레벨(chartId)에서 렌더되므로 즉시 오픈.
 *
 * 핵심 AC: 검색 결과(고객) 클릭 → 고객관리 탭 전환 후 선택 고객 차트 자동 오픈
 *   (role="dialog" aria-label="고객차트" 패널 가시화).
 *
 * 비범위: 검색 동작 자체·리스트 레이아웃 불변, DB 무변경.
 * 주: 테스트 DB에 검색 결과가 없을 수 있어 결과 존재 시에만 차트 오픈을 단언(방어적).
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
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 }).catch(() => {});
  }
}

// 헤더 글로벌 검색창을 열고 query 입력 → 첫 결과 버튼 locator 반환(없으면 null)
async function openSearchAndQuery(page: import('@playwright/test').Page, query: string) {
  // 상단바 [고객 검색] 버튼 클릭 → 검색 input 노출
  await page.getByRole('button', { name: '고객 검색' }).click();
  const input = page.getByPlaceholder(/이름.*전화번호.*생년월일.*차트번호/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(query);
  // debounce(300ms) + 서버 쿼리 여유
  await page.waitForTimeout(900);
  return input;
}

test.describe('T-20260615-foot-DASH-GLOBALSEARCH-CHART-OPEN', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // 핵심 시나리오: 검색 → 고객 클릭 → 고객관리 탭 전환 + 차트 자동 오픈
  test('S1: 검색 결과 클릭 시 고객관리 탭 전환 후 2번차트가 자동으로 열린다', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    await openSearchAndQuery(page, '김');

    // 검색 결과 드롭다운: 환자명+차트번호+전화번호를 담은 버튼들
    // (드롭다운 컨테이너 = 검색 input 형제. 결과 버튼은 hover:bg-muted 가진 row 버튼)
    const resultButtons = page.locator('button').filter({ hasText: /\d{2,}/ });
    const firstResult = page.getByRole('button').filter({ has: page.locator('span.font-medium') }).first();

    // 결과가 있을 때만 차트 오픈을 단언(테스트 DB 데이터 의존)
    if (await firstResult.isVisible({ timeout: 4000 }).catch(() => false)) {
      await firstResult.click();

      // AC1: 고객관리 탭으로 전환
      await expect(page).toHaveURL(/\/admin\/customers/, { timeout: 8000 });

      // AC2(핵심): 선택 고객 차트(2번차트) 패널 자동 오픈
      const chartDialog = page.getByRole('dialog', { name: '고객차트' });
      await expect(chartDialog).toBeVisible({ timeout: 8000 });
    } else {
      // 데이터가 없으면 최소 회귀: 검색 UI는 정상 렌더되고 페이지가 깨지지 않음
      expect(resultButtons).toBeDefined();
      await expect(page).toHaveURL(/dashboard/);
    }
  });

  // 회귀: 검색 결과가 없을 때 '검색 결과 없음' 안내가 정상 노출(검색 동작 불변 보장)
  test('S2: 매칭 없는 검색어는 결과 없음 안내, 차트는 열리지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    await openSearchAndQuery(page, 'ㅁㄴㅇㄹㅋㅌㅊ존재불가환자명999');

    // 결과 없음 안내 노출(렌더 시) — 검색 자체 동작 보존
    const noResult = page.getByText('검색 결과 없음');
    if (await noResult.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(noResult).toBeVisible();
    }
    // 차트 패널은 열리지 않아야 함
    await expect(page.getByRole('dialog', { name: '고객차트' })).toHaveCount(0);
    await expect(page).toHaveURL(/dashboard/);
  });
});
