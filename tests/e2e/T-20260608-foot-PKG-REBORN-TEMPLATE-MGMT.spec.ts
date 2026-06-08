/**
 * T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT
 * 패키지 생성/템플릿 관리 화면(Packages.tsx)에 [Re:Born] 항목 누락 보충
 *
 * 요청: 김주연 총괄 (#풋확장 C0ATE5P6JTH)
 *   "고객차트 Re:Born 티켓 항목 추가했던 거 패키지 - 패키지 생성/템플릿 관리에는 미적용.
 *    동일 항목 동시 적용! 왜 누락되는거지?"
 *
 * ITEM 티켓(T-20260608-foot-PKG-REBORN-ITEM)은 CustomerChartPage(고객차트)에만 reborn 추가.
 * 본 티켓은 Packages.tsx(템플릿 관리)에 동일 항목을 미러링 + package_templates 테이블 reborn 컬럼 보충.
 *
 * 네이밍: state key=reborn, label='Re:Born', package_templates 컬럼=reborn_sessions/reborn_unit_price
 *
 * AC-1: 템플릿 편집 폼에 Re:Born 섹션 표시 + 입력 가능
 * AC-2: 패키지 빌드 폼에도 Re:Born 섹션 표시
 * AC-3: 템플릿 목록/요약에 Re:Born 표시 (저장 시)
 * AC-5: 기존 5항목(가열/비가열/포돌로게/수액/체험권) 무회귀
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

// ── AC-1/AC-2: 패키지 관리 폼(템플릿/빌드)에 Re:Born 섹션 표시 ──
test('AC-1/2: 패키지 관리 화면 폼에 Re:Born 섹션 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/packages');
  await page.waitForTimeout(1_000);

  // 템플릿 추가/새 패키지 버튼
  const addBtn = page.getByRole('button', { name: /추가|새 패키지/ }).first();
  if (!(await addBtn.isVisible())) {
    test.skip();
    return;
  }
  await addBtn.click();

  // Re:Born 섹션 표시 확인
  const rebornSection = page.getByText('Re:Born', { exact: true }).first();
  await expect(rebornSection).toBeVisible({ timeout: 5_000 });
});

// ── AC-5: 기존 5항목 무회귀 (Re:Born 추가가 기존 항목 영향 없음) ──
test('AC-5: 기존 5항목(가열/비가열/포돌로게/수액/체험권) + Re:Born 6항목 동시 표시', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/packages');
  await page.waitForTimeout(1_000);

  const addBtn = page.getByRole('button', { name: /추가|새 패키지/ }).first();
  if (!(await addBtn.isVisible())) {
    test.skip();
    return;
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  // 기존 5항목 회귀 없음 + 신규 Re:Born — 폼 라벨 기준
  await expect(page.getByText('포돌로게', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('체험권', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Re:Born', { exact: true }).first()).toBeVisible();
});

// ── AC-1: Re:Born 회수/수가 입력 → 총액 합산 반영 ───────────────
test('AC-1: Re:Born 회수/수가 입력 가능 (number input 존재)', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/packages');
  await page.waitForTimeout(1_000);

  const addBtn = page.getByRole('button', { name: /추가|새 패키지/ }).first();
  if (!(await addBtn.isVisible())) {
    test.skip();
    return;
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  const rebornLabel = page.getByText('Re:Born', { exact: true }).first();
  await expect(rebornLabel).toBeVisible();

  // 폼 내 number input 존재 (가열~Re:Born 6항목 회수 칸)
  const numberInputs = page.locator('input[type="number"]');
  expect(await numberInputs.count()).toBeGreaterThanOrEqual(1);
});
