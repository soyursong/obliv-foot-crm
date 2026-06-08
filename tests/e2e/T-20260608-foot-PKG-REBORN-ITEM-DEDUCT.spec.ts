/**
 * T-20260608-foot-PKG-REBORN-ITEM (REOPEN P0 핫픽스)
 * Re:Born 회차 차감 결함 회귀 가드
 *
 * 결함: package_sessions.session_type CHECK 제약에 'reborn' 누락
 *       → Re:Born 차감 시 INSERT(session_type='reborn') 거부 → "차감 안됨".
 *       (FE 코드는 정상 — computeRemaining/드롭다운/TREAT_KO 모두 reborn 포함.
 *        근본 원인은 DB 제약. migration 20260608130000_pkg_sessions_reborn_check.sql 로 보충.)
 *
 * AC-1: "금일치료" 드롭다운에 [Re:Born] 항목 표시
 * AC-2: 기존 항목(가열/비가열/포돌로게/수액/체험권) 무회귀
 * AC-3: (DB) session_type='reborn' INSERT 가 CHECK 제약에 의해 거부되지 않음
 *        → 본 항목은 migration apply 검증(rolled-back insert ACCEPTED)으로 입증됨.
 */

import { test, expect } from '@playwright/test';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/이메일/).fill(process.env.TEST_EMAIL ?? 'test@obliv.kr');
  await page.getByLabel(/비밀번호/).fill(process.env.TEST_PASSWORD ?? 'test1234!');
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/(dashboard|waiting)/, { timeout: 15_000 });
}

// ── AC-1: C22 인라인 차감 드롭다운에 [Re:Born] 항목 존재 ─────────
test('AC-1: C22 금일치료 드롭다운에 Re:Born 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();

  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  await expect(treatmentSelect).toBeVisible({ timeout: 10_000 });

  const options = await treatmentSelect.locator('option').allTextContents();
  expect(options).toContain('Re:Born');
});

// ── AC-2: 기존 6항목 무회귀 ─────────────────────────────────────
test('AC-2: 기존 드롭다운 항목(가열/비가열/포돌로게/수액/체험권) + Re:Born 동시 존재', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();

  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  await expect(treatmentSelect).toBeVisible({ timeout: 10_000 });

  const options = await treatmentSelect.locator('option').allTextContents();
  expect(options).toContain('가열');
  expect(options).toContain('비가열');
  expect(options).toContain('포돌로게');
  expect(options).toContain('수액');
  expect(options).toContain('체험권');
  expect(options).toContain('Re:Born');
});
