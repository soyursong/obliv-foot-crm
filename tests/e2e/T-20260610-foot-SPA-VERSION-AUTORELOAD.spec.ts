/**
 * T-20260610-foot-SPA-VERSION-AUTORELOAD
 * 태블릿 SPA '배포됐는데 현장 구버전' 재발방지 — 빌드버전 체크 후 신버전 시 배너 → 사용자 클릭 reload.
 *
 * 부모 CTXMENU-STALE-PHONE REOPEN#1 근본원인 = 배포는 됐는데 태블릿이 in-memory 구번들로 동작.
 * 본 티켓: 클라가 /version.json(서버 빌드버전)과 번들에 박힌 로컬 빌드버전을 비교 →
 *          다르면 '새 버전' 배너 노출. 자동 reload 금지(작업 유실 방지), 사용자 클릭 시에만 reload.
 *
 * 테스트 전략:
 *   /version.json 응답을 page.route 로 모킹해 '서버 빌드버전 vB' 상태를 재현한다.
 *   로컬 번들 빌드버전(전역 __APP_BUILD_ID__ → window.__BUILD_ID__ 로 노출)과 다른 값을
 *   반환 → 배너 노출 검증. (import.meta 는 page.evaluate 직렬화 불가라 window 경유로 읽음)
 *
 * AC-1: 신버전 감지 시 '새 버전' 배너 노출
 * AC-2: 자동 reload 발생 안 함 (배너만 — 작업 유실 방지)
 * AC-3: 배너 '새로고침' 클릭 → 전체 reload (신번들 적용 경로)
 * AC-4: 동일 버전이면 배너 미노출 (회귀/불필요 reload 없음)
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

/** /version.json 을 임의의 buildId 로 모킹 */
async function mockVersion(page: Page, buildId: string) {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
    });
  });
}

const banner = (page: Page) => page.getByTestId('app-update-banner');

// ── AC-1: 신버전 감지 → 배너 노출 ───────────────────────────────────────────
test('AC-1: 서버 빌드버전이 로컬과 다르면 새 버전 배너 노출', async ({ page }) => {
  // 로컬 번들 BUILD_ID 와 절대 겹치지 않는 값으로 모킹
  await mockVersion(page, 'REMOTE-NEW-BUILD-vB');
  await page.goto(BASE_URL);

  // 최초 마운트 시 version 체크 → 불일치 → 배너 노출
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  await expect(banner(page)).toContainText('새 버전');
  await expect(page.getByTestId('app-update-reload')).toBeVisible();
});

// ── AC-2: 자동 reload 발생 안 함 (배너만) ────────────────────────────────────
test('AC-2: 신버전 감지해도 자동 reload 하지 않음 (작업 유실 방지)', async ({ page }) => {
  await mockVersion(page, 'REMOTE-NEW-BUILD-vB');
  await page.goto(BASE_URL);
  await expect(banner(page)).toBeVisible({ timeout: 8000 });

  // 현재 문서에 마커를 심는다. 자동 reload 가 일어나면 마커가 사라진다.
  await page.evaluate(() => {
    (window as unknown as { __noAutoReload?: boolean }).__noAutoReload = true;
  });

  // 배너 노출 이후로도 충분히 대기 — 강제 reload 가 없어야 함
  await page.waitForTimeout(2500);

  const markerStillThere = await page.evaluate(
    () => (window as unknown as { __noAutoReload?: boolean }).__noAutoReload === true,
  );
  expect(markerStillThere).toBe(true);
  // 배너는 여전히 떠 있어야 함 (사용자 액션 대기)
  await expect(banner(page)).toBeVisible();
});

// ── AC-3: 배너 '새로고침' 클릭 → 전체 reload ─────────────────────────────────
test('AC-3: 배너 새로고침 클릭 시 전체 reload 발생', async ({ page }) => {
  await mockVersion(page, 'REMOTE-NEW-BUILD-vB');
  await page.goto(BASE_URL);
  await expect(banner(page)).toBeVisible({ timeout: 8000 });

  // reload 검증용 마커 — 클릭 후 reload 되면 마커가 초기화됨
  await page.evaluate(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
  });

  await page.getByTestId('app-update-reload').click();

  // 전체 reload(load 이벤트) 대기
  await page.waitForLoadState('load', { timeout: 8000 });

  const markerCleared = await page.evaluate(
    () => (window as unknown as { __beforeReload?: boolean }).__beforeReload === undefined,
  );
  expect(markerCleared).toBe(true);
});

// ── AC-4: 동일 버전이면 배너 미노출 (회귀 방지) ──────────────────────────────
test('AC-4: 서버/로컬 빌드버전이 같으면 배너 미노출', async ({ page }) => {
  // 1) mock 없이 먼저 로드해 실제 로컬 번들 BUILD_ID 를 취득한다.
  //    import.meta 는 page.evaluate 직렬화 불가이므로 런타임 노출값 window.__BUILD_ID__ 를 읽는다
  //    (useVersionCheck 모듈이 import 시 주입). dev 에는 /version.json 이 없어 404 → 배너 미노출 상태.
  await page.goto(BASE_URL);
  await expect
    .poll(
      async () => page.evaluate(() => (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ ?? ''),
      { timeout: 5000 },
    )
    .not.toBe('');
  const localBuildId = await page.evaluate(
    () => (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ ?? '',
  );

  // 2) 로컬과 '같은' buildId 를 돌려주도록 mock 후 reload → 첫 체크부터 일치(불일치 race 없음).
  await mockVersion(page, localBuildId);
  await page.reload();

  // 3) visibility 전환으로 재체크 유도 — 일치하므로 배너는 끝까지 떠선 안 됨.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2000);

  await expect(banner(page)).toHaveCount(0);
});
