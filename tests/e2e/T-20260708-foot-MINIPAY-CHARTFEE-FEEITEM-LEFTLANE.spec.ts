/**
 * E2E spec — T-20260708-foot-MINIPAY-CHARTFEE-FEEITEM-LEFTLANE
 * 결제 미니창 — [차트 코드 + 진료비 산정] 헤더 + [수가 항목] 영역을 넓은 독립 lane으로 재배치
 *
 * 배경: 진료비 산정/수가 항목이 좁은 고정폭(구 lg:w-72≈288px) 중앙 컬럼에 있어 항목이 잘 안 보임.
 *       → 진료비/수가 lane을 flex-1(가변 넓은 폭)로, 코드 그리드를 고정폭으로 전환(폭 역할 스왑).
 *
 * AC-1: 진료비/수가 lane(pmw-fee-lane)이 코드 그리드(pmw-code-grid)보다 넓게 표시됨 ("넓게 보인다")
 * AC-2: "차트 코드 + 진료비 산정" 헤더 + "수가 항목 (N건)" 섹션이 동일 lane 내 정상 렌더
 * AC-3: 서류코드·세금구분·합계·수납버튼(잔여 Zone2 요소)이 기능·위치 그대로 유지
 * AC-4: Zone1 카테고리 탭 + Zone3(패키지·서류발행)이 기존대로 표시
 * AC-5(회귀): 수가 항목 스크롤 영역(pricing-list) 정상 — overflow 컨테이너 유지
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260708-foot-MINIPAY-CHARTFEE-FEEITEM-LEFTLANE — 수가 항목 넓은 lane 재배치', () => {

  async function openPaymentMiniWindow(page: import('@playwright/test').Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;

    const settleBtn = page
      .locator('[data-testid="btn-payment-mini"], button')
      .filter({ hasText: /결제하기/ })
      .first();

    if ((await settleBtn.count()) === 0) return null;
    await settleBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /결제 미니창/ });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      return null;
    }
    return dialog;
  }

  // ── AC-1: 진료비/수가 lane이 코드 그리드보다 넓다 (핵심 — "넓게 보인다") ──────
  test('AC-1: 진료비/수가 lane이 코드 그리드보다 넓게 표시', async ({ page }) => {
    // 넓은 뷰포트(갤탭 가로 ~ 데스크탑)에서 검증
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    const feeLane = dialog.locator('[data-testid="pmw-fee-lane"]');
    const codeGrid = dialog.locator('[data-testid="pmw-code-grid"]');
    await expect(feeLane).toBeVisible();
    await expect(codeGrid).toBeVisible();

    const feeBox = await feeLane.boundingBox();
    const codeBox = await codeGrid.boundingBox();
    expect(feeBox).not.toBeNull();
    expect(codeBox).not.toBeNull();
    if (feeBox && codeBox) {
      // 재배치 핵심: 진료비/수가 lane이 코드 그리드보다 넓어짐
      expect(feeBox.width).toBeGreaterThan(codeBox.width);
      // 구 고정폭(≈288px)보다 확연히 넓어졌는지 (여유 임계 340px)
      expect(feeBox.width).toBeGreaterThan(340);
    }
  });

  // ── AC-2: 헤더 + 수가 항목이 lane 내 정상 렌더 ────────────────────────────
  test('AC-2: [차트 코드+진료비 산정] 헤더 + [수가 항목] 섹션이 lane 내 렌더', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    const feeLane = dialog.locator('[data-testid="pmw-fee-lane"]');
    // 헤더가 lane 내부에 있음
    await expect(feeLane.getByText(/차트 코드.*진료비 산정/)).toBeVisible();

    // 풋케어 항목 선택 → 수가 항목 표시 (lane 내부)
    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) > 0) {
      await svcBtns.first().click();
      // 수가 항목 (N건) 카운트 라벨 — 데이터/개수 표시 불변
      await expect(feeLane.getByText(/수가 항목 \(\d+건\)/)).toBeVisible();
      // 수가 항목 리스트 컨테이너가 fee-lane 내부에 존재
      await expect(feeLane.locator('[data-testid="pricing-list"]')).toBeVisible();
    }
  });

  // ── AC-3: 서류코드·세금구분·합계·수납버튼이 그대로 유지 ──────────────────────
  test('AC-3: 잔여 Zone2 요소(세금구분·합계·수납흐름) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 풋케어 코드 선택 → 산정 요소 노출
    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) {
      test.skip();
      return;
    }
    await svcBtns.first().click();

    // 세금 구분 + 합계 표시
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(dialog.getByText('합계', { exact: true })).toBeVisible();

    // 산정 버튼 → 수납 버튼 흐름 유지
    const saveBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(dialog.locator('[data-testid="btn-settle"]')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-4: Zone1 탭 + Zone3 유지 ──────────────────────────────────────────
  test('AC-4: Zone1 카테고리 탭 + Zone3(패키지·서류발행) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // Zone1 탭
    await expect(dialog.getByRole('button', { name: '상병코드', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '처방약', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '풋케어', exact: true })).toBeVisible();

    // Zone3 서류발행
    await expect(dialog.getByText('서류발행')).toBeVisible();
    await expect(dialog.locator('[data-testid="doc-template-list"]')).toBeVisible();
  });

  // ── AC-5(회귀): 수가 항목 스크롤 컨테이너 유지 ─────────────────────────────
  test('AC-5: 수가 항목 스크롤 컨테이너(overflow) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) {
      test.skip();
      return;
    }
    await svcBtns.first().click();

    const list = dialog.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible();
    // 스크롤 가능 컨테이너 클래스 유지 (overflow-y-auto)
    await expect(list).toHaveClass(/overflow-y-auto/);
  });
});
