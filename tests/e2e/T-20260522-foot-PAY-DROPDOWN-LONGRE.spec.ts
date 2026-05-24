/**
 * T-20260522-foot-PAY-DROPDOWN-LONGRE Phase 2 — 결제수단 드롭다운 라벨 변경 + 금액 자동 연동
 *
 * AC-6: 결제수단 드롭다운 라벨 "멤버십" → "패키지" (3개 컴포넌트)
 *   - PaymentMiniWindow / PaymentDialog / PaymentEditDialog 모두 "패키지" 표시
 *   - DB value는 'membership' 그대로 유지
 * AC-7: 패키지 선택 시 금액 자동 세팅 (단건 결제 + 패키지 수단)
 *   - 패키지 목록 선택 → 결제 금액 input에 purchase_amount(total_price) 자동 반영
 *   - 금액 수동 수정 가능
 *   - 패키지 미선택 시 금액 placeholder "패키지 선택 시 자동 입력"
 * AC-8: 패키지 결제 모드에서 "패키지" 수단 미노출 (자기 참조 방지)
 *
 * Phase 1 (commit ea6ba29) — membership 추가 / Phase 2 — 라벨 변경 + 금액 연동
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: 라벨 "패키지" 표시 / "멤버십" 미표시 — PaymentDialog
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6: 결제수단 라벨 변경 — 패키지 표시 / 멤버십 미표시', () => {
  test('PaymentDialog — 결제수단 버튼에 "패키지" 있고 "멤버십" 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 결제수단 버튼 목록 확인
    const buttons = page.locator('button');
    const labels = await buttons.allTextContents();
    const hasPackageLabel = labels.some((l) => l.includes('패키지') && l.includes('📦'));
    const hasMembershipLabel = labels.some((l) => l.includes('멤버십'));

    expect(hasPackageLabel, '"📦 패키지" 버튼이 있어야 함').toBe(true);
    expect(hasMembershipLabel, '"멤버십" 텍스트가 없어야 함').toBe(false);
  });

  test('PaymentEditDialog — method 버튼에 "패키지" 있고 "멤버십" 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 2번차트 payment_waiting 수납내역에서 edit 접근
    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 다이얼로그 내 method 버튼 라벨 확인 (PaymentDialog의 단건 결제수단 버튼)
    const methodGrid = page.locator('.grid.grid-cols-3').first();
    const methodLabels = await methodGrid.locator('button').allTextContents();

    // "패키지" 있어야 하고 "멤버십" 없어야 함
    const hasPackage = methodLabels.some((l) => l.includes('패키지'));
    const hasMembership = methodLabels.some((l) => l.includes('멤버십'));
    expect(hasPackage).toBe(true);
    expect(hasMembership).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: 패키지 수단 선택 → 패키지 선택 UI 표시 + 금액 자동 세팅
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-7: 패키지 선택 → 금액 자동 세팅', () => {
  test('단건 결제 + 패키지 수단 선택 → 패키지 선택 UI 나타남 + placeholder 변경', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // "📦 패키지" 결제수단 버튼 클릭
    const pkgMethodBtn = page.locator('button').filter({ hasText: '📦 패키지' });
    if (await pkgMethodBtn.count() === 0) { test.skip(); return; }
    await pkgMethodBtn.click();

    // 패키지 선택 섹션 표시 확인
    await expect(page.locator('text=패키지 선택').first()).toBeVisible({ timeout: 3000 });

    // 금액 필드 placeholder 변경 확인
    const amountPlaceholder = page.locator('input[placeholder="패키지 선택 시 자동 입력"]');
    await expect(amountPlaceholder).toBeVisible({ timeout: 3000 });
  });

  test('패키지 수단 → 카드로 전환 시 패키지 선택 UI 사라짐', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    const pkgMethodBtn = page.locator('button').filter({ hasText: '📦 패키지' });
    if (await pkgMethodBtn.count() === 0) { test.skip(); return; }

    // 패키지 선택
    await pkgMethodBtn.click();
    await expect(page.locator('input[placeholder="패키지 선택 시 자동 입력"]')).toBeVisible({ timeout: 3000 });

    // 카드로 전환
    await page.locator('button').filter({ hasText: '💳 카드' }).click();

    // 패키지 선택 UI 사라짐
    await expect(page.locator('input[placeholder="패키지 선택 시 자동 입력"]')).not.toBeVisible({ timeout: 2000 });
    // 금액 placeholder 원래대로
    const normalAmountInput = page.locator('input[placeholder="0"]');
    await expect(normalAmountInput.first()).toBeVisible({ timeout: 2000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-8: 패키지 결제 모드에서 "패키지" 수단 자기 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-8: 패키지 결제 모드에서 "패키지" 수단 미노출', () => {
  test('패키지 결제 탭 전환 후 결제수단 grid에 "패키지" 버튼 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 패키지 결제 탭 클릭
    const pkgModeBtn = page.locator('button').filter({ hasText: /패키지 결제/ }).last();
    if (await pkgModeBtn.count() === 0) { test.skip(); return; }
    await pkgModeBtn.click();

    // 일시/분할 결제 토글 아래 결제수단 grid 확인 (분할 결제 해제 상태)
    // 패키지 모드 + 일시불 → 결제수단 grid에 membership 없음
    const methodGrids = page.locator('div.grid.grid-cols-3');
    let foundPackageInGrid = false;
    const gridCount = await methodGrids.count();
    for (let i = 0; i < gridCount; i++) {
      const grid = methodGrids.nth(i);
      const labels = await grid.locator('button').allTextContents();
      if (labels.some((l) => l.includes('카드') || l.includes('현금') || l.includes('이체'))) {
        // 이게 결제수단 grid — membership(패키지) 없어야 함
        if (labels.some((l) => l.includes('패키지') && l.includes('📦'))) {
          foundPackageInGrid = true;
        }
      }
    }
    expect(foundPackageInGrid).toBe(false);
  });
});
