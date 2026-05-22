/**
 * T-20260522-foot-PENCHART-PHRASE — 펜차트 상용구 불러오기 (phrase_templates 연동)
 *
 * AC-1: [펜차트] 탭에 "상용구 불러오기" 버튼 존재
 * AC-2: phrase_templates 목록 표시 (카테고리별 필터, charting 우선)
 * AC-3: 상용구 선택 → boilerplate-placing 모드 활성화 (캔버스 클릭 위치 삽입)
 * AC-4: 삽입 후 위치 조정 가능 (boilerplate-placing 모드 = 클릭 위치 지정)
 * AC-5: 0건 빈 상태 메시지
 */

import { test, expect } from '@playwright/test';

// ── 헬퍼: 로그인 + 고객 차트 열기 ──────────────────────────────────────────
async function openPenChartDraw(page: import('@playwright/test').Page) {
  // 테스트 환경 로그인
  await page.goto('/');
  await page.waitForURL(/login|\/$/);

  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(process.env.E2E_STAFF_EMAIL ?? 'test@obliv-foot.com');
    await page.locator('input[type="password"]').fill(process.env.E2E_STAFF_PW ?? 'test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/(?!login)/, { timeout: 10_000 });
  }

  // 고객 목록에서 첫 번째 고객 선택
  await page.goto('/customers');
  await page.waitForLoadState('networkidle');
  const firstCustomer = page.locator('[data-testid="customer-row"]').first();
  if (await firstCustomer.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstCustomer.click();
  } else {
    // 고객 없으면 스킵
    return false;
  }

  // [펜차트] 탭 클릭
  const penChartTab = page.getByRole('tab', { name: /펜차트/i });
  await penChartTab.click();
  await page.waitForTimeout(500);

  // "새 차트 작성" 버튼 → 양식 선택 → draw 모드
  const newChartBtn = page.locator('button', { hasText: /새 차트/ });
  if (await newChartBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newChartBtn.click();
    // 양식 선택 패널에서 "펜차트 양식" 클릭
    await page.locator('button', { hasText: /펜차트 양식/ }).first().click();
    await page.waitForTimeout(500);
  }

  return true;
}

// ── AC-1: "상용구 불러오기" 버튼 존재 ────────────────────────────────────────
test('AC-1: 펜차트 draw 모드 툴바에 "불러오기" 버튼 존재', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  const phraseBtn = page.locator('[data-testid="phrase-library-btn"]');
  await expect(phraseBtn).toBeVisible({ timeout: 5000 });
  await expect(phraseBtn).toContainText('불러오기');
});

// ── AC-2: 패널 열기 + 카테고리 탭 확인 ────────────────────────────────────────
test('AC-2: 불러오기 버튼 클릭 → 패널 열림 + 카테고리 탭(차팅/처방/서류/일반) 표시', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-library-btn"]').click();
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  await expect(panel).toBeVisible({ timeout: 3000 });

  // 카테고리 탭 4종
  await expect(page.locator('[data-testid="phrase-cat-charting"]')).toBeVisible();
  await expect(page.locator('[data-testid="phrase-cat-prescription"]')).toBeVisible();
  await expect(page.locator('[data-testid="phrase-cat-document"]')).toBeVisible();
  await expect(page.locator('[data-testid="phrase-cat-general"]')).toBeVisible();

  // 기본 활성 카테고리: charting(차팅)
  const chartingTab = page.locator('[data-testid="phrase-cat-charting"]');
  await expect(chartingTab).toHaveClass(/bg-emerald-600/);
});

// ── AC-3: 카테고리 필터 전환 ──────────────────────────────────────────────────
test('AC-2b: 카테고리 탭 전환 시 해당 카테고리로 필터링', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-library-btn"]').click();
  await page.locator('[data-testid="phrase-library-panel"]').waitFor({ state: 'visible' });

  // 처방 탭 클릭
  await page.locator('[data-testid="phrase-cat-prescription"]').click();
  await expect(page.locator('[data-testid="phrase-cat-prescription"]')).toHaveClass(/bg-emerald-600/);
  await expect(page.locator('[data-testid="phrase-cat-charting"]')).not.toHaveClass(/bg-emerald-600/);
});

// ── AC-5: 0건 빈 상태 메시지 ──────────────────────────────────────────────────
test('AC-5: phrase_templates에 해당 카테고리 항목 0건 → 빈 상태 메시지 표시', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-library-btn"]').click();
  await page.locator('[data-testid="phrase-library-panel"]').waitFor({ state: 'visible' });

  const phraseList = page.locator('[data-testid="phrase-list"]');
  const items = phraseList.locator('[data-testid^="phrase-item-"]');
  const emptyState = phraseList.locator('[data-testid="phrase-empty-state"]');

  const itemCount = await items.count();
  if (itemCount === 0) {
    // 현재 카테고리에 항목 없음 → empty state 표시
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('등록된 상용구가 없습니다');
  } else {
    // 항목 있으면 empty state 없음
    await expect(emptyState).not.toBeVisible();
  }
});

// ── AC-3: 상용구 선택 → boilerplate-placing 모드 ────────────────────────────
test('AC-3: 상용구 항목 선택 → 패널 닫힘 + boilerplate-placing 안내 배지 표시', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-library-btn"]').click();
  await page.locator('[data-testid="phrase-library-panel"]').waitFor({ state: 'visible' });

  const firstItem = page.locator('[data-testid^="phrase-item-"]').first();
  const hasItem = await firstItem.isVisible({ timeout: 2000 }).catch(() => false);

  if (!hasItem) {
    test.skip(true, 'phrase_templates 항목 없음 — 스킵 (AC-5에서 빈 상태 검증)');
    return;
  }

  await firstItem.click();

  // 패널 닫힘
  await expect(page.locator('[data-testid="phrase-library-panel"]')).not.toBeVisible({ timeout: 1000 });

  // boilerplate-placing 안내 배지 (기존 UI — "캔버스 클릭해 삽입" 텍스트)
  await expect(page.locator('text=캔버스 클릭해 삽입')).toBeVisible({ timeout: 2000 });
});

// ── 다른 도구 클릭 시 패널 자동 닫힘 ────────────────────────────────────────
test('패널 열린 상태에서 다른 도구(펜) 클릭 → 패널 자동 닫힘', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) {
    test.skip(true, '고객 데이터 없음 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-library-btn"]').click();
  await page.locator('[data-testid="phrase-library-panel"]').waitFor({ state: 'visible' });

  // 펜 버튼 클릭
  await page.locator('button', { hasText: /^펜$/ }).first().click();
  await expect(page.locator('[data-testid="phrase-library-panel"]')).not.toBeVisible({ timeout: 1000 });
});
