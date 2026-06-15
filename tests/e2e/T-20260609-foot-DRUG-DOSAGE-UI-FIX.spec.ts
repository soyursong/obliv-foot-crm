/**
 * E2E spec — T-20260609-foot-DRUG-DOSAGE-UI-FIX (item8, 약쪽 긴급, 문지은 대표원장)
 * 처방 용법·횟수 입력 UI 정비.
 *
 * 범위:
 *   AC8-1 횟수 "회" 라벨을 숫자 입력 박스 바깥(suffix)으로 이동 — 박스 안에는 숫자만.
 *   AC8-2 용법 필드 UI 정비(별도 칸, 하드코딩 라벨 박스 바깥).
 *   AC8-3 ⚠ 저장값 회귀 금지 — 입력 박스(rx-count-input)에는 "회" 미포함, 숫자만.
 *         RxCountInput onChange 가 숫자만 저장(스키마/단위 불변)하는 구조 유지.
 *
 * RxCountInput 은 처방내역(formRx) 행에만 렌더 → 처방이 있는 차트 필요.
 * 데이터 부재 시 graceful skip.
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

test.describe('T-20260609-DRUG-DOSAGE-UI-FIX — 처방 용법·횟수 입력 UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC8-1/AC8-3: 횟수 입력 박스 안엔 숫자만(회 미포함) ──
  // ⚠ SUPERSEDED by T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN AC6 (문지은 대표원장, reporter-explicit):
  //   진료차트 처방내역 테이블은 "셀 숫자전용" 요청으로 '회' suffix 라벨까지 숨김(hideSuffix).
  //   따라서 차트 surface 에서는 suffix span 이 더 이상 렌더되지 않는다(부재가 정상). 박스 안 숫자전용(AC8-3)은 유지.
  //   ('회' suffix 자체는 처방세트/상용구 작성 패널 등 타 surface 에서는 종전대로 표시 — 그 검증은 해당 spec 소관.)
  test('AC8-1(superseded→AC6): 차트 처방내역에서 횟수 입력은 숫자만, "회" suffix 는 숨김', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const countInput = page.locator('[data-testid="rx-count-input"]');
    if ((await countInput.count()) === 0) {
      test.skip(true, '처방내역(횟수 입력) 있는 차트 없음 — 스킵');
      return;
    }
    // 입력 박스(input)에는 "회" 텍스트가 들어있지 않다(숫자만 — AC8-3 회귀 가드)
    const inputEl = countInput.first();
    await expect(inputEl).toHaveAttribute('type', 'number');
    const inputValue = await inputEl.inputValue();
    expect(inputValue).not.toContain('회');

    // RXTABLE AC6: 차트 처방내역 테이블의 '회' suffix 는 숨김 → 표시되지 않음
    await expect(page.locator('[data-testid="prescription-items-table"] [data-testid="rx-count-suffix"]')).toHaveCount(0);
  });

  // ── AC8-1/AC8-3: 횟수 입력 → 숫자만 보존(입력값에 "회" 안 붙음) ──────────────
  test('AC8-3: 횟수에 3 입력 시 input 값은 "3"(숫자만), "회"는 라벨로만', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const countInput = page.locator('[data-testid="rx-count-input"]').first();
    if ((await countInput.count()) === 0) {
      test.skip(true, '횟수 입력 없는 차트 — 스킵');
      return;
    }
    if (await countInput.isDisabled()) {
      test.skip(true, '읽기전용 차트 — 입력 불가 스킵');
      return;
    }
    await countInput.fill('3');
    // 박스 값은 순수 숫자 "3" (스키마/단위 불변)
    await expect(countInput).toHaveValue('3');
    expect(await countInput.inputValue()).not.toContain('회');
  });

  // ── AC8-2: 용법 필드가 별도 칸으로 분리되어 존재 ──────────────────────────────
  test('AC8-2: 용법 입력 필드(rx-frequency)가 횟수와 별도 칸으로 존재', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const freq = page.locator('[data-testid^="rx-frequency-"]');
    if ((await freq.count()) === 0) {
      test.skip(true, '용법 필드 있는 차트 없음 — 스킵');
      return;
    }
    await expect(freq.first()).toBeVisible();
    // 용법과 횟수가 동시에 별도 칸으로 존재
    await expect(page.locator('[data-testid="rx-count-input"]').first()).toBeVisible();
  });
});
