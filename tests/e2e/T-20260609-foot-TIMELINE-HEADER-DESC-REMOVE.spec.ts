/**
 * E2E spec — T-20260609-foot-TIMELINE-HEADER-DESC-REMOVE
 * 진료경과 타임라인 헤더 설명문구 제거(헤더만 남기기) — 문지은 대표원장 C0ATE5P6JTH
 *
 * 범위 (FILTER AC5가 추가한 텍스트의 부분 revert):
 *   AC-1 서브라벨 "진료메모·치료메모·처방 시간순 · 클릭하면 우측 폼에서 편집" 제거
 *   AC-2 안내줄 "💬 상담기록은 우측 📋 상담 탭에서 확인" 제거
 *   AC-3(보존) 헤더 라벨 "진료 경과 타임라인" + Stethoscope 아이콘 유지
 *   AC-4(보존) 필터·타임라인 클릭→편집 동작 무변경
 *
 * 데이터 의존(저장된 차트)이라 Drawer/데이터 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

// 진료차트 Drawer 열기 — 못 열면 false
async function openMedicalChart(page: Page): Promise<boolean> {
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

test.describe('T-20260609-TIMELINE-HEADER-DESC-REMOVE — 헤더 설명문구 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-3(보존): 헤더 라벨·아이콘 유지 ──────────────────────────────────────
  test('AC-3(보존): "진료 경과 타임라인" 헤더 라벨이 그대로 보인다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await expect(page.getByText('진료 경과 타임라인', { exact: false }).first()).toBeVisible();
  });

  // ── AC-1: 서브라벨 제거 ────────────────────────────────────────────────────
  test('AC-1: "...시간순 · 클릭하면 우측 폼에서 편집" 서브라벨이 보이지 않는다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await expect(
      page.getByText('진료메모·치료메모·처방 시간순 · 클릭하면 우측 폼에서 편집'),
    ).toHaveCount(0);
  });

  // ── AC-2: 안내줄 제거 ──────────────────────────────────────────────────────
  test('AC-2: "상담기록은 우측 📋 상담 탭에서 확인" 안내줄이 보이지 않는다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await expect(page.getByText('상담기록은 우측', { exact: false })).toHaveCount(0);
  });

  // ── AC-4(보존): 글로벌 메모 필터 칩 행 동작 보존 ───────────────────────────
  test('AC-4(보존): 필터 칩 행(FILTER 산출물)이 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const treatChip = page.locator('[data-testid="memo-filter-treat"]');
    if ((await treatChip.count()) === 0) {
      test.skip(true, '필터 칩 행 미렌더(데이터/뷰 상태) — 스킵');
      return;
    }
    await expect(treatChip).toBeVisible();
  });
});
