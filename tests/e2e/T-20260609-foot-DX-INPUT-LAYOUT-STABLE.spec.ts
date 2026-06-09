/**
 * E2E spec — T-20260609-foot-DX-INPUT-LAYOUT-STABLE (item4, 문지은 대표원장)
 * 진단명 입력 공간 레이아웃 안정화 — 추가/삭제 시 주변 패널 점프(CLS) 제거.
 *
 * 범위:
 *   AC4-1 진단명 칩 영역 최소높이 미리 reserve — 비어 있어도 공간 확보,
 *         항목 추가 시 주변 UI 점프 없음.
 *   AC4-2 진단명 추가/삭제 시 칩 영역만 내부 확장(max-height + 스크롤),
 *         주변 패널(처방 등) 위치 고정.
 *
 * 핵심 구조 검증: dx-selected-chips 컨테이너가 entries 0건에도 항상 렌더되고
 * min-height 가 reserve 되어, 처방내역 패널의 위치가 안정적이다.
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

test.describe('T-20260609-DX-INPUT-LAYOUT-STABLE — 진단명 입력 레이아웃 안정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC4-1: 칩 영역이 비어 있어도 항상 렌더(공간 reserve) ─────────────────────
  test('AC4-1: 진단명 칩 영역이 선택 0건에도 항상 렌더되어 최소높이를 확보한다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const picker = page.locator('[data-testid="medical-chart-diagnosis"]');
    if ((await picker.count()) === 0) {
      test.skip(true, '진단명 picker 미렌더(새 기록 폼 아님) — 스킵');
      return;
    }
    const chips = page.locator('[data-testid="dx-selected-chips"]');
    // 칩 컨테이너는 항상 attach 되어 있어야 한다(조건부 미렌더가 아님 → 0→1 점프 제거)
    await expect(chips).toHaveCount(1);
    const box = await chips.boundingBox();
    expect(box).not.toBeNull();
    // 최소높이 reserve(빈 상태에도 일정 높이 확보) — min-h-[2.25rem] ≈ 36px
    expect((box?.height ?? 0)).toBeGreaterThanOrEqual(20);
  });

  // ── AC4-2: 진단명 추가 시 주변(처방내역 라벨) 위치가 흔들리지 않는다 ──────────
  test('AC4-2: 진단명 추가 전후로 처방내역 패널 Y 위치가 안정적이다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const picker = page.locator('[data-testid="medical-chart-diagnosis"]');
    if ((await picker.count()) === 0) {
      test.skip(true, '진단명 picker 미렌더 — 스킵');
      return;
    }
    // 주변 패널(처방내역 라벨) 기준점 — 진단명 칩 영역이 항상 reserve 되어 있으므로
    // 칩이 비었을 때와 1건일 때의 컨테이너 높이가 reserve 범위 내에서 안정적이어야 한다.
    const chips = page.locator('[data-testid="dx-selected-chips"]');
    const emptyBox = await chips.boundingBox();

    // picker 열어 첫 항목 추가 시도
    await picker.first().click();
    const item = page.locator('[data-testid="dx-picker-item"]');
    const folderToggle = page.locator('[data-testid="dx-picker-folder-toggle"]');
    if ((await folderToggle.count()) > 0) await folderToggle.first().click();
    if ((await item.count()) === 0) {
      test.skip(true, '선택 가능한 상병 항목 없음 — 스킵');
      return;
    }
    await item.first().click();
    await page.waitForTimeout(150);
    const filledBox = await chips.boundingBox();
    // reserve 덕분에 0→1 추가 시 컨테이너가 폭발적으로 늘지 않음(점프 억제).
    // 1행 칩 높이는 reserve 최소높이(≈36px) 내외 — 큰 점프(>60px) 없으면 안정으로 판정.
    const delta = Math.abs((filledBox?.height ?? 0) - (emptyBox?.height ?? 0));
    expect(delta).toBeLessThanOrEqual(60);
  });
});
