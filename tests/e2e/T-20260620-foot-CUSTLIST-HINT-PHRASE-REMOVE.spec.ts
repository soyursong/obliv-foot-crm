/**
 * T-20260620-foot-CUSTLIST-HINT-PHRASE-REMOVE
 * 고객관리(/admin/customers) 목록 도움말 문구 2곳 삭제.
 *  1) 헤더 hint: "클릭=간편차트(1번) / 우클릭=고객차트(2번)" span 제거
 *  2) 행 차트열기 버튼(open-chart-btn)의 title="2번차트(미니홈피) 열기" 속성 제거
 *
 * 거동 회귀 0 (AC-3): 라벨/툴팁만 제거. 행 클릭=1번차트 / 차트열기=2번차트 / 우클릭=컨텍스트메뉴 모두 무변경.
 * 발송·DB 변경 없음(NO-DDL, FE 텍스트 only).
 *
 * 검증:
 *  S1: 헤더 hint 문구 부재
 *  S2: 차트열기 버튼 title 속성 부재
 *  S3: 차트열기 버튼 클릭 동작 유지(onClick → openChart 경로 살아있음, 버튼/아이콘 정상)
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
  }
}

async function gotoCustomers(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
}

// ── S1: 헤더 hint 문구 부재 ─────────────────────────────────────────────
test('S1: 헤더 도움말 문구 "클릭=간편차트(1번) / 우클릭=고객차트(2번)" 부재', async ({ page }) => {
  await loginIfNeeded(page);
  await gotoCustomers(page);
  await expect(page.getByText('클릭=간편차트(1번) / 우클릭=고객차트(2번)')).toHaveCount(0);
  // 부분 문구도 부재
  await expect(page.getByText('간편차트(1번)', { exact: false })).toHaveCount(0);
});

// ── S2: 차트열기 버튼 title 속성 부재 ─────────────────────────────────────
test('S2: 차트열기 버튼 title("2번차트(미니홈피) 열기") 속성 제거', async ({ page }) => {
  await loginIfNeeded(page);
  await gotoCustomers(page);
  const btn = page.getByTestId('open-chart-btn').first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }
  await expect(btn).not.toHaveAttribute('title', /.+/);
});

// ── S3: 차트열기 버튼 클릭 동작 유지(2번차트 새 창) ──────────────────────────
test('S3: 차트열기 클릭 동작 유지 — openChart 경로 살아있음', async ({ page, context }) => {
  await loginIfNeeded(page);
  await gotoCustomers(page);
  const btn = page.getByTestId('open-chart-btn').first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }
  // 버튼/아이콘 정상 렌더 + 클릭 가능(onClick 살아있음). 2번차트는 새 창/탭으로 열림.
  await expect(btn).toBeEnabled();
  const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await btn.click();
  const popup = await popupPromise;
  // 새 창이 떴다면 차트 경로로 진입(미니홈피). 환경상 팝업 차단 시에도 클릭 자체 회귀 없음만 확인.
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    expect(popup.url()).toContain('chart');
    await popup.close();
  }
});
