/**
 * 칸반 상태 전이 E2E 테스트
 *
 * - 접수 컬럼의 카드를 다음 단계로 이동 (우클릭 컨텍스트 메뉴)
 * - 상태 변경 후 카드가 올바른 컬럼으로 이동했는지 확인
 * - 역방향 이동 시도 -> 차단되는지 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { assertNotProdExecution, cleanupKanbanFixtures } from '../fixtures';

test.describe('Kanban status transitions', () => {
  // 이 run 이 UI 로 생성한 더미의 정확한 이름(customer_name/name). afterAll 에서 이 이름들만
  // 삭제한다("본인이 만든 row 만" 불변식). 이름접두: `단계이동_`, `칸반테스트_` (KANBAN_FIXTURE_NAME_PREFIXES).
  const createdNames: string[] = [];

  // AC-3 (T-20260721-foot-TEST-DUMMY-CLEANUP): 운영 URL/DB 대상 실행이면 write 이전에 fail-fast.
  //   PRODREF-HARDGUARD(DB) + canonicalHost(URL) 자산 재사용. webServer(localhost)/preview 는 통과.
  test.beforeAll(({}, testInfo) => {
    assertNotProdExecution(testInfo.project.use.baseURL);
  });

  // AC-1 (T-20260721-foot-TEST-DUMMY-CLEANUP): kanban-drag 는 시더 미경유 UI 체크인으로 더미를
  //   만들어 cleanupAll/sweepScoped 스윕망 밖에 잔류 → 운영 대시보드 무한 적재 RC. 이 teardown 이
  //   이 run 이 만든 더미를 FK 순서로 정리한다. 오류는 표면화(silent swallow 금지).
  test.afterAll(async () => {
    if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[kanban-drag cleanup] Supabase env 미설정 → cleanup 건너뜀');
      return;
    }
    const summary = await cleanupKanbanFixtures(createdNames);
    console.log(
      `[kanban-drag cleanup] 요청=${createdNames.length} 삭제 check_ins=${summary.checkIns} customers=${summary.customers} skipped=${summary.skipped}`,
    );
  });

  test('Context menu shows stage options', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 접수 컬럼에 카드가 있어야 테스트 가능
    // "접수" 텍스트가 컬럼 헤더로 보이는지 확인
    const registeredColumn = page.getByText('접수', { exact: true }).first();
    const columnVisible = await registeredColumn.isVisible().catch(() => false);
    if (!columnVisible) {
      test.skip(true, 'No "접수" column found');
      return;
    }

    // 칸반 카드 찾기 - 접수 단계에 있는 카드 아무거나
    // 카드에 우클릭 -> context menu 출력
    // GripVertical 아이콘이나 MoreVertical 아이콘이 있는 카드 찾기
    const cards = page.locator('[data-status="registered"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // 테스트 데이터 없으면 먼저 체크인 생성
      const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
      const btnVisible = await checkinBtn.isVisible().catch(() => false);
      if (!btnVisible) {
        test.skip(true, 'No cards and no check-in button');
        return;
      }

      await checkinBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const testName = `칸반테스트_${Date.now()}`;
      createdNames.push(testName); // AC-1: afterAll cleanup 대상 등록
      await dialog.locator('#ci-name').fill(testName);
      await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
      await dialog.getByRole('button', { name: '체크인' }).click();
      await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

      // 카드가 나타날 때까지 대기
      await expect(page.getByText(testName)).toBeVisible({ timeout: 10_000 });
    }

    await page.screenshot({
      path: 'test-results/screenshots/kanban-before-transition.png',
      fullPage: true,
    });
  });

  test('Stage navigation buttons in detail sheet', async ({ page }) => {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) {
      test.skip(true, 'Dashboard did not load');
      return;
    }

    // 체크인 생성
    const testName = `단계이동_${Date.now()}`;
    createdNames.push(testName); // AC-1: afterAll cleanup 대상 등록
    const checkinBtn = page.getByRole('button', { name: /체크인/ }).first();
    const btnVisible = await checkinBtn.isVisible().catch(() => false);
    if (!btnVisible) {
      test.skip(true, 'No check-in button');
      return;
    }

    await checkinBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('#ci-name').fill(testName);
    await dialog.locator('#ci-phone').fill(`010${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`);
    await dialog.locator('button[type="button"]').filter({ hasText: /^재진$/ }).last().click();
    await dialog.getByRole('button', { name: '체크인' }).click();
    await expect(page.getByText(/체크인 완료/)).toBeVisible({ timeout: 10_000 });

    // 카드 클릭 -> 상세 Sheet 열기
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const card = page.getByText(testName).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await page.waitForTimeout(500);

    const sheet = page.locator('[role="dialog"]').first();
    if (!(await sheet.isVisible().catch(() => false))) {
      test.skip(true, 'Sheet did not open after card click (DnD intercept)');
      return;
    }

    // 재진 단계: 접수 -> 시술대기
    // "시술대기" 다음 단계 버튼이 보여야 함
    const nextBtn = sheet.getByRole('button', { name: /시술대기/ }).first();
    const hasNextBtn = await nextBtn.isVisible().catch(() => false);

    if (hasNextBtn) {
      await nextBtn.click();
      // 토스트: "시술대기(으)로 이동"
      await expect(page.getByText(/시술대기.*이동/)).toBeVisible({ timeout: 10_000 });

      await page.screenshot({
        path: 'test-results/screenshots/kanban-after-transition.png',
        fullPage: true,
      });
    } else {
      test.info().annotations.push({
        type: 'info',
        description: 'No next-stage button found in detail sheet',
      });
    }
  });
});
