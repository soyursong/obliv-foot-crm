/**
 * T-20260706-foot-PHRASEMGMT-PENCHART-CLICK-PREVIEW
 *   서비스관리 > 상용구관리 > 상용구(펜차트) 목록에서 항목(행) 클릭 시,
 *   "차팅(수정)"(연필) 버튼을 누르지 않아도 우측 read-only 미리보기 패널에 내용 즉시 노출.
 *   요청자: 김주연 총괄 (C0ATE5P6JTH), 스크린샷 F0BFEDVT6Q4.
 *
 * ■ 판정 = (A) 순수 FE read-only 표시 패널 추가. db_change=false.
 *   - phrase_templates.content 를 그대로 조회해 읽기전용 렌더(입력요소 없음).
 *   - 기존 편집(연필) 버튼 동선(상용구 수정 다이얼로그)은 불변.
 *
 * ■ AC (티켓):
 *   1. 목록 행 클릭 → 우측 미리보기 패널에 해당 상용구 내용 즉시 렌더.
 *   2. 미리보기는 read-only (입력/편집 불가).
 *   3. 실제 수정은 기존 연필 버튼 동선 그대로 (편집 진입 경로 변경 금지).
 *   4. 다른 항목 클릭 시 미리보기 내용이 새 항목으로 교체.
 *   5. (엣지) 빈 내용 상용구도 에러 없이 안내 표시.
 */

import { test, expect, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
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

// 서비스관리 > 상용구관리 > 상용구(펜차트) 탭 진입
async function openPenchartPhraseTab(page: Page): Promise<boolean> {
  await page.goto('/services');
  await page.waitForLoadState('networkidle');
  const topTab = page.locator('[data-testid="svc-top-tab-phrases"]');
  if (!await topTab.isVisible({ timeout: 5000 }).catch(() => false)) return false;
  await topTab.click();
  await page.waitForTimeout(300);
  // 펜차트 상용구 내부 탭 (기본 선택이지만 명시적으로 클릭)
  const penTab = page.locator('[data-testid="tab-phrases"]');
  if (await penTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await penTab.click();
    await page.waitForTimeout(300);
  }
  return true;
}

// 최소 1개 상용구 행이 있어야 클릭 시나리오 가능 — 없으면 skip 판정용
async function firstRow(page: Page) {
  const rows = page.locator('[data-testid="phrase-row-clickable"]');
  const count = await rows.count();
  return { rows, count };
}

// ── 시나리오 1: 클릭 → 미리보기 즉시 노출 (AC-1/2) ──────────────────────────
test('S1: 펜차트 상용구 행 클릭 시 우측 read-only 미리보기 패널에 내용이 즉시 노출된다', async ({ page }) => {
  await loginAsAdmin(page);
  const ok = await openPenchartPhraseTab(page);
  if (!ok) { test.skip(true, '상용구관리 탭 미노출(권한/환경) — 스킵'); return; }

  const panel = page.locator('[data-testid="phrase-preview-panel"]');
  await expect(panel).toBeVisible({ timeout: 5000 });
  // 초기: 미선택 안내 placeholder (내용/이름 미표시)
  await expect(panel).toContainText('선택');

  const { rows, count } = await firstRow(page);
  if (count === 0) { test.skip(true, '등록된 펜차트 상용구 0건 — 클릭 시나리오 스킵'); return; }

  await rows.first().click();
  await page.waitForTimeout(200);

  // AC-1: 미리보기 이름 + 내용 영역 렌더
  await expect(page.locator('[data-testid="phrase-preview-name"]')).toBeVisible();
  await expect(page.locator('[data-testid="phrase-preview-content"]')).toBeVisible();

  // AC-2: 미리보기 패널 내부에 편집 가능한 입력요소(textarea/input)가 없다 (read-only)
  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel.locator('input')).toHaveCount(0);

  // 선택된 행 하이라이트 표식
  await expect(rows.first()).toHaveAttribute('data-previewed', 'true');
});

// ── 시나리오 1 (cont): 다른 항목 클릭 시 내용 교체 (AC-4) ───────────────────
test('S1b: 다른 행 클릭 시 미리보기 내용이 새 항목으로 교체된다', async ({ page }) => {
  await loginAsAdmin(page);
  const ok = await openPenchartPhraseTab(page);
  if (!ok) { test.skip(true, '상용구관리 탭 미노출 — 스킵'); return; }

  const { rows, count } = await firstRow(page);
  if (count < 2) { test.skip(true, '펜차트 상용구 2건 미만 — 교체 시나리오 스킵'); return; }

  await rows.nth(0).click();
  await page.waitForTimeout(150);
  const firstName = await page.locator('[data-testid="phrase-preview-name"]').textContent();
  await expect(rows.nth(0)).toHaveAttribute('data-previewed', 'true');

  await rows.nth(1).click();
  await page.waitForTimeout(150);
  const secondName = await page.locator('[data-testid="phrase-preview-name"]').textContent();

  // 이전 행 하이라이트 해제 + 새 행 하이라이트
  await expect(rows.nth(0)).toHaveAttribute('data-previewed', 'false');
  await expect(rows.nth(1)).toHaveAttribute('data-previewed', 'true');
  // 두 행 이름이 다르면 내용이 실제로 교체됐음을 확인(동명이 있으면 하이라이트 이동으로 갈음)
  if ((firstName ?? '').trim() !== (secondName ?? '').trim()) {
    expect((secondName ?? '').trim().length).toBeGreaterThan(0);
  }
});

// ── 시나리오 2: 기존 수정(연필) 동선 회귀 가드 (AC-3) ───────────────────────
test('S2: 편집(연필) 버튼은 기존대로 상용구 수정 다이얼로그로 진입한다 (동선 불변)', async ({ page }) => {
  await loginAsAdmin(page);
  const ok = await openPenchartPhraseTab(page);
  if (!ok) { test.skip(true, '상용구관리 탭 미노출 — 스킵'); return; }

  const editBtn = page.locator('[data-testid="phrase-edit-btn"]').first();
  if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    test.skip(true, '편집 버튼 미노출(읽기전용 권한/0건) — 스킵');
    return;
  }
  await editBtn.click();
  await page.waitForTimeout(300);

  // 기존과 동일: '상용구 수정' 다이얼로그 + 편집용 content textarea 노출
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('상용구 수정');
  await expect(page.locator('[data-testid="phrase-content-input"]')).toBeVisible();
  await page.keyboard.press('Escape');
});

// ── 시나리오 3: 엣지 — 미리보기 패널이 항상 안전하게 렌더 (AC-5) ────────────
test('S3: 미리보기 패널은 선택 전/후 모두 에러 없이 렌더된다 (빈 내용 안전 포함)', async ({ page }) => {
  await loginAsAdmin(page);
  const ok = await openPenchartPhraseTab(page);
  if (!ok) { test.skip(true, '상용구관리 탭 미노출 — 스킵'); return; }

  const panel = page.locator('[data-testid="phrase-preview-panel"]');
  await expect(panel).toBeVisible();

  const { rows, count } = await firstRow(page);
  if (count === 0) {
    // 0건이어도 패널은 placeholder 로 안전 렌더
    await expect(panel).toContainText('선택');
    return;
  }
  // 모든 행을 순회 클릭해도 미리보기 내용 영역이 예외 없이 렌더(빈 내용 = 안내문)
  const n = Math.min(count, 5);
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid="phrase-preview-content"]')).toBeVisible();
  }
});
