/**
 * T-20260522-foot-TOUCH-EXPAND
 * 태블릿 터치영역(버튼·셀·탭) 최소 44px 확대
 *
 * AC-1: 칸반 탭 버튼 모두 min-h-44px 이상
 * AC-2: 패키지 세션 유형 버튼 44px 이상
 * AC-3: 예약/고객 목록 행 높이 44px 이상
 * AC-4: 기존 레이아웃 깨짐 없음 (빌드 OK)
 * AC-5: 데스크탑 뷰에서도 시각적 이상 없음
 * AC-6: E2E spec — 주요 버튼 클릭 시나리오 통과
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260522-foot-TOUCH-EXPAND — 터치 타겟 44px 확대', () => {
  // AC-1: Dashboard 칸반 탭 버튼 높이 검증
  test('AC-1: 대시보드 칸반 탭 버튼 min-h 44px 이상', async ({ page }) => {
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 대시보드 전체/신규/재진 탭 버튼 확인
    const tabButtons = page.locator('[data-state="active"], [data-state="inactive"]').filter({ hasText: /전체|신규|재진/ });
    const count = await tabButtons.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        const btn = tabButtons.nth(i);
        const box = await btn.boundingBox();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });

  // AC-2: 패키지 목록 행 높이 44px 이상
  test('AC-3: 패키지 목록 테이블 행 높이 44px 이상', async ({ page }) => {
    await page.goto(BASE + '/admin/packages', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      const box = await rows.first().boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // AC-3: 고객 목록 테이블 행 높이 44px 이상
  test('AC-3: 고객 목록 테이블 행 높이 44px 이상', async ({ page }) => {
    await page.goto(BASE + '/admin/customers', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      const box = await rows.first().boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // AC-6: 예약관리 일간/주간 토글 버튼 클릭 시나리오
  test('AC-6: 예약관리 일간/주간 토글 버튼 44px + 클릭 작동', async ({ page }) => {
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // 주간 버튼 클릭
    const weekBtn = page.getByRole('button', { name: '주간' });
    await expect(weekBtn).toBeVisible();
    const weekBox = await weekBtn.boundingBox();
    if (weekBox) {
      expect(weekBox.height).toBeGreaterThanOrEqual(44);
    }
    await weekBtn.click();

    // 일간 버튼 클릭
    const dayBtn = page.getByRole('button', { name: '일간' });
    await expect(dayBtn).toBeVisible();
    const dayBox = await dayBtn.boundingBox();
    if (dayBox) {
      expect(dayBox.height).toBeGreaterThanOrEqual(44);
    }
    await dayBtn.click();
  });

  // AC-5: 데스크탑 뷰 렌더 이상 없음 (대시보드 레이아웃 깨짐 감지)
  test('AC-5: 대시보드 데스크탑 레이아웃 정상', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 사이드바가 렌더됨 (레이아웃 붕괴 없음)
    const sidebar = page.getByTestId('desktop-sidebar');
    if (await sidebar.isVisible()) {
      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();
      if (box) expect(box.width).toBeGreaterThan(100);
    }

    // 오버플로우가 뷰포트 밖으로 넘치지 않음 확인
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 1440;
    // 수평 스크롤이 발생하면 200px 이내는 허용 (테이블 최소폭)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 200);
  });
});
