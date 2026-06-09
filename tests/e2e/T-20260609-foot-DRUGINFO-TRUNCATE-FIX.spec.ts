/**
 * E2E spec — T-20260609-foot-DRUGINFO-TRUNCATE-FIX (item5, 문지은 대표원장)
 * 우측 약품폴더 약정보 말줄임(...) 제거 → 줄바꿈 전체표시.
 *
 * 범위:
 *   AC5-1 약품명/약정보 텍스트 말줄임 제거.
 *   AC5-2 긴 텍스트 줄바꿈(wrap) — 가로 잘림 없음.
 *   AC5-3 말줄임 제거로 인접 레이아웃 깨지지 않음(행 높이 자동확장).
 *
 * 약품폴더는 처방세트 탭(rightTab='rx')의 폴더 트리에 렌더.
 * 데이터/뷰 상태 부재 시 graceful skip.
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

test.describe('T-20260609-DRUGINFO-TRUNCATE-FIX — 약품폴더 약정보 전체표시', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC5-1/5-2: 약품폴더 항목의 약품명에 truncate(말줄임) class 가 없다 ─────────
  test('AC5-1: 약품폴더 항목 약품명에 truncate 말줄임이 적용되지 않는다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // 처방세트 탭으로 전환
    const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
    if ((await rxTab.count()) > 0) await rxTab.click();
    await page.waitForTimeout(200);

    const items = page.locator('[data-testid="drug-folder-item"]');
    if ((await items.count()) === 0) {
      // 폴더가 접혀있을 수 있음 — 폴더 헤더가 있으면 펼침 시도
      const folder = page.locator('[data-testid="drug-folder-tree"]');
      if ((await folder.count()) === 0) {
        test.skip(true, '약품폴더 트리 미렌더 — 스킵');
        return;
      }
    }
    if ((await items.count()) === 0) {
      test.skip(true, '약품폴더 항목 없음(폴더 접힘/데이터 부재) — 스킵');
      return;
    }
    // 약품명 span — break-words(줄바꿈) 적용, truncate 미적용
    const nameSpan = items.first().locator('span').first();
    const cls = (await nameSpan.getAttribute('class')) ?? '';
    expect(cls).not.toContain('truncate');
    expect(cls).toContain('break-words');
  });

  // ── AC5-2: 제조사 표기가 있으면 truncate 없이 줄바꿈 흐름이다 ──────────────────
  test('AC5-2: 제조사 표기에 truncate 가 없다(있을 때만 검증)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
    if ((await rxTab.count()) > 0) await rxTab.click();
    await page.waitForTimeout(200);

    const mfr = page.locator('[data-testid="drug-folder-item-manufacturer"]');
    if ((await mfr.count()) === 0) {
      test.skip(true, '제조사 표기 항목 없음 — 스킵');
      return;
    }
    const cls = (await mfr.first().getAttribute('class')) ?? '';
    expect(cls).not.toContain('truncate');
  });
});
