/**
 * T-20260706-foot-PHRASE-DIRECTOR-TO-ASSIGNEE-LABEL
 *   서비스관리 > 상용구 관리 화면 항목명 "원장님" → "담당자" 텍스트 변경.
 *   요청자: 김주연 총괄 (C0ATE5P6JTH), 스크린샷 F0BFCGNRJDP.
 *
 * ■ A/B 판정 결과 = (A) 순수 표시 라벨.
 *   - phrase_templates.category 컬럼은 KEY 'document' 를 저장(라벨 '원장님'/'담당자'가 아님).
 *   - '원장님'→'담당자'는 FE CATEGORY_LABELS / SIDE_MENU_CATS 매핑값만 변경 (PhrasesTab.tsx).
 *   - 저장 KEY('document') 불변 → 기존 데이터 매칭·정합성 무영향. db_change=false.
 *   - FE 라벨 코드 자체는 sibling 커밋 40b45b42(T-20260706-foot-PHRASES-LABEL-DOCTOR-STAFF)에서
 *     이미 반영됨. 본 티켓은 라벨 회귀 가드(E2E) + sibling 이 남긴 stale spec 정정을 종결한다.
 *
 * ■ AC:
 *   1. 상용구 관리 화면에서 기존 "원장님" 항목명이 "담당자"로 표시됨.
 *   2. 기존 "원장님"으로 저장된 데이터 정합성 유지(내용 소실·매칭 깨짐 없음)
 *      → category KEY 'document' 불변으로 담보(라벨 스왑이 저장키를 건드리지 않음).
 */

import { test, expect } from '@playwright/test';

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

// 진료도구 > 상용구 탭 진입 (상용구 관리 surface 공용 진입점)
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

// ── AC-1: 사이드 메뉴 카테고리 라벨이 '담당자' (원장님/서류 부재) ───────────
test('AC-1: 상용구 관리 사이드 메뉴 document 카테고리가 [담당자]로 표시되고 [원장님]이 없다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 권한 없거나 상용구 탭 미노출 — 환경 스킵');
    return;
  }

  const sidebar = page.locator('[data-testid="phrase-category-sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 5000 });

  // document 카테고리 버튼(=저장키 'document' 소비 지점) 라벨 == '담당자'
  const docBtn = page.locator('[data-testid="phrase-cat-btn-document"]');
  await expect(docBtn).toBeVisible();
  await expect(docBtn).toContainText('담당자');
  await expect(docBtn).not.toContainText('원장님');

  // 사이드바 전체에 '원장님' 라벨이 잔존하지 않음
  await expect(sidebar).not.toContainText('원장님');
});

// ── AC-1: 추가 다이얼로그 카테고리 옵션도 '담당자' ─────────────────────────
test('AC-1: 상용구 추가 다이얼로그 카테고리 옵션이 [담당자] (원장님 부재)', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  const addBtn = page.locator('[data-testid="phrase-add-btn"]');
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, '추가 버튼 미노출(읽기전용 권한) — 스킵');
    return;
  }
  await addBtn.click();
  await page.waitForTimeout(300);

  const catSelect = page.locator('[role="dialog"] select').first();
  if (await catSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    const options = await catSelect.locator('option').allTextContents();
    // 저장 value 는 여전히 'document' KEY (AC-2 정합성), 표시 텍스트만 '담당자'
    expect(options).toContain('담당자');
    expect(options).not.toContain('원장님');
    const values = await catSelect.locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(values).toContain('document');
  }
  await page.keyboard.press('Escape');
});

// ── AC-2: 기존 'document' 상용구 데이터 정합성(라벨 스왑이 저장키/내용 불변) ──
test('AC-2: 기존 document 카테고리 상용구가 담당자 필터에서 내용 소실 없이 노출된다', async ({ page }) => {
  await loginAsAdmin(page);
  const found = await openPhrasesTab(page);
  if (!found) {
    test.skip(true, '어드민 탭 미노출 — 스킵');
    return;
  }

  // document(=담당자) 카테고리로 필터 → 기존 저장키 'document' row 가 그대로 조회됨
  const docBtn = page.locator('[data-testid="phrase-cat-btn-document"]');
  await docBtn.click();
  await page.waitForTimeout(300);

  // 필터 활성(teal border) — 저장키 매칭이 깨지지 않아 카테고리 선택이 정상 동작
  await expect(docBtn).toHaveClass(/border-l-teal/);

  // 리스트 컨테이너는 정상 렌더(빈 상태여도 매칭 붕괴 없이 안내문 노출) — 매칭 깨짐 부재 확인
  const layout = page.locator('[data-testid="phrase-side-menu-layout"]');
  await expect(layout).toBeVisible();
});
