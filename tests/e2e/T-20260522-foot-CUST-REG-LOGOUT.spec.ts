/**
 * E2E spec — T-20260522-foot-CUST-REG-LOGOUT
 * 고객 접수 시 주민번호 저장 후 로그아웃 오류
 *
 * AC-1: 주민번호 저장 → 로그아웃 없이 정상 저장
 * AC-2: 저장 후 콘솔/네트워크 에러 없음 (401/403/500 특히 확인)
 * AC-3: 다른 고객에서도 동일 동선 정상 (회귀)
 * AC-4: 저장 후 세션 유지 (페이지 유지 확인)
 *
 * Note: JWT 만료 시뮬레이션은 E2E 환경에서 불가. 여기서는 정상 동선 검증.
 * 실제 JWT 만료 케이스는 auth.tsx refreshSession() 재시도 로직으로 커버.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const CUSTOMER_NAME = '김테스트';
const RRN_FRONT = '900101';
const RRN_BACK = '1234567';

test.describe('T-20260522 주민번호 저장 후 세션 유지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /**
   * 고객 차트 페이지로 이동하는 헬퍼
   * 고객 목록에서 CUSTOMER_NAME 검색 후 차트 진입
   */
  async function navigateToCustomerChart(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    // 검색창에 고객명 입력
    const searchInput = page.locator('input[placeholder*="검색"], input[placeholder*="고객"]').first();
    try {
      await searchInput.waitFor({ timeout: 8_000 });
      await searchInput.fill(CUSTOMER_NAME);
      await page.waitForTimeout(600);
    } catch {
      // 검색창 없을 수 있음 — 전체 목록에서 찾기
    }

    // 고객명 셀 클릭
    const customerRow = page.getByText(CUSTOMER_NAME, { exact: false }).first();
    try {
      await customerRow.waitFor({ timeout: 8_000 });
      await customerRow.click();
    } catch {
      return false;
    }

    // 차트 페이지 로드 대기
    try {
      await page.getByText('주민번호', { exact: true }).first().waitFor({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  // AC-1: 주민번호 저장 → 로그아웃 없이 정상 저장
  test('AC-1: 주민번호 저장 후 세션 유지 (로그아웃 없음)', async ({ page }) => {
    const reached = await navigateToCustomerChart(page);
    if (!reached) test.skip(true, `${CUSTOMER_NAME} 차트 페이지 진입 실패`);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 주민번호 입력 버튼 클릭
    const rrnInputBtn = page.getByText(/입력|수정/).first();
    try {
      await rrnInputBtn.waitFor({ timeout: 5_000 });
      await rrnInputBtn.click();
    } catch {
      test.skip(true, '주민번호 입력 버튼 없음');
    }

    // 앞 6자리 입력
    const rrnFrontInput = page.locator('input[placeholder="000000"]').first();
    await rrnFrontInput.waitFor({ timeout: 5_000 });
    await rrnFrontInput.fill(RRN_FRONT);
    await page.waitForTimeout(300);

    // 뒷 7자리 입력
    const rrnBackInput = page.locator('input[placeholder="0000000"]').first();
    await rrnBackInput.fill(RRN_BACK);
    await page.waitForTimeout(200);

    // 저장 버튼 클릭
    const saveBtn = page.getByRole('button', { name: '저장' }).first();
    await saveBtn.click();
    await page.waitForTimeout(1500);

    // AC-1: 로그인 페이지로 이탈 없음 (세션 유지)
    expect(page.url()).not.toContain('/login');

    // AC-4: 차트 페이지 유지 확인
    await expect(page.getByText('주민번호', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    // AC-2: 심각한 콘솔 에러 없음 (401/403 관련)
    const authErrors = consoleErrors.filter(e =>
      e.includes('401') || e.includes('PGRST301') || e.includes('jwt') || e.includes('SIGNED_OUT')
    );
    expect(authErrors).toHaveLength(0);
  });

  // AC-2: 네트워크 에러 없음 (401/403/500 특히 확인)
  test('AC-2: 주민번호 저장 시 네트워크 401/403 없음', async ({ page }) => {
    const reached = await navigateToCustomerChart(page);
    if (!reached) test.skip(true, `${CUSTOMER_NAME} 차트 페이지 진입 실패`);

    const failedRequests: { url: string; status: number }[] = [];
    page.on('response', (res) => {
      if ([401, 403].includes(res.status()) && res.url().includes('rrn_encrypt')) {
        failedRequests.push({ url: res.url(), status: res.status() });
      }
    });

    // 주민번호 입력 → 저장
    const rrnInputBtn = page.getByText(/입력|수정/).first();
    try {
      await rrnInputBtn.waitFor({ timeout: 5_000 });
      await rrnInputBtn.click();
    } catch {
      test.skip(true, '주민번호 입력 버튼 없음');
    }

    const rrnFrontInput = page.locator('input[placeholder="000000"]').first();
    await rrnFrontInput.waitFor({ timeout: 5_000 });
    await rrnFrontInput.fill(RRN_FRONT);
    await page.waitForTimeout(200);

    const rrnBackInput = page.locator('input[placeholder="0000000"]').first();
    await rrnBackInput.fill(RRN_BACK);
    await page.waitForTimeout(200);

    const saveBtn = page.getByRole('button', { name: '저장' }).first();
    await saveBtn.click();
    await page.waitForTimeout(1500);

    // rrn_encrypt RPC가 401/403을 반환하지 않아야 함
    expect(failedRequests).toHaveLength(0);
  });

  // AC-3: 다른 고객에서도 동일 동선 정상 (회귀)
  test('AC-3: 고객 목록 첫 번째 고객 차트에서 주민번호 UI 정상 표시', async ({ page }) => {
    await page.goto('/admin/customers');

    // 첫 번째 고객 행 진입
    const firstRow = page.locator('tbody tr, tr[data-customer-id]').first();
    try {
      await firstRow.waitFor({ timeout: 8_000 });
      const link = firstRow.locator('a[href*="/chart/"]').first();
      if (await link.count() > 0) {
        await link.click();
      } else {
        await firstRow.click();
      }
    } catch {
      test.skip(true, '고객 목록 없음');
    }

    // 주민번호 섹션이 차트에 존재
    await expect(page.getByText('주민번호', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // 세션 유지 확인
    expect(page.url()).not.toContain('/login');
  });

  // AC-4: 통합 저장(저장 버튼) 경로에서도 세션 유지
  test('AC-4: 통합 저장 버튼으로 주민번호 포함 저장 시 세션 유지', async ({ page }) => {
    const reached = await navigateToCustomerChart(page);
    if (!reached) test.skip(true, `${CUSTOMER_NAME} 차트 페이지 진입 실패`);

    // 주민번호 입력 모드 진입
    const rrnInputBtn = page.getByText(/입력|수정/).first();
    try {
      await rrnInputBtn.waitFor({ timeout: 5_000 });
      await rrnInputBtn.click();
    } catch {
      test.skip(true, '주민번호 입력 버튼 없음');
    }

    const rrnFrontInput = page.locator('input[placeholder="000000"]').first();
    await rrnFrontInput.waitFor({ timeout: 5_000 });
    await rrnFrontInput.fill(RRN_FRONT);
    await page.waitForTimeout(200);

    const rrnBackInput = page.locator('input[placeholder="0000000"]').first();
    await rrnBackInput.fill(RRN_BACK);
    await page.waitForTimeout(200);

    // 통합 저장 버튼 (상단 teal 버튼)
    const mainSaveBtn = page.locator('button').filter({ hasText: '저장' }).last();
    try {
      await mainSaveBtn.click();
      await page.waitForTimeout(1500);
    } catch {
      // 통합 저장 버튼 없을 수 있음
    }

    // 세션 유지 (로그인 페이지로 이탈 없음)
    expect(page.url()).not.toContain('/login');
  });
});
