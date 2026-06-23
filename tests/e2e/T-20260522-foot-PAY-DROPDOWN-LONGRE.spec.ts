/**
 * T-20260522-foot-PAY-DROPDOWN-LONGRE Phase 2 — 결제수단 드롭다운 라벨 변경 + 금액 자동 연동
 *
 * ⚠ POLICY-SUPERSEDED by T-20260623-foot-PAYMINI-DESK-SETTLE ④a (2026-06-23, 현장 김주연 총괄):
 *   결제수단(PaymentDialog 단건/패키지 모드)에서 [패키지](membership) 버튼을 **전 모드 제거**.
 *   → AC-6 "패키지 버튼 존재" 단언 / AC-7 "패키지 수단 선택 → 금액 자동세팅" 단언은 무효화되어
 *     "패키지 버튼 부재"로 재정의함. 상단 [패키지 결제] 모드 토글은 유지(패키지 결제 기능 보존=비파괴).
 *   DB value 'membership' 자체는 내부 로직(전액 패키지차감 등)에서 그대로 유지.
 *
 * (구 명세, 참고용)
 * AC-6: 결제수단 드롭다운 라벨 "멤버십" → "패키지" → [SUPERSEDED] 결제수단에서 패키지 버튼 제거
 * AC-7: 패키지 선택 시 금액 자동 세팅 → [SUPERSEDED] 패키지 결제수단 버튼 자체 제거됨
 * AC-8: 패키지 결제 모드에서 "패키지" 수단 미노출 (자기 참조 방지) → 유효(이제 전 모드 미노출)
 *
 * Phase 1 (commit ea6ba29) — membership 추가 / Phase 2 — 라벨 변경 + 금액 연동
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 [SUPERSEDED by DESK-SETTLE ④a]: 결제수단에서 [패키지](membership) 버튼 부재 — PaymentDialog
//   기존 "패키지 버튼 존재" 단언 → "패키지 버튼 부재 + 멤버십 부재"로 재정의.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6[SUPERSEDED]: 결제수단 — 패키지/멤버십 버튼 모두 미노출', () => {
  test('PaymentDialog 단건 모드 — 결제수단에 "패키지"·"멤버십" 버튼 없음 (카드/현금/이체만)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 결제수단 grid 확인 (PaymentDialog grid grid-cols-3, 아이콘 라벨)
    const methodGrid = page.locator('.grid.grid-cols-3').first();
    const methodLabels = await methodGrid.locator('button').allTextContents();

    const hasPackage = methodLabels.some((l) => l.includes('패키지') && l.includes('📦'));
    const hasMembership = methodLabels.some((l) => l.includes('멤버십'));
    const hasCore = methodLabels.some((l) => l.includes('카드'))
      && methodLabels.some((l) => l.includes('현금'))
      && methodLabels.some((l) => l.includes('이체'));

    expect(hasPackage, '결제수단 "📦 패키지" 버튼이 제거되어야 함 (DESK-SETTLE ④a)').toBe(false);
    expect(hasMembership, '"멤버십" 텍스트가 없어야 함').toBe(false);
    expect(hasCore, '카드/현금/이체 3종은 유지되어야 함').toBe(true);
  });

  test('PaymentDialog — 상단 [패키지 결제] 모드 토글은 유지 (패키지 결제 기능 보존)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    const hasPending = await paymentBtn.count() > 0;
    if (!hasPending) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 상단 모드 토글의 [패키지 결제] 버튼은 결제수단 버튼과 별개 — 유지되어야 함
    const pkgModeBtn = page.locator('button').filter({ hasText: /패키지 결제/ });
    expect(await pkgModeBtn.count(), '상단 [패키지 결제] 모드 토글은 유지').toBeGreaterThan(0);
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
