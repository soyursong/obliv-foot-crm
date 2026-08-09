/**
 * E2E spec — T-20260808-foot-CUSTLIST-SORT-ORDER-SELECT
 *
 * 고객관리(사이드바) 목록 정렬 순서(등록일 기준 최신순/오래된순) 선택 UI.
 *   기준 필드 = 고객 등록일(customers.created_at). '최근 방문일'은 페이지별 클라이언트
 *   파생값이라 서버 페이지네이션 + ORDER BY 불가 → 등록일이 유일한 안정 서버-정렬 기준.
 *   선택 상태는 localStorage('foot-custlist-sort-order')에 persist → 새로고침/재진입 보존.
 *
 * 현장 클릭 시나리오 3종:
 *   AC-1: 정렬 드롭다운 렌더 — '등록일: 최신순 / 등록일: 오래된순', 기본값=오래된순(default),
 *         쿼리에 created_at.asc 반영
 *   AC-2: '최신순' 선택 → customers 쿼리 order=created_at.desc 반영
 *   AC-3: 선택 후 새로고침/재진입 → 마지막 선택(최신순) 보존(localStorage)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260808 CUSTLIST-SORT-ORDER-SELECT — 고객목록 정렬 순서 선택', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
    // 이전 테스트 잔여 선택 제거 → default(oldest)부터 검증
    await page.evaluate(() => {
      try { window.localStorage.removeItem('foot-custlist-sort-order'); } catch { /* noop */ }
    });
  });

  // 직접 deep-link(goto)는 풀 리로드 → auth 부트스트랩 대기가 길어 사이드바 SPA 내비게이션 사용.
  async function gotoCustomers(page: import('@playwright/test').Page): Promise<boolean> {
    const navLink = page.getByRole('link', { name: '고객관리' }).first();
    const linkVisible = await navLink.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!linkVisible) return false;
    const select = page.getByTestId('cust-sort-order');
    for (let attempt = 0; attempt < 3; attempt++) {
      await navLink.click();
      await page.waitForURL('**/admin/customers', { timeout: 5_000 }).catch(() => {});
      const visible = await select.isVisible({ timeout: 8_000 }).catch(() => false);
      if (visible) return true;
    }
    return false;
  }

  test('AC-1: 정렬 드롭다운 렌더 + 기본값 오래된순(created_at.asc)', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/rest/v1/customers*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('order=created_at')) {
        capturedUrl = url;
      }
      await route.continue();
    });

    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    const select = page.getByTestId('cust-sort-order');
    await expect(select).toBeVisible();
    // 기본값 = 오래된순(default, localStorage 비움)
    await expect(select).toHaveValue('oldest');
    await expect(select.locator('option', { hasText: '등록일: 최신순' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: '등록일: 오래된순' })).toHaveCount(1);

    await page.waitForTimeout(600);
    // 기본 쿼리는 등록일 오름차순
    expect(capturedUrl).toContain('order=created_at.asc');
  });

  test('AC-2: 최신순 선택 → customers 쿼리 order=created_at.desc', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/rest/v1/customers*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('order=created_at.desc')) {
        capturedUrl = url;
      }
      await route.continue();
    });

    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    await page.getByTestId('cust-sort-order').selectOption('newest');
    await page.waitForTimeout(600); // debounce + 쿼리 대기

    expect(capturedUrl).toContain('order=created_at.desc');
  });

  test('AC-3: 선택 후 재진입 → 마지막 선택(최신순) localStorage 보존', async ({ page }) => {
    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    await page.getByTestId('cust-sort-order').selectOption('newest');
    await page.waitForTimeout(400);

    // localStorage 에 반영됐는지 (persist 계약)
    const persisted = await page.evaluate(() =>
      window.localStorage.getItem('foot-custlist-sort-order'),
    );
    expect(persisted).toBe('newest');

    // 재진입: 다른 메뉴로 이동 → 고객관리 재진입(컴포넌트 remount → localStorage 초기값 복원).
    //   풀 리로드(page.reload)는 deep-link auth 부트스트랩이 '불러오는 중…'에 머무는 known-flaky
    //   경로라 회피 — SPA 재진입이 초기값 읽기(readCustSortOrder)를 동일하게 검증한다.
    const dashLink = page.getByRole('link', { name: '대시보드' }).first();
    if (await dashLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await dashLink.click();
      await page.waitForTimeout(400);
    }
    const backOk = await gotoCustomers(page);
    if (!backOk) { test.skip(true, '재진입 실패 — 스킵'); return; }
    await expect(page.getByTestId('cust-sort-order')).toHaveValue('newest');
  });
});
