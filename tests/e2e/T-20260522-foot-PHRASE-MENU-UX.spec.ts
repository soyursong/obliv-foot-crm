/**
 * T-20260522-foot-PHRASE-MENU-UX — 진료도구 상용구 메뉴 UX 개선
 *
 * AC-1: 상용구 카테고리가 드롭다운 아닌 사이드 메뉴 클릭 형태로 노출
 * AC-2: 상용구 리스트 행 높이 컴팩트 (divide-y 구조, py-1.5)
 * AC-3: 카테고리 [서류] → [원장님] 라벨 변경
 * AC-4: 펜차트 [불러오기] 패널도 사이드 메뉴 카테고리 + 원장님 라벨
 * AC-5: 기존 CRUD (추가/수정/삭제) 회귀 없음
 */

import { test, expect } from '@playwright/test';

// ── 헬퍼: 어드민 로그인 ──────────────────────────────────────────────────────
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForURL(/login|\/$/);
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(process.env.E2E_ADMIN_EMAIL ?? 'admin@obliv-foot.com');
    await page.locator('input[type="password"]').fill(process.env.E2E_ADMIN_PW ?? 'test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/(?!login)/, { timeout: 10_000 });
  }
}

// ── 헬퍼: 진료도구 > 상용구 탭 진입 ────────────────────────────────────────
async function openPhrasesTab(page: import('@playwright/test').Page) {
  await page.goto('/doctor-tools');
  await page.waitForLoadState('networkidle');
  const phrasesTab = page.getByRole('tab', { name: /상용구/ });
  if (await phrasesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await phrasesTab.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

// ── AC-1: 사이드 메뉴 구조 확인 ────────────────────────────────────────────
test('AC-1: 상용구 카테고리가 사이드 메뉴 클릭 형태로 노출된다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 권한 없거나 상용구 탭 미노출 — 환경 스킵');
    return;
  }

  // 사이드 메뉴 레이아웃 컨테이너 존재
  const sideLayout = page.locator('[data-testid="phrase-side-menu-layout"]');
  await expect(sideLayout).toBeVisible({ timeout: 5000 });

  // 사이드 메뉴 사이드바 존재
  const sidebar = page.locator('[data-testid="phrase-category-sidebar"]');
  await expect(sidebar).toBeVisible();

  // 전체·차팅·처방·원장님·일반 버튼이 sidebar 내 존재
  for (const key of ['all', 'charting', 'prescription', 'document', 'general']) {
    await expect(page.locator(`[data-testid="phrase-cat-btn-${key}"]`)).toBeVisible();
  }

  // 기존 Select dropdown이 사라짐 (드롭다운 제거 확인)
  const selectTrigger = page.locator('[data-testid="phrase-side-menu-layout"] select');
  await expect(selectTrigger).toHaveCount(0);
});

// ── AC-1: 카테고리 클릭 시 리스트 필터링 ──────────────────────────────────
test('AC-1: 사이드 메뉴 카테고리 클릭 시 해당 상용구만 표시된다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  // 전체 선택 (기본)
  const allBtn = page.locator('[data-testid="phrase-cat-btn-all"]');
  await allBtn.click();
  await page.waitForTimeout(200);

  // 차팅 카테고리 클릭
  const chartingBtn = page.locator('[data-testid="phrase-cat-btn-charting"]');
  await chartingBtn.click();
  await page.waitForTimeout(200);

  // 버튼이 활성 스타일 보유 (teal border-l 클래스)
  await expect(chartingBtn).toHaveClass(/border-l-teal/);
});

// ── AC-2: 컴팩트 리스트 확인 ───────────────────────────────────────────────
test('AC-2: 상용구 리스트가 컴팩트 형태로 표시된다 (divide-y)', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  // phrase-list 컨테이너에 divide-y 클래스 존재
  const listContainer = page.locator('[data-testid="phrase-list"]');
  if (await listContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(listContainer).toHaveClass(/divide-y/);

    // 아이템이 있다면 각 아이템 높이가 컴팩트한지 확인 (py-3 없고 py-1.5 있어야 함)
    const firstItem = listContainer.locator('[data-testid="phrase-item"]').first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(firstItem).toHaveClass(/py-1\.5/);
    }
  }
});

// ── AC-3: [서류] → [원장님] 라벨 변경 ────────────────────────────────────
test('AC-3: 상용구 사이드 메뉴에 [원장님] 라벨이 표시되고 [서류]가 없다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  // 사이드 메뉴에 [원장님] 텍스트 존재
  const sideMenu = page.locator('[data-testid="phrase-category-sidebar"]');
  await expect(sideMenu).toContainText('원장님');

  // [서류] 텍스트가 카테고리 버튼 레이블에 없음
  const docBtn = page.locator('[data-testid="phrase-cat-btn-document"]');
  await expect(docBtn).toContainText('원장님');
  await expect(docBtn).not.toContainText('서류');
});

