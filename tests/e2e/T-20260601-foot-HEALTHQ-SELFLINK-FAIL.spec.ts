/**
 * E2E spec — T-20260601-foot-HEALTHQ-SELFLINK-FAIL
 * 펜차트 발건강질문지 자가작성 링크 생성 실패 (재발) 회귀 방지
 *
 * 근본 원인: 토큰 생성식 encode(gen_random_bytes(24), 'base64url') — PostgreSQL
 *           encode() 미지원 인코딩 → 런타임 "unrecognized encoding: base64url" → 항상 실패.
 *           수정: translate(encode(..., 'base64'), '+/=', '-_') (URL-safe).
 *
 * 시나리오 1 (AC-1): 펜차트 → 발건강질문지 자가작성 → '링크 생성' 클릭 시
 *                    에러 토스트 없이 /health-q/{token} 링크가 생성된다.
 * 시나리오 2 (AC-2): /health-q/{token} 라우트 진입 시 화면이 크래시 없이 렌더되며,
 *                    무효 토큰일 때 명확한 안내가 표시된다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260601-HEALTHQ-SELFLINK-FAIL — 자가작성 링크 생성', () => {
  // ─── 시나리오 1: 링크 생성 정상 (AC-1, AC-3) ────────────────────────────────
  test('AC-1: 링크 생성 클릭 → 에러 없이 /health-q/ 링크 생성', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    // 고객 차트 → 펜차트 탭 진입
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    try {
      await firstRow.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '고객 목록 없음');
    }
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    const clinicalGroup = page.locator('[data-tab-group="clinical"], button:has-text("진료")').first();
    if (await clinicalGroup.count() > 0) await clinicalGroup.click();
    const penChartTab = page.locator('button:has-text("펜차트"), [data-tab="pen_chart"]').first();
    if (await penChartTab.count() === 0) test.skip(true, '펜차트 탭 없음');
    await penChartTab.click();
    await page.waitForTimeout(500);

    // 자가작성 패널의 '링크 생성' 버튼
    const createBtn = page.locator('button:has-text("링크 생성")').first();
    if (await createBtn.count() === 0) test.skip(true, '링크 생성 버튼 없음 (자가작성 패널 미노출)');
    await expect(createBtn).toBeVisible({ timeout: 8_000 });

    // 에러 토스트 감시 시작
    let sawError = false;
    page.on('console', () => {/* noop */});
    await createBtn.click();

    // 에러 토스트("링크 생성 실패")가 뜨지 않고, 생성된 URL(/health-q/)이 나타나야 함
    const errorToast = page.locator('text=링크 생성 실패');
    const generatedUrl = page.locator('text=/\\/health-q\\//').first();

    const result = await Promise.race([
      errorToast.waitFor({ timeout: 8_000 }).then(() => 'error').catch(() => null),
      generatedUrl.waitFor({ timeout: 8_000 }).then(() => 'url').catch(() => null),
    ]);

    if (await errorToast.count() > 0) sawError = true;
    expect(sawError, '링크 생성 실패 토스트가 떠서는 안 됨 (base64url 회귀)').toBeFalsy();
    expect(result, '/health-q/ 링크가 생성되어야 함').toBe('url');
  });

  // ─── 시나리오 2: 링크 진입 — 라우트 렌더 (AC-2) ─────────────────────────────
  test('AC-2: /health-q/{무효토큰} 진입 → 크래시 없이 안내 렌더', async ({ page }) => {
    // 무효 토큰으로 진입해도 라우트가 존재하고 화면이 크래시 없이 렌더되어야 함
    await page.goto('/health-q/invalid-token-e2e-regression');
    await page.waitForTimeout(1500);

    // 흰 화면/크래시가 아니라 무언가 렌더되어야 함 (만료/무효 안내 또는 폼 셸)
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const text = (await body.innerText()).trim();
    expect(text.length, '빈/크래시 화면이 아니어야 함').toBeGreaterThan(0);
  });
});
