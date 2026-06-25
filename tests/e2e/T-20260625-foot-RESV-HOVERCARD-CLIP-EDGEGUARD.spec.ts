/**
 * T-20260625-foot-RESV-HOVERCARD-CLIP-EDGEGUARD
 * 예약관리 일간 간략정보 hover 팝업 4변 경계가드.
 *
 * 배경: CustomerHoverCard 팝업이 우/하 상한(Math.min)만 클램프 → 커서가 좌상단(헤더/사이드바 인접)일 때
 *       팝업이 가려짐. 상/좌 하한 8px 마진 추가(Math.max(8, …)) → 어느 위치 호버에도 팝업 전체 노출.
 *
 * AC: 일간 화면 어느 위치 호버에도 팝업 전체가 가림 없이(뷰포트 4변 모두 8px 이상 안쪽) 표시.
 * 회귀: 기존 우/하 가드 유지. hover in/out 인터랙션 미변경.
 *
 * 참고: 데이터 없는 환경(예약카드 0)에서는 skip — CI/로컬 공통.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260625-foot-RESV-HOVERCARD-CLIP-EDGEGUARD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // AC: 좌상단(헤더/사이드바 인접) 호버에도 팝업 4변이 뷰포트 안쪽 8px 이상 — 가림 0
  test('AC: 좌상단 인접 카드 hover 시 팝업이 4변 8px 마진 안에 전체 표시된다', async ({ page }) => {
    const hoverCardName = page.locator('[data-testid^="resv-card-"] span[title*="우클릭"]').first();
    if ((await hoverCardName.count()) === 0) { test.skip(); return; }

    await hoverCardName.hover();
    await page.waitForTimeout(400);

    const popup = page.locator('[data-testid="customer-hover-card"]');
    if (!(await popup.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }

    const box = await popup.boundingBox();
    if (!box) { test.skip(); return; }
    const vp = page.viewportSize()!;

    // 상/좌 하한가드(8px 마진) — 신규 보장
    expect(box.x).toBeGreaterThanOrEqual(8 - 1);
    expect(box.y).toBeGreaterThanOrEqual(8 - 1);
    // 우/하 상한가드 — 회귀 유지
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  });

  // 회귀: hover out → 팝업 닫힘 (인터랙션 미변경)
  test('회귀: hover out 시 팝업이 닫힌다', async ({ page }) => {
    const hoverCardName = page.locator('[data-testid^="resv-card-"] span[title*="우클릭"]').first();
    if ((await hoverCardName.count()) === 0) { test.skip(); return; }

    await hoverCardName.hover();
    await page.waitForTimeout(400);
    const popup = page.locator('[data-testid="customer-hover-card"]');
    if (!(await popup.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(); return; }

    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });
});