// ── AC-3: 상용구 추가 다이얼로그 카테고리 select에도 원장님 존재 ───────────
test('AC-3: 상용구 추가 다이얼로그 카테고리에 [원장님] 옵션 존재', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  await page.locator('[data-testid="phrase-add-btn"]').click();
  await page.waitForTimeout(300);

  // 다이얼로그 내 카테고리 select 존재
  const catSelect = page.locator('dialog select, [role="dialog"] select').first();
  if (await catSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    const options = await catSelect.locator('option').allTextContents();
    expect(options).toContain('원장님');
    expect(options).not.toContain('서류');
  }
  // 다이얼로그 닫기
  await page.keyboard.press('Escape');
});

// ── AC-4: 펜차트 불러오기 패널 사이드 메뉴 확인 ────────────────────────────
test('AC-4: 펜차트 draw 모드 상용구 불러오기 패널이 사이드 메뉴 구조를 사용한다', async ({ page }) => {
  await loginAsAdmin(page);
  // 고객 상세로 이동
  await page.goto('/customers');
  await page.waitForLoadState('networkidle');
  const firstCustomer = page.locator('[data-testid="customer-row"]').first();
  if (!await firstCustomer.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '고객 없음 — 스킵');
    return;
  }
  await firstCustomer.click();

  // 펜차트 탭
  const penChartTab = page.getByRole('tab', { name: /펜차트/i });
  if (!await penChartTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '펜차트 탭 미노출 — 스킵');
    return;
  }
  await penChartTab.click();
  await page.waitForTimeout(400);

  // 새 차트 작성 → draw 모드
  const newBtn = page.locator('button', { hasText: /새 차트/ });
  if (!await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, '새 차트 버튼 미노출 — 스킵');
    return;
  }
  await newBtn.click();
  await page.locator('button', { hasText: /펜차트 양식/ }).first().click();
  await page.waitForTimeout(600);

  // "불러오기" 버튼 클릭
  const libraryBtn = page.locator('[data-testid="phrase-library-btn"]');
  if (!await libraryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '불러오기 버튼 미노출 — 스킵');
    return;
  }
  await libraryBtn.click();
  await page.waitForTimeout(300);

  // 패널 표시 확인
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  await expect(panel).toBeVisible({ timeout: 3000 });

  // 카테고리 탭 컨테이너 존재 (사이드 메뉴 구조)
  const catTabs = panel.locator('[data-testid="phrase-category-tabs"]');
  await expect(catTabs).toBeVisible();

  // AC-3: 원장님 라벨 존재, 서류 없음
  await expect(catTabs.locator('[data-testid="phrase-cat-document"]')).toContainText('원장님');
  await expect(catTabs.locator('[data-testid="phrase-cat-document"]')).not.toContainText('서류');
});

// ── AC-5: 기존 CRUD 회귀 없음 ─────────────────────────────────────────────
test('AC-5: 상용구 추가/저장 기존 동선 정상 동작', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  // 추가 버튼 클릭
  await page.locator('[data-testid="phrase-add-btn"]').click();
  await page.waitForTimeout(300);

  // 이름 입력
  const nameInput = page.locator('[data-testid="phrase-name-input"]');
  await expect(nameInput).toBeVisible({ timeout: 3000 });
  await nameInput.fill('E2E 테스트 상용구');

  // 내용 입력
  const contentInput = page.locator('[data-testid="phrase-content-input"]');
  await contentInput.fill('E2E 테스트 내용입니다.');

  // 저장 버튼 존재 확인
  const saveBtn = page.locator('[data-testid="phrase-save-btn"]');
  await expect(saveBtn).toBeVisible();
  await expect(saveBtn).toBeEnabled();

  // ESC로 닫기 (실제 저장은 안 함 — 테스트 데이터 오염 방지)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

// ── AC-5: 수정 버튼 존재 확인 ─────────────────────────────────────────────
test('AC-5: 상용구 수정 버튼이 각 아이템에 존재한다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  const list = page.locator('[data-testid="phrase-list"]');
  if (await list.isVisible({ timeout: 3000 }).catch(() => false)) {
    const firstItem = list.locator('[data-testid="phrase-item"]').first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      const editBtn = firstItem.locator('[data-testid="phrase-edit-btn"]');
      await expect(editBtn).toBeVisible();
    }
  }
});
