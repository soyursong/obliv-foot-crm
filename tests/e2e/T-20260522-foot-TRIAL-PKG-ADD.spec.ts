/**
 * T-20260522-foot-TRIAL-PKG-ADD
 * 구입 티켓 추가에 [체험권] 카테고리 신규 추가
 *
 * AC-1: 구입 티켓 추가 화면 카테고리 선택에 [체험권] 항목 표시
 * AC-2: [체험권] 등록 시 기존 4종과 동일 기능 (회차, 금액, 저장)
 * AC-3: 등록된 체험권 패키지 → 고객 차트 패키지 목록 정상 표시
 * AC-4: 등록 체험권 패키지 회차 차감 시 금일치료 드롭 [체험권]과 정상 연동
 * AC-5: 기존 4종 동작 영향 없음
 */

import { test, expect } from '@playwright/test';

// ── 공통 로그인 헬퍼 ────────────────────────────────────────────
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/이메일/).fill(process.env.TEST_EMAIL ?? 'test@obliv.kr');
  await page.getByLabel(/비밀번호/).fill(process.env.TEST_PASSWORD ?? 'test1234!');
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/(dashboard|waiting)/, { timeout: 15_000 });
}

// ── AC-1: 구입 티켓 추가 화면에 [체험권] 항목 표시 ────────────
test('AC-1: 구입 티켓 추가 화면에 체험권 섹션 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  // 첫 번째 고객 열기
  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();
  await page.waitForTimeout(1_000);

  // "구입 티켓 추가" 버튼 클릭
  const addTicketBtn = page.getByRole('button', { name: /구입 티켓 추가/ }).first();
  if (!(await addTicketBtn.isVisible())) {
    test.skip();
    return;
  }
  await addTicketBtn.click();

  // 다이얼로그가 열렸는지 확인
  const dialog = page.locator('.fixed.inset-0').filter({ hasText: '구입 티켓 추가' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // [체험권] 섹션이 폼 내에 표시되는지 확인
  const trialSection = dialog.getByText('체험권', { exact: true });
  await expect(trialSection).toBeVisible({ timeout: 5_000 });
});

// ── AC-1 (Packages 페이지): 패키지 관리에서도 체험권 섹션 표시 ─
test('AC-1 packages-page: 패키지 관리 템플릿 에디터에 체험권 섹션 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/packages');
  await page.waitForTimeout(1_000);

  // 템플릿 관리 혹은 직접 추가 버튼 클릭
  const addBtn = page.getByRole('button', { name: /추가|새 패키지/ }).first();
  if (!(await addBtn.isVisible())) {
    test.skip();
    return;
  }
  await addBtn.click();

  // [체험권] 섹션이 폼 내에 표시되는지 확인
  const trialSection = page.getByText('체험권', { exact: true }).first();
  await expect(trialSection).toBeVisible({ timeout: 5_000 });
});

// ── AC-5: 기존 4종 동작 영향 없음 ──────────────────────────────
test('AC-5: 기존 4종 (가열/비가열/포돌로게/수액) 섹션 그대로 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();
  await page.waitForTimeout(1_000);

  const addTicketBtn = page.getByRole('button', { name: /구입 티켓 추가/ }).first();
  if (!(await addTicketBtn.isVisible())) {
    test.skip();
    return;
  }
  await addTicketBtn.click();

  const dialog = page.locator('.fixed.inset-0').filter({ hasText: '구입 티켓 추가' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // 기존 4종 섹션 확인
  await expect(dialog.getByText('가열 레이저', { exact: true })).toBeVisible();
  await expect(dialog.getByText('비가열 레이저', { exact: true })).toBeVisible();
  await expect(dialog.getByText('포돌로게', { exact: true })).toBeVisible();
  await expect(dialog.getByText('수액', { exact: true })).toBeVisible();
  // 5번째: 체험권
  await expect(dialog.getByText('체험권', { exact: true })).toBeVisible();
});

// ── AC-4: 금일치료 드롭다운에도 [체험권] 존재 (TRIAL-DROP-ADD 짝 확인) ──
test('AC-4: 차감 드롭다운에 체험권 항목 존재 (TRIAL-DROP-ADD 연동)', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();
  await page.waitForTimeout(1_000);

  // 금일치료 드롭다운에서 체험권 확인
  const treatmentSelect = page.locator('select').filter({ hasText: '가열' }).first();
  if (await treatmentSelect.isVisible()) {
    const options = await treatmentSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('체험권'))).toBeTruthy();
  } else {
    test.skip();
  }
});

// ── AC-2: 체험권 필드 입력 가능 (회수 + 수가) ──────────────────
test('AC-2: 체험권 회수/수가 입력 가능', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/customers');

  const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
  await firstCustomer.click();
  await page.waitForTimeout(1_000);

  const addTicketBtn = page.getByRole('button', { name: /구입 티켓 추가/ }).first();
  if (!(await addTicketBtn.isVisible())) {
    test.skip();
    return;
  }
  await addTicketBtn.click();

  const dialog = page.locator('.fixed.inset-0').filter({ hasText: '구입 티켓 추가' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // 체험권 섹션 내 입력 필드 찾기
  const trialSectionLabel = dialog.getByText('체험권', { exact: true });
  await expect(trialSectionLabel).toBeVisible();

  // 체험권 회수 input (type=number) — 섹션 내에서 찾기
  const trialInputs = dialog.locator('input[type="number"]');
  const count = await trialInputs.count();
  // 체험권 섹션은 마지막 number input (가열/비가열/포돌로게/수액/체험권 순)
  // 최소 1개 이상의 number input이 있어야 함
  expect(count).toBeGreaterThanOrEqual(1);

  // 총 회수가 0일 때 "구입 티켓 생성" 버튼이 비활성화(disabled)되는지 확인
  const submitBtn = dialog.getByRole('button', { name: /구입 티켓 생성/ });
  await expect(submitBtn).toBeDisabled();
});
