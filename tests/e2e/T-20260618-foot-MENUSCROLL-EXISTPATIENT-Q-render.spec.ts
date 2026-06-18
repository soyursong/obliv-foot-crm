/**
 * E2E 실렌더 spec — T-20260618-foot-MENUSCROLL-EXISTPATIENT-Q (P2) — desktop-chrome(auth, storageState)
 *
 * 단계별 브라우저 렌더 확인 의무 + planner 지시("실 렌더로 잘림 지점 직접 특정"):
 *   정적 소스 가드(본 티켓 동명 spec)만으로는 '현장 미체감'을 못 잡았으므로,
 *   실제 Chromium 렌더에서 ③ '직원별 당월 누적'이 페이지 자체 스크롤로 도달 가능한지 직접 검증한다.
 *
 * 검증 사슬:
 *   AdminLayout page-content-area(overflow-hidden) → Assignments 최상위 div(h-full overflow-auto)
 *   → 3개 카드(①42vh+②32vh+③32vh) 합산이 viewport(800px) 초과 → 최상위 div가 자체 스크롤.
 *   AC-1: scroll-root 컨테이너 scrollHeight > clientHeight (스크롤 발생).
 *   AC-2: ③ 카드를 스크롤로 뷰포트 안에 끌어올려 열람 가능.
 *   AC-3: 콘텐츠가 짧지 않을 때만 스크롤(overflow-auto) — 짧으면 비노출(정적 spec에서 overflow-auto 보증).
 *   AC-4: 탭 전환(상담↔치료) 후에도 ③ 도달 가능(회귀 없음).
 */
import { test, expect } from '@playwright/test';

test.describe('MENUSCROLL-EXISTPATIENT-Q — 배정화면 페이지 자체 세로 스크롤 실렌더', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/assignments');
    await page.waitForLoadState('networkidle');
    // 역할 탭이 떠야 페이지가 정상 마운트된 것
    await expect(page.locator('[data-testid="assignments-role-tabs"]')).toBeVisible({ timeout: 20_000 });
  });

  test('AC-1: [치료] 탭에서 최상위 컨테이너가 실제로 세로 스크롤 가능(scrollHeight > clientHeight)', async ({ page }) => {
    await page.locator('[data-testid="assignments-tab-therapy"]').click();
    const root = page.locator('[data-testid="assignments-scroll-root"]');
    await expect(root).toBeVisible();

    const metrics = await root.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));

    // 3개 카드(106vh+헤더/탭) > viewport 800px → 콘텐츠가 컨테이너를 초과해야 함
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    // overflow-auto → computed overflowY 는 auto (스크롤 가능, 항상노출 scroll 아님)
    expect(metrics.overflowY).toBe('auto');
  });

  test("AC-2: ③ '직원별 당월 누적' 카드가 페이지 스크롤로 뷰포트 안에 도달(열람 가능)", async ({ page }) => {
    await page.locator('[data-testid="assignments-tab-therapy"]').click();
    const monthly = page.locator('[data-testid="assignments-monthly-card"]');
    await expect(monthly).toBeAttached();

    // 스크롤 전: fold 아래라 뷰포트 밖일 수 있음. 스크롤로 끌어올림.
    await monthly.scrollIntoViewIfNeeded();

    // 스크롤 후 카드가 실제로 뷰포트 안에 들어왔는지(부모 overflow-hidden 클립 해소) 확인
    await expect(monthly).toBeInViewport({ timeout: 5_000 });
    await expect(monthly.getByText('직원별 당월 누적')).toBeVisible();

    await page.screenshot({
      path: 'evidence/T-20260618-foot-MENUSCROLL-EXISTPATIENT-Q_therapy-monthly-reached.png',
      fullPage: false,
    });
  });

  test('AC-4: [상담] 탭에서도 ③ 카드 스크롤 도달(탭 회귀 없음)', async ({ page }) => {
    await page.locator('[data-testid="assignments-tab-consult"]').click();
    const monthly = page.locator('[data-testid="assignments-monthly-card"]');
    await monthly.scrollIntoViewIfNeeded();
    await expect(monthly).toBeInViewport({ timeout: 5_000 });
  });
});
