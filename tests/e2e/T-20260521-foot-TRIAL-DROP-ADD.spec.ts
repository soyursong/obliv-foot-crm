/**
 * T-20260521-foot-TRIAL-DROP-ADD
 * 회차 차감 금일치료 드롭다운에 [체험권] 항목 추가
 *
 * AC-1: "금일치료" 드롭다운에 [체험권] 항목 표시
 * AC-2: [체험권] 선택 시 정상 차감 처리 (DB trial 허용)
 * AC-3: [체험권] 차감 내역이 이력에 "체험권"으로 표기
 * AC-4: 기존 항목 동작에 영향 없음
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

// ── AC-1: C22 인라인 차감 드롭다운에 [체험권] 항목 존재 ─────────
test('AC-1: C22 금일치료 드롭다운에 체험권 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  // 고객 차트 열기 (첫 번째 고객 클릭)
  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();

  // C22 차감 섹션의 금일치료 select 확인
  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  await expect(treatmentSelect).toBeVisible({ timeout: 10_000 });

  // [체험권] 옵션이 존재하는지 확인
  const options = await treatmentSelect.locator('option').allTextContents();
  expect(options).toContain('체험권');
});

// ── AC-4: 기존 항목이 여전히 존재하는지 확인 ───────────────────
test('AC-4: 기존 드롭다운 항목(가열/비가열/포돌로게/수액) 동작 유지', async ({ page }) => {
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
});

// ── AC-1 (확장): useSessionDlg 시술유형 드롭다운에도 체험권 존재 ─
test('AC-1 ext: 패키지 사용 다이얼로그 시술유형 드롭다운에 체험권 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();

  // "회차 사용" 버튼 클릭 (존재하는 경우)
  const useBtn = page.getByRole('button', { name: /회차 사용/ }).first();
  if (await useBtn.isVisible()) {
    await useBtn.click();
    // 다이얼로그 내 시술유형 select 확인
    const dlgSelect = page.locator('[role="dialog"] select, .fixed select').filter({ hasText: '가열 레이저' }).first();
    await expect(dlgSelect).toBeVisible({ timeout: 5_000 });
    const opts = await dlgSelect.locator('option').allTextContents();
    expect(opts).toContain('체험권');
  } else {
    // 패키지 없는 고객 — 스킵
    test.skip();
  }
});

// ── AC-1 (확장): editSessionDlg 시술유형 드롭다운에도 체험권 존재 ─
test('AC-1 ext: 시술내역 수정 다이얼로그 시술유형 드롭다운에 체험권 항목 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();

  // 수정 버튼 (연필 아이콘) — 시술내역 행에 존재하는 경우
  const editBtn = page.getByRole('button', { name: /수정|편집/ }).first();
  if (await editBtn.isVisible()) {
    await editBtn.click();
    const dlgSelect = page.locator('[role="dialog"] select, .fixed select').filter({ hasText: '가열 레이저' }).first();
    await expect(dlgSelect).toBeVisible({ timeout: 5_000 });
    const opts = await dlgSelect.locator('option').allTextContents();
    expect(opts).toContain('체험권');
  } else {
    test.skip();
  }
});
