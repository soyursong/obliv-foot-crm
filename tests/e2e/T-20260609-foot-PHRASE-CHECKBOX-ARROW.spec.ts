/**
 * E2E spec — T-20260609-foot-PHRASE-CHECKBOX-ARROW (item6, 문지은 대표원장)
 * 상용구 체크박스 → 좌측 화살표 토글(패널 슬라이드 접힘/펼침).
 *
 * 범위:
 *   AC6-1 상용구 선택 체크박스 제거(행 클릭 → ✓ 토글 패턴, 체크박스 없음).
 *   AC6-2 우측 콘텐츠 패널 가장 왼쪽 여백에 미니멀 `<` 화살표 토글 배치.
 *   AC6-3 화살표 클릭 시 패널이 좌측으로 슬라이드 접힘(폭 축소), 다시 누르면 펼침.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

async function openMedicalChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator('[data-testid="open-chart-btn"]');
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  return page
    .locator('[data-testid="medical-chart-drawer"]')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260609-PHRASE-CHECKBOX-ARROW — 상용구 패널 화살표 토글', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC6-2: 우측 패널 왼쪽 여백에 접기/펼치기 화살표 토글이 존재 ──────────────
  test('AC6-2: 우측 패널 좌측에 접기/펼치기 화살표 토글이 있다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const toggle = page.locator('[data-testid="right-panel-collapse-toggle"]');
    await expect(toggle).toBeVisible();
    // 패널 좌측 가장자리에 위치(toggle.x ≈ panel.x)
    const panel = page.locator('[data-testid="medical-chart-right-panel"]');
    const tBox = await toggle.boundingBox();
    const pBox = await panel.boundingBox();
    expect(Math.abs((tBox?.x ?? 0) - (pBox?.x ?? 0))).toBeLessThanOrEqual(4);
  });

  // ── AC6-3: 화살표 클릭 시 패널이 접히고(폭 축소), 다시 누르면 펼쳐진다 ─────────
  test('AC6-3: 화살표 토글로 패널이 접힘/펼침된다(폭 변화)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const panel = page.locator('[data-testid="medical-chart-right-panel"]');
    const toggle = page.locator('[data-testid="right-panel-collapse-toggle"]');
    await expect(panel).toHaveAttribute('data-collapsed', 'false');
    const expandedWidth = (await panel.boundingBox())?.width ?? 0;

    // 접기
    await toggle.click();
    await page.waitForTimeout(300);
    await expect(panel).toHaveAttribute('data-collapsed', 'true');
    const collapsedWidth = (await panel.boundingBox())?.width ?? 0;
    expect(collapsedWidth).toBeLessThan(expandedWidth);

    // 다시 펼치기
    await toggle.click();
    await page.waitForTimeout(300);
    await expect(panel).toHaveAttribute('data-collapsed', 'false');
    const reExpandedWidth = (await panel.boundingBox())?.width ?? 0;
    expect(reExpandedWidth).toBeGreaterThan(collapsedWidth);
  });

  // ── AC6-1: 상용구 행에 체크박스(input[type=checkbox])가 없다 ───────────────────
  test('AC6-1: 상용구 탭의 행 선택 UI에 체크박스가 없다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const phraseTab = page.locator('[data-testid="right-panel-tab-phrase"]');
    if ((await phraseTab.count()) > 0) await phraseTab.click();
    await page.waitForTimeout(200);

    const options = page.locator('[data-testid="phrase-option"]');
    if ((await options.count()) === 0) {
      test.skip(true, '상용구 항목 없음 — 스킵');
      return;
    }
    // 상용구 행 내부에 type=checkbox 입력이 없어야 한다(✓ 토글 버튼 패턴)
    const checkboxes = options.first().locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(0);
  });
});
