/**
 * T-20260617-foot-DOCFORM-POPUP-OVERHAUL — QA fix (MSG-20260622-160527)
 * 진료대시보드(/admin/doctor-tools) 직접 URL alias 검증
 *
 * 버그(QA insufficient_verification): supervisor QA가 /doctor-tools 직접 진입 시
 *   진료대시보드 화면 요소 미노출 → 검증 불가. 원인은 RoleGuard/권한이 아니라 라우팅:
 *   정본 라우트는 /admin/doctor-tools 인데, /doctor-tools 는 하단 catch-all(*)에 먹혀
 *   /admin(메인 대시보드)로 redirect → 진료대시보드가 아닌 메인 대시보드가 렌더됨.
 * 수정: top-level alias <Route path="/doctor-tools" → Navigate /admin/doctor-tools replace>
 *       (clinic-settings 리다이렉트 패턴 동일. 라우팅 전용 — 컨텐츠/RoleGuard 불변)
 *
 * AC-1: /doctor-tools 직접 진입 → /admin/doctor-tools 로 redirect.
 * AC-2: redirect 후 진료대시보드 헤더('진료대시보드') + 탭(진료 알림판 등) 노출.
 *
 * 티켓: T-20260617-foot-DOCFORM-POPUP-OVERHAUL
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

// ── AC-1: /doctor-tools 직접 진입 → /admin/doctor-tools redirect ──
test('AC-1: /doctor-tools 직접 진입 시 /admin/doctor-tools 로 redirect', async ({ page }) => {
  await loginIfNeeded(page);

  await page.goto(`${BASE_URL}/doctor-tools`);
  await page.waitForURL(/\/admin\/doctor-tools/, { timeout: 8000 });
  expect(page.url()).toContain('/admin/doctor-tools');
});

// ── AC-2: redirect 후 진료대시보드 헤더 + 탭 렌더 (메인 대시보드 아님) ──
test('AC-2: redirect 후 진료대시보드 화면 요소 노출', async ({ page }) => {
  await loginIfNeeded(page);

  await page.goto(`${BASE_URL}/doctor-tools`);
  await page.waitForURL(/\/admin\/doctor-tools/, { timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 진료대시보드 헤더 (DoctorTools.tsx h1)
  const header = page.getByRole('heading', { name: '진료대시보드' });
  await expect(header).toBeVisible({ timeout: 8000 });

  // 진료 알림판 탭 (data-testid 안정 셀렉터)
  const callTab = page.locator('[data-testid="tab-call-dashboard"]');
  await expect(callTab).toBeVisible({ timeout: 5000 });
});
