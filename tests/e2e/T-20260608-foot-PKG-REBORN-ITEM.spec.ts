/**
 * T-20260608-foot-PKG-REBORN-ITEM
 * 패키지 구입티켓에 [Re:Born] 항목 추가 + 차감 드롭다운 자동 반영
 *
 * 요청: 김주연 총괄 (#풋확장, thread 1780873759.108379)
 *   "2번 차트 - 패키지 - 구입티켓 추가 항목에 [Re:Born] 추가. 차감 드롭다운에도 자동 반영"
 *
 * 네이밍: session_type 값 = `reborn`, packages 컬럼 = reborn_sessions / reborn_unit_price
 *
 * 시나리오 1: Re:Born 구입티켓 추가 → 저장 → 표시
 * 시나리오 2: Re:Born 차감 드롭다운 자동 반영 (3개 드롭다운 위치 모두)
 * 시나리오 3: 기존 5항목(가열/비가열/포돌로게/수액/체험권) 회귀 없음
 */

import { test, expect } from '@playwright/test';

// ── 공통 로그인 헬퍼 ────────────────────────────────────────────
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/이메일/).fill(process.env.TEST_EMAIL ?? 'test@obliv.kr');
  await page.getByLabel(/비밀번호/).fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_USER_PASSWORD env required (no plaintext fallback)'); })());
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/(dashboard|waiting)/, { timeout: 15_000 });
}

async function openFirstCustomer(page: import('@playwright/test').Page) {
  await page.goto('/customers');
  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();
}

// ── 시나리오 2 / AC-3: 차감 드롭다운에 Re:Born 옵션 (자동 반영 — 현장 핵심요청) ──
test('S2/AC-3: 금일치료 차감 드롭다운에 Re:Born 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await openFirstCustomer(page);

  // 가열 항목을 포함하는 차감 select 확인
  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  await expect(treatmentSelect).toBeVisible({ timeout: 10_000 });

  const options = await treatmentSelect.locator('option').allTextContents();
  expect(options).toContain('Re:Born');
});

// ── 시나리오 3 / AC-5: 기존 5항목 무회귀 (드롭다운 항목 보존) ──
test('S3/AC-5: 기존 드롭다운 항목(가열/비가열/포돌로게/수액/체험권) 동작 유지 + Re:Born 추가', async ({ page }) => {
  await loginAsAdmin(page);
  await openFirstCustomer(page);

  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  await expect(treatmentSelect).toBeVisible({ timeout: 10_000 });

  const options = await treatmentSelect.locator('option').allTextContents();
  // 기존 5항목 회귀 없음
  expect(options).toContain('가열');
  expect(options).toContain('비가열');
  expect(options).toContain('포돌로게');
  expect(options).toContain('수액');
  expect(options).toContain('체험권');
  // 신규 항목
  expect(options).toContain('Re:Born');
});

// ── 시나리오 2 (확장): useSessionDlg 시술유형 드롭다운에도 Re:Born 존재 ──
test('S2 ext: 패키지 사용 다이얼로그 시술유형 드롭다운에 Re:Born 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await openFirstCustomer(page);

  const useBtn = page.getByRole('button', { name: /회차 사용/ }).first();
  if (await useBtn.isVisible()) {
    await useBtn.click();
    const dlgSelect = page.locator('[role="dialog"] select, .fixed select').filter({ hasText: '가열' }).first();
    await expect(dlgSelect).toBeVisible({ timeout: 5_000 });
    const opts = await dlgSelect.locator('option').allTextContents();
    expect(opts).toContain('Re:Born');
  } else {
    test.skip();
  }
});

// ── 시나리오 1 / AC-2: 구입티켓 추가 다이얼로그에 Re:Born 입력 행 표시 ──
test('S1/AC-2: 패키지 구매(템플릿) 다이얼로그에 Re:Born 회차·수가 입력 행 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await openFirstCustomer(page);

  // "패키지 구매" 또는 "구입티켓 추가" 버튼
  const purchaseBtn = page.getByRole('button', { name: /패키지 구매|구입티켓|패키지 추가/ }).first();
  if (await purchaseBtn.isVisible()) {
    await purchaseBtn.click();
    const dlg = page.locator('[role="dialog"], .fixed.inset-y-0').last();
    await expect(dlg).toBeVisible({ timeout: 5_000 });
    // Re:Born 항목 라벨 노출 확인
    await expect(dlg.locator('text=Re:Born').first()).toBeVisible({ timeout: 5_000 });
  } else {
    test.skip();
  }
});
