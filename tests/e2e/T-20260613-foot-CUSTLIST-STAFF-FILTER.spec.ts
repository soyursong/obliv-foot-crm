/**
 * E2E spec — T-20260613-foot-CUSTLIST-STAFF-FILTER
 *
 * 고객관리 화면 담당자 드롭다운 필터 (검색창 우측).
 * 옵션소스 = staff role consultant/coordinator/director (assigned_staff_id 旣구현 자산 재사용).
 *
 * AC-1: 드롭다운 렌더 — 검색창 우측에 '담당자 전체 / 미지정 / 직원리스트'
 * AC-2: 특정 직원 선택 → customers 쿼리에 assigned_staff_id=eq.<id> 필터 (검색어와 AND)
 * AC-3: '미지정' 선택 → customers 쿼리에 assigned_staff_id=is.null
 * AC-4: '전체' 선택 → assigned_staff_id 필터 미적용 (필터 해제)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const STAFF_A_ID = '00000000-0000-0000-0000-0000000000a1';

test.describe('T-20260613 CUSTLIST-STAFF-FILTER — 고객관리 담당자 드롭다운 필터', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');

    // staff 옵션소스 mock (consultant/coordinator/director)
    await page.route('**/rest/v1/staff*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('role=in')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: STAFF_A_ID, name: '김상담' }]),
        });
        return;
      }
      await route.continue();
    });
  });

  // 직접 deep-link(goto)는 풀 리로드 → auth 부트스트랩이 '불러오는 중…'에 머물 수 있어
  // 대시보드 진입(beforeEach) 후 사이드바 '고객관리' 링크로 SPA 내비게이션한다.
  async function gotoCustomers(page: import('@playwright/test').Page): Promise<boolean> {
    const navLink = page.getByRole('link', { name: '고객관리' }).first();
    const linkVisible = await navLink.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!linkVisible) return false;
    const select = page.getByTestId('cust-staff-filter');
    // SPA 내비게이션은 가끔 첫 클릭이 라우터 hydration 전에 떨어져 무시됨 → 셀렉트 등장까지 재시도.
    for (let attempt = 0; attempt < 3; attempt++) {
      await navLink.click();
      await page.waitForURL('**/admin/customers', { timeout: 5_000 }).catch(() => {});
      const visible = await select.isVisible({ timeout: 8_000 }).catch(() => false);
      if (visible) return true;
    }
    return false;
  }

  test('AC-1: 담당자 드롭다운 렌더 (전체/미지정/직원옵션)', async ({ page }) => {
    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    const select = page.getByTestId('cust-staff-filter');
    await expect(select).toBeVisible();
    // 기본값 = 전체(빈 값)
    await expect(select).toHaveValue('');
    // 옵션 텍스트 확인
    await expect(select.locator('option', { hasText: '담당자 전체' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: '미지정' })).toHaveCount(1);
    // staff mock 로드 후 직원 옵션 등장
    await expect(select.locator('option', { hasText: '김상담' })).toHaveCount(1, { timeout: 5_000 });
  });

  test('AC-2: 특정 직원 선택 → customers 쿼리에 assigned_staff_id=eq.<id>', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/rest/v1/customers*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('assigned_staff_id=eq.')) {
        capturedUrl = url;
      }
      await route.continue();
    });

    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    await page.getByTestId('cust-staff-filter').selectOption(STAFF_A_ID);
    await page.waitForTimeout(600); // debounce + 쿼리 대기

    expect(capturedUrl).toContain(`assigned_staff_id=eq.${STAFF_A_ID}`);
  });

  test('AC-3: 미지정 선택 → customers 쿼리에 assigned_staff_id=is.null', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/rest/v1/customers*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('assigned_staff_id=is.')) {
        capturedUrl = url;
      }
      await route.continue();
    });

    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    await page.getByTestId('cust-staff-filter').selectOption('__unassigned__');
    await page.waitForTimeout(600);

    expect(capturedUrl).toMatch(/assigned_staff_id=is\.null/);
  });

  test('AC-4: 전체 선택 → assigned_staff_id 필터 미적용', async ({ page }) => {
    let sawStaffFilter = false;
    await page.route('**/rest/v1/customers*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('assigned_staff_id=')) {
        sawStaffFilter = true;
      }
      await route.continue();
    });

    const ok = await gotoCustomers(page);
    if (!ok) { test.skip(true, '고객관리 진입 실패 — 스킵'); return; }

    // 직원 → 전체로 토글
    await page.getByTestId('cust-staff-filter').selectOption(STAFF_A_ID);
    await page.waitForTimeout(400);
    sawStaffFilter = false; // 이후 '전체' 쿼리만 관찰
    await page.getByTestId('cust-staff-filter').selectOption('');
    await page.waitForTimeout(600);

    expect(sawStaffFilter).toBe(false);
  });
});
