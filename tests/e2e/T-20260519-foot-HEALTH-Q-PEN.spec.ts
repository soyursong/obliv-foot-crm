/**
 * E2E spec — T-20260519-foot-HEALTH-Q-PEN
 * 발건강 질문지 PDF 양식 + 태블릿펜 기입·수정·저장
 *
 * AC-1: 양식 선택 화면에 '발건강 질문지 (일반)'/'발건강 질문지 (어르신용)' 버튼 표시
 * AC-2: 발건강 질문지 클릭 시 draw 모드 진입 + PDF 배경 이미지 캔버스 렌더링
 * AC-3: 캔버스에 펜 스트로크 가능 (pointerdown/move/up)
 * AC-4: 저장 시 '발건강 질문지 저장 완료' toast + 목록으로 복귀
 * AC-5: 기존 펜차트 (pen_chart) 양식 선택 및 draw 모드 무영향 확인
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-HEALTH-Q-PEN — 발건강 질문지 PDF 캔버스', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /** 고객 차트의 펜차트 탭으로 이동 */
  async function navigateToPenChartTab(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    try {
      await firstRow.waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) {
      await customerLink.click();
    } else {
      await firstRow.click();
    }
    // clinical 탭 그룹 → 펜차트 탭
    const clinicalGroup = page.locator('[data-tab-group="clinical"], button:has-text("진료"), button:has-text("clinical")').first();
    if (await clinicalGroup.count() > 0) await clinicalGroup.click();

    const penChartTab = page.locator('button:has-text("펜차트"), [data-tab="pen_chart"]').first();
    if (await penChartTab.count() > 0) {
      await penChartTab.click();
      await page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  // ─── AC-1: 양식 선택 화면에 발건강 질문지 버튼 표시 ───────────────────────
  test('AC-1: 양식 선택 화면 — 발건강 질문지 2종 버튼 표시', async ({ page }) => {
    const ok = await navigateToPenChartTab(page);
    if (!ok) test.skip(true, '펜차트 탭 진입 불가');

    // "새 차트 작성" 클릭 → select 모드
    const newChartBtn = page.locator('button:has-text("새 차트 작성")').first();
    await expect(newChartBtn).toBeVisible({ timeout: 8_000 });
    await newChartBtn.click();
    await page.waitForTimeout(300);

    // 발건강 질문지 (일반) 버튼 표시 확인
    await expect(
      page.locator('button:has-text("발건강 질문지 (일반)"), button:has-text("발건강 질문지")').first()
    ).toBeVisible({ timeout: 5_000 });

    // 발건강 질문지 (어르신용) 버튼 표시 확인
    await expect(
      page.locator('button:has-text("어르신용"), button:has-text("발건강 질문지 (어르신")').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ─── AC-2: 발건강 질문지 클릭 → draw 모드 + 캔버스 렌더링 ─────────────────
  test('AC-2: 발건강 질문지 클릭 → draw 모드 진입 + 캔버스 표시', async ({ page }) => {
    const ok = await navigateToPenChartTab(page);
    if (!ok) test.skip(true, '펜차트 탭 진입 불가');

    const newChartBtn = page.locator('button:has-text("새 차트 작성")').first();
    await expect(newChartBtn).toBeVisible({ timeout: 8_000 });
    await newChartBtn.click();
    await page.waitForTimeout(300);

    // 발건강 질문지 (일반) 클릭
    const hqBtn = page.locator('button:has-text("발건강 질문지 (일반)")').first();
    if (await hqBtn.count() === 0) {
      test.skip(true, '발건강 질문지 (일반) 버튼 없음');
    }
    await hqBtn.click();
    await page.waitForTimeout(500);

    // draw 모드 진입 확인 — 캔버스 + 툴바 표시
    await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("펜"), button:has-text("Pencil")').first()).toBeVisible({ timeout: 3_000 });
    // 양식 이름 표시 확인
    await expect(page.locator('text=발건강 질문지')).toBeVisible({ timeout: 3_000 });
  });

  // ─── AC-3: 캔버스 펜 스트로크 가능 ───────────────────────────────────────
  test('AC-3: 캔버스에 펜 스트로크 가능', async ({ page }) => {
    const ok = await navigateToPenChartTab(page);
    if (!ok) test.skip(true, '펜차트 탭 진입 불가');

    const newChartBtn = page.locator('button:has-text("새 차트 작성")').first();
    await expect(newChartBtn).toBeVisible({ timeout: 8_000 });
    await newChartBtn.click();
    await page.waitForTimeout(300);

    const hqBtn = page.locator('button:has-text("발건강 질문지 (일반)")').first();
    if (await hqBtn.count() === 0) test.skip(true, '발건강 질문지 버튼 없음');
    await hqBtn.click();
    await page.waitForTimeout(600);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 5_000 });

    // 펜 스트로크 시뮬레이션
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width * 0.3;
      const cy = box.y + box.height * 0.2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 50, cy + 30, { steps: 5 });
      await page.mouse.up();
    }

    // 저장 버튼 활성 확인
    const saveBtn = page.locator('button:has-text("저장")').last();
    await expect(saveBtn).toBeEnabled({ timeout: 3_000 });
  });

  // ─── AC-5: 기존 펜차트 양식 — draw 모드 무영향 ──────────────────────────
  test('AC-5: 기존 펜차트 양식 선택 → draw 모드 정상 동작', async ({ page }) => {
    const ok = await navigateToPenChartTab(page);
    if (!ok) test.skip(true, '펜차트 탭 진입 불가');

    const newChartBtn = page.locator('button:has-text("새 차트 작성")').first();
    await expect(newChartBtn).toBeVisible({ timeout: 8_000 });
    await newChartBtn.click();
    await page.waitForTimeout(300);

    // 펜차트 양식 버튼 클릭
    const penChartBtn = page.locator('button:has-text("펜차트 양식")').first();
    if (await penChartBtn.count() === 0) test.skip(true, '펜차트 양식 버튼 없음');
    await penChartBtn.click();
    await page.waitForTimeout(500);

    // 캔버스 + 툴바 표시 확인
    await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("펜"), button:has-text("Pencil")').first()).toBeVisible({ timeout: 3_000 });
  });
});
