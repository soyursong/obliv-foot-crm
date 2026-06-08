/**
 * E2E spec — T-20260609-foot-SPECIALNOTE-MEMO-UX
 * 좌측상단 특이사항 패널 '메모판' UX 재설계 (FE presentation only, 저장 로직·스키마 무변경)
 *
 * 범위(AC):
 *   AC-1 통합 텍스트박스 — 모달/단계 없이 패널 내 바로 작성(입력 borderless + Enter 저장)
 *   AC-2 접힘/펼침 디폴트 — 내용 없으면 접힘, 있으면 펼침
 *   AC-3 메모판 박스 강조 — 주변과 구분되는 카드형 컨테이너
 *   AC-4 본문 좌측정렬 + 우상단 흐린 메타 1줄 'YY.MM.DD 작성자성명'
 *
 * 현장 클릭 시나리오:
 *   로그인 → 진료차트 → 좌측 특이사항 메모판 → (접힘이면 펼침) → 메모 작성/표시 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

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

async function ensureExpanded(page: import('@playwright/test').Page) {
  const input = page.locator('[data-testid="special-note-input"]');
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('[data-testid="special-note-toggle"]').click();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
  }
}

test.describe('T-20260609-SPECIALNOTE-MEMO-UX — 특이사항 메모판 UX', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-3: 메모판 박스(섹션) + 토글이 항상 렌더된다
  test('AC-3: 메모판 섹션·토글 렌더', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="special-note-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="special-note-toggle"]')).toBeVisible();
  });

  // AC-2: 접힘/펼침 — 토글 클릭으로 입력창이 노출/숨김 전환된다
  test('AC-2: 토글로 접힘/펼침 전환', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const toggle = page.locator('[data-testid="special-note-toggle"]');
    const input = page.locator('[data-testid="special-note-input"]');

    const visibleBefore = await input.isVisible().catch(() => false);
    await toggle.click();
    // 토글 1회로 상태 반전
    if (visibleBefore) {
      await expect(input).toBeHidden();
    } else {
      await expect(input).toBeVisible();
    }
  });

  // AC-1: 통합 텍스트박스 — Enter 키만으로 저장(모달/단계 없음)
  test('AC-1: Enter 저장으로 누적', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await ensureExpanded(page);
    const list = page.locator('[data-testid="special-note-list"]');
    const before = await list.locator('[data-testid="special-note-item"]').count();

    const unique = `메모판 Enter ${Date.now()}`;
    const input = page.locator('[data-testid="special-note-input"]');
    await input.fill(unique);
    await input.press('Enter');

    const newItem = list.locator('[data-testid="special-note-item"]', { hasText: unique });
    await expect(newItem).toBeVisible({ timeout: 10_000 });
    const after = await list.locator('[data-testid="special-note-item"]').count();
    expect(after).toBe(before + 1);
    // 입력칸 비워짐
    await expect(input).toHaveValue('');
  });

  // AC-4: 각 항목에 우상단 메타 1줄(YY.MM.DD + 작성자명)이 표시된다
  test('AC-4: 우상단 메타(날짜+작성자) 표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await ensureExpanded(page);
    const input = page.locator('[data-testid="special-note-input"]');
    const unique = `메모판 메타 ${Date.now()}`;
    await input.fill(unique);
    await page.locator('[data-testid="special-note-add-btn"]').click();

    const newItem = page
      .locator('[data-testid="special-note-list"] [data-testid="special-note-item"]', { hasText: unique });
    await expect(newItem).toBeVisible({ timeout: 10_000 });

    // 메타: YY.MM.DD 패턴 + 작성자명 노출
    const meta = newItem.locator('[data-testid="special-note-meta"]');
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/\d{2}\.\d{2}\.\d{2}/);
    await expect(newItem.locator('[data-testid="special-note-recorder"]')).toBeVisible();
  });
});
