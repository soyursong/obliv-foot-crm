/**
 * T-20260623-foot-PAYMINI-DESK-SETTLE — 풋 수납/결제 동선 정리 (현장 김주연 총괄, 2026-06-23)
 *
 * 본 스펙은 **항목 ④a** (결제 미니창=PaymentDialog 결제수단에서 [패키지] 버튼 제거)만 검증한다.
 * 나머지 항목 상태(2026-06-23 dev-foot):
 *   ① 1번차트 '수납처리'·'건보조회' 항목 제거 — 라벨 1:1 매칭 불명확 → planner FOLLOWUP(확인 후 진행)
 *   ② 결제미니창 풋케어 항목 박스 세로폭 축소 — 제공 스샷(paymini-120059)에 해당 박스 미표시 → 대상 확인 필요
 *   ③ 단건·미수금(잔금) 결제 동작 — 이미 구현됨(잔금=PKG-OUTSTANDING-BALANCE, 단건=core handleSubmit)
 *   ④b "건강보험(급여)~작성" 게이트 제거 → 데스크 즉시수납 — MEDLAW22-B-GATE(의료법 제22조,
 *      문지은 대표원장 2026-06-13 결정) → 자율 제거 금지, 원장 confirm 게이트 대기(FOLLOWUP sbb1)
 *
 * ④a 정책: 결제수단은 카드/현금/이체 3종만. [패키지](membership) 결제수단 버튼 제거(단건·패키지 모드 모두).
 *   상단 [패키지 결제] 모드 토글은 유지 → 패키지 결제 기능 자체는 보존(비파괴).
 *   audit: 이 버튼은 5/22 T-20260522-foot-PAY-DROPDOWN-LONGRE(대표 김승현)에서 추가된 항목 → policy_superseded.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// ④a: 결제수단 [패키지] 버튼 제거 — 단건 모드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('DESK-SETTLE ④a — 결제수단 [패키지] 버튼 제거', () => {
  test('단건 모드: 결제수단 = 카드/현금/이체만, [패키지]·멤버십 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    if (await paymentBtn.count() === 0) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    const methodGrid = page.locator('.grid.grid-cols-3').first();
    const labels = await methodGrid.locator('button').allTextContents();

    expect(labels.some((l) => l.includes('패키지') && l.includes('📦')),
      '결제수단 [📦 패키지] 버튼이 제거되어야 함').toBe(false);
    expect(labels.some((l) => l.includes('멤버십')), '멤버십 텍스트 없어야 함').toBe(false);
    expect(
      labels.some((l) => l.includes('카드')) &&
      labels.some((l) => l.includes('현금')) &&
      labels.some((l) => l.includes('이체')),
      '카드/현금/이체 3종은 유지').toBe(true);
  });

  test('패키지 모드: 결제수단 grid에도 [패키지] 버튼 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    if (await paymentBtn.count() === 0) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    // 상단 [패키지 결제] 모드 토글 클릭 (결제수단 버튼이 아닌 모드 토글)
    const pkgModeBtn = page.locator('button').filter({ hasText: /패키지 결제/ }).last();
    if (await pkgModeBtn.count() === 0) { test.skip(); return; }
    await pkgModeBtn.click();

    // 결제수단 grid에 패키지(📦) 버튼 없음
    const grids = page.locator('div.grid.grid-cols-3');
    let foundPkg = false;
    for (let i = 0; i < (await grids.count()); i++) {
      const labels = await grids.nth(i).locator('button').allTextContents();
      const isMethodGrid = labels.some((l) => l.includes('카드') || l.includes('현금') || l.includes('이체'));
      if (isMethodGrid && labels.some((l) => l.includes('패키지') && l.includes('📦'))) foundPkg = true;
    }
    expect(foundPkg, '패키지 모드 결제수단에도 [📦 패키지] 없음').toBe(false);
  });

  test('상단 [패키지 결제] 모드 토글은 유지 (패키지 결제 기능 보존)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const paymentBtn = page.locator('[data-testid^="payment-btn-"]').first();
    if (await paymentBtn.count() === 0) { test.skip(); return; }

    await paymentBtn.click();
    await page.waitForSelector('[data-testid="btn-payment-submit"]', { timeout: 5000 });

    const pkgModeBtn = page.locator('button').filter({ hasText: /패키지 결제/ });
    expect(await pkgModeBtn.count(), '상단 [패키지 결제] 모드 토글은 유지되어야 함').toBeGreaterThan(0);
  });
});
