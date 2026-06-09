/**
 * E2E spec — T-20260609-foot-MEDCHART-SOAK-REFINE (AC3-3 + AC3-4, 문지은 대표원장)
 * 경과타임라인 처방내역 표기 정정 (본 batch 범위 = AC3-3/AC3-4).
 *
 * 범위 (planner MSG-20260609-181542-jn4m 명시):
 *   AC3-3 처방내역 = 검은색 미니멀 알약(Pill) 아이콘으로 표기("처방" 텍스트 헤더 대체).
 *   AC3-4 처방내역 항목마다 줄바꿈(말줄임 제거). 묶음처방(4건+)은 버튼 토글로 펼침/접기.
 *
 * ※ AC3-1(펼침/접기 라벨), AC3-2(헤더→컬러바), item1(특이사항), item2(필터 날짜보존)은
 *   본 batch 범위 외(planner 지시) — 이 spec 에서 검증하지 않음.
 *
 * 처방 있는 저장 차트 의존 → 데이터 부재 시 graceful skip.
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

// 처방이 있는 타임라인 엔트리를 펼쳐 처방 섹션 노출 → 해당 엔트리 반환(없으면 null)
async function expandEntryWithRx(page: Page) {
  const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
  const n = await entries.count();
  for (let i = 0; i < n; i++) {
    const e = entries.nth(i);
    const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
    if ((await toggle.count()) === 0) continue;
    await toggle.first().click();
    await page.waitForTimeout(150);
    if ((await e.locator('[data-testid="timeline-rx-section"]').count()) > 0) return e;
  }
  return null;
}

test.describe('T-20260609-MEDCHART-SOAK-REFINE — 타임라인 처방 표기 AC3-3/AC3-4', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC3-3: 처방내역에 검은색 미니멀 알약 아이콘 표기(텍스트 "처방" 헤더 대체) ──
  test('AC3-3: 처방 섹션에 알약 아이콘이 표기된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await expandEntryWithRx(page);
    if (!entry) {
      test.skip(true, '처방 있는 타임라인 엔트리 없음 — 스킵');
      return;
    }
    const pill = entry.locator('[data-testid="timeline-rx-pill-icon"]');
    await expect(pill.first()).toBeVisible();
  });

  // ── AC3-4: 처방 항목이 줄바꿈(말줄임 제거)으로 표기된다 ───────────────────────
  test('AC3-4: 처방 항목 li 에 truncate 말줄임이 없고 break-words 로 전체표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await expandEntryWithRx(page);
    if (!entry) {
      test.skip(true, '처방 있는 타임라인 엔트리 없음 — 스킵');
      return;
    }
    const rxItems = entry.locator('[data-testid="timeline-rx-item"]');
    await expect(rxItems.first()).toBeVisible();
    const cls = (await rxItems.first().getAttribute('class')) ?? '';
    expect(cls).not.toContain('truncate');
    expect(cls).toContain('break-words');
  });

  // ── AC3-4: 묶음처방(4건+)은 펼침/접기 토글 버튼으로 동작 ──────────────────────
  test('AC3-4: 묶음처방이면 펼침 토글이 노출되고 클릭 시 항목이 늘어난다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const n = await entries.count();
    for (let i = 0; i < n; i++) {
      const e = entries.nth(i);
      const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
      if ((await toggle.count()) === 0) continue;
      await toggle.first().click();
      await page.waitForTimeout(150);
      const bundleToggle = e.locator('[data-testid="timeline-rx-bundle-toggle"]');
      if ((await bundleToggle.count()) === 0) continue;
      // 묶음처방 발견 — 펼침 전후 항목 수 증가 확인
      const before = await e.locator('[data-testid="timeline-rx-item"]').count();
      await bundleToggle.first().click();
      await page.waitForTimeout(150);
      const after = await e.locator('[data-testid="timeline-rx-item"]').count();
      expect(after).toBeGreaterThan(before);
      return;
    }
    test.skip(true, '묶음처방(4건+) 엔트리 없음 — 스킵');
  });
});
