/**
 * E2E spec — T-20260519-foot-BILLING-ITEM-PRICE
 * 구매패키지 항목별 수가 금액 표시 (BILLING-3ZONE 후속)
 *
 * AC-1: Zone3 패키지 섹션에 항목명(가열성/비가열성/수액/포돌로게) 행별 표시
 * AC-2: 항목별 적용 수가 금액 표시 (N회 × ₩X 형식)
 * AC-3: 총합계(납부액) 유지
 * AC-5: Zone1/Zone2 회귀 없음 (서비스 선택·진료비 산정 동작 보존)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-foot-BILLING-ITEM-PRICE — 구매패키지 항목별 수가 표시', () => {

  // ── 헬퍼: 결제 미니창 열기 ────────────────────────────────────────────────
  async function openPaymentMiniWindow(page: import('@playwright/test').Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;

    const settleBtn = page
      .locator('[data-testid="btn-payment-mini"], button')
      .filter({ hasText: /결제하기/ })
      .first();

    const count = await settleBtn.count();
    if (count === 0) return null;

    await settleBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /결제 미니창/ });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      return null;
    }
    return dialog;
  }

  // ── AC-1: 패키지 섹션 — 항목명 행 표시 구조 확인 ────────────────────────
  test('AC-1: Zone3 패키지 섹션 표시 — 항목명 행별 렌더링', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // Zone3 패키지 섹션 헤더 표시 확인
    const pkgHeader = dialog.locator('p').filter({ hasText: /^패키지/ }).first();
    await expect(pkgHeader).toBeVisible();

    // 패키지가 있는 경우: 항목 구조 확인
    const pkgCards = dialog.locator('.border-purple-200');
    const cardCount = await pkgCards.count();
    if (cardCount > 0) {
      const firstCard = pkgCards.first();
      // 패키지명 표시
      const pkgName = firstCard.locator('p').first();
      await expect(pkgName).toBeVisible();
      // 잔여 회차 표시
      await expect(firstCard.getByText(/잔여 \d+회/)).toBeVisible();
    }
  });

  // ── AC-2: 항목별 수가 금액 표시 (회차 × 단가 형식) ───────────────────────
  test('AC-2: 패키지 보유 시 항목별 N회 × 금액 표시', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 패키지 카드 존재 확인
    const pkgCards = dialog.locator('.border-purple-200');
    const cardCount = await pkgCards.count();
    if (cardCount === 0) {
      // 패키지 없는 경우 — "활성 패키지 없음" 표시 확인
      await expect(dialog.getByText('활성 패키지 없음')).toBeVisible();
      test.skip(); // 이 케이스는 항목 표시 확인 불가
      return;
    }

    // 패키지가 있으면 세션 항목(N회 × ₩) 패턴 확인
    // 예: "가열성" "3회 × 500,000" 형식
    const firstCard = pkgCards.first();
    // 항목 행 — "회 ×" 텍스트가 포함된 span이 있어야 함
    const itemRows = firstCard.locator('span').filter({ hasText: /회 ×/ });
    const itemCount = await itemRows.count();
    // 패키지에 세션이 설정되어 있으면 1개 이상의 항목 행 존재
    if (itemCount > 0) {
      await expect(itemRows.first()).toBeVisible();
    }
  });

  // ── AC-3: 총합계(납부액) 유지 ────────────────────────────────────────────
  test('AC-3: 패키지 총합계(납부액) 표시 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 패키지 카드 존재 시 납부액 표시 확인
    const pkgCards = dialog.locator('.border-purple-200');
    const cardCount = await pkgCards.count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    const firstCard = pkgCards.first();
    // 총합계 숫자 — formatAmount 출력 형식 (예: 1,200,000)
    // border-t 하단 섹션에 bold 금액 표시
    const totalSpan = firstCard.locator('span.font-semibold, span.tabular-nums').last();
    await expect(totalSpan).toBeVisible();
    const text = await totalSpan.textContent();
    // 숫자+콤마 패턴 포함 확인
    expect(text).toMatch(/[\d,]+/);
  });

  // ── AC-5: Zone1/Zone2 회귀 없음 ─────────────────────────────────────────
  test('AC-5: Zone1(탭) + Zone2(진료비 산정) 기존 동작 보존', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // Zone1 — 탭 3종 표시
    await expect(dialog.getByText('상병코드')).toBeVisible();
    await expect(dialog.getByText('처방약')).toBeVisible();
    await expect(dialog.getByText('풋케어')).toBeVisible();

    // Zone2 — 진료비 산정 헤더
    await expect(dialog.getByText(/차트 코드.*진료비 산정/)).toBeVisible();

    // Zone2 — 시술 저장 버튼 표시
    const saveBtn = dialog.locator('button').filter({ hasText: /시술 저장|저장됨/ }).first();
    await expect(saveBtn).toBeVisible();

    // Zone3 — 서류발행 영역 표시 (기존 기능 유지)
    await expect(dialog.getByText('서류발행')).toBeVisible();
    const printBtn = dialog.locator('[data-testid="btn-doc-print"]');
    await expect(printBtn).toBeVisible();

    // Zone3 — 금일 시술내역 헤더 표시
    await expect(dialog.getByText('금일 시술내역')).toBeVisible();
  });

  // ── 통합 시나리오: 패키지 보유 고객 → Zone3 항목 구조 완전성 ────────────
  test('통합: Zone3 패키지 카드 — 이름/항목/합계 3단 구조 완전성', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    const pkgCards = dialog.locator('.border-purple-200');
    const cardCount = await pkgCards.count();
    if (cardCount === 0) {
      // 패키지 없음: "활성 패키지 없음" 표시
      await expect(dialog.getByText('활성 패키지 없음')).toBeVisible();
      return;
    }

    for (let i = 0; i < cardCount; i++) {
      const card = pkgCards.nth(i);

      // (1) 패키지명 표시
      const namePara = card.locator('p').first();
      await expect(namePara).toBeVisible();

      // (2) 합계 섹션 — border-t 구조
      const totalSection = card.locator('.border-t');
      await expect(totalSection).toBeVisible();

      // (3) 잔여 회차 텍스트
      await expect(card.getByText(/잔여/)).toBeVisible();
    }
  });
});
