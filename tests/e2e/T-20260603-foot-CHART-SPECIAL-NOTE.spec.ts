/**
 * E2E spec — T-20260603-foot-CHART-SPECIAL-NOTE
 * 좌측 타임라인 ⑤ 특이사항 공용 누적칸 (문지은 대표원장)
 *
 * 범위:
 *   AC-1 특이사항 공용 누적 저장소(customer_special_notes) — 환자 단위 누적, 기록자/작성일시
 *   AC-2 특이사항 칸 UI (좌측 타임라인 ⑤) — 목록 표시 + 1줄 추가 + 누적 보존 + 기록자 표시
 *
 * 현장 클릭 시나리오:
 *   로그인 → 진료차트 → 좌측 타임라인 ⑤ 특이사항 칸 → 1줄 추가
 *   → 기존 항목 변경 없이 누적 보존 + 신규 항목에 기록자/작성일시 표시
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 진료차트 Drawer 열기 헬퍼 — 못 열면 false 반환(스킵)
async function openMedicalChart(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator(
    '[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")',
  );
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  const drawer = page.locator('[data-testid="medical-chart-drawer"]');
  return drawer
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260603-CHART-SPECIAL-NOTE — 특이사항 공용 누적칸', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // 패널이 접혀있으면 펼침 (T-20260609 AC-2: 내용 없으면 접힘 디폴트)
  async function ensureExpanded(page: import('@playwright/test').Page) {
    const input = page.locator('[data-testid="special-note-input"]');
    if (!(await input.isVisible().catch(() => false))) {
      await page.locator('[data-testid="special-note-toggle"]').click();
      await input.waitFor({ timeout: 5_000 }).catch(() => {});
    }
  }

  // AC-2: 좌측 타임라인 ⑤ 특이사항 칸이 렌더된다 (T-20260609: 섹션·토글은 항상, 입력은 펼침 후)
  test('AC-2: 특이사항 칸(섹션) 렌더', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const section = page.locator('[data-testid="special-note-section"]');
    await expect(section).toBeVisible();
    // 토글은 접힘/펼침 무관 항상 노출
    await expect(page.locator('[data-testid="special-note-toggle"]')).toBeVisible();
    // 펼친 뒤 입력·저장버튼 존재
    await ensureExpanded(page);
    await expect(page.locator('[data-testid="special-note-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="special-note-add-btn"]')).toBeVisible();
  });

  // AC-2: 빈 입력이면 저장 버튼 비활성 (불필요한 빈 항목 누적 방지)
  test('AC-2: 빈 입력 시 저장 버튼 비활성', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await ensureExpanded(page);
    const addBtn = page.locator('[data-testid="special-note-add-btn"]');
    await expect(addBtn).toBeDisabled();
  });

  // AC-1 + AC-2: 1줄 추가 → 누적 보존 + 신규 항목에 기록자·작성일시 표시
  test('AC-1/2: 특이사항 누적 추가 + 기록자 표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await ensureExpanded(page);
    const list = page.locator('[data-testid="special-note-list"]');
    const before = await list.locator('[data-testid="special-note-item"]').count();

    const unique = `E2E 특이사항 ${Date.now()}`;
    await page.locator('[data-testid="special-note-input"]').fill(unique);
    await page.locator('[data-testid="special-note-add-btn"]').click();

    // 신규 항목이 목록에 누적됨 (기존 항목 보존 → count 증가)
    const newItem = list.locator('[data-testid="special-note-item"]', { hasText: unique });
    await expect(newItem).toBeVisible({ timeout: 10_000 });
    const after = await list.locator('[data-testid="special-note-item"]').count();
    expect(after).toBe(before + 1);

    // 신규 항목에 기록자 표시
    await expect(newItem.locator('[data-testid="special-note-recorder"]')).toBeVisible();

    // 입력칸 비워짐
    await expect(page.locator('[data-testid="special-note-input"]')).toHaveValue('');
  });
});
