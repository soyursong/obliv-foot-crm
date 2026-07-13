/**
 * T-20260713-foot-APPSHELL-STALE-BUNDLE-RELOAD-GUARD
 * 필드 태블릿 장기세션 구번들 staleness 자동 재적재 가드 — blocked 데드엔드 자가복구.
 *
 * 진단(origin RECEIPT-ITEMIZED false-reopen):
 *   새 버전 감지 후 카운트다운이 attemptReload 를 발화한 순간 미저장 blocking 가드가 하나라도
 *   있으면 phase='blocked' 로 고정되고, 그 뒤 가드가 해제돼도 재시도 경로가 없어 세션이 종일
 *   구 in-memory 번들로 남았다 → 방금 배포한 fix 가 현장에 안 보임(유령 재진입).
 * 처방: blocked 인 동안 주기적으로 + 탭 재활성 시 blocking 재평가 → 비면 자동 reload 재개.
 *   blocking 이 남아 있으면 계속 보류(데이터 유실 0 유지).
 *
 * AC-1/AC-2: 배너 감지·안내 → 기존 SPA-VERSION-AUTORELOAD spec 담당(회귀).
 * 본 spec:
 *   - 블록 유지: blocking 가드가 있으면 카운트다운이 끝나도 reload 하지 않고 phase='blocked' 유지(유실 0).
 *   - 자가복구: blocking 가드가 해제되면 자동으로 reload 경로가 재개돼 최신 번들로 착지(AC-1/AC-2/AC-4).
 *   - no-op:   버전 동일 시 배너·재적재 트리거 없음(AC-3 false positive 0).
 */
import { test, expect, type Page } from '@playwright/test';

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

/**
 * 앱 마운트 전에 (1) 짧은 카운트다운/복구주기 오버라이드, (2) blocking 미저장 가드 등록.
 * 가드는 window.__testDirty 플래그를 참조 → 테스트가 런타임에 dirty 를 켜고 끌 수 있다.
 * flush 미제공 → blocking(저장 경로 없음) 취급.
 */
async function armBlockingGuard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __updateCountdownSeconds?: number;
      __updateRecoveryPollMs?: number;
      __testDirty?: boolean;
      __unsavedGuardTest?: {
        register: (g: { id: string; isDirty: () => boolean; label?: string }) => void;
      };
    };
    w.__updateCountdownSeconds = 2; // 카운트다운 빠르게
    w.__updateRecoveryPollMs = 300; // blocked 자가복구 재평가 빠르게
    w.__testDirty = true; // 초기엔 미저장(dirty) → blocking
    // unsavedGuard 모듈 로드 후 blocking 가드 등록.
    const iv = window.setInterval(() => {
      if (w.__unsavedGuardTest) {
        window.clearInterval(iv);
        w.__unsavedGuardTest.register({
          id: 'e2e-stale-bundle-guard',
          isDirty: () => w.__testDirty === true,
          label: '테스트 진료차트',
        });
      }
    }, 20);
  });
}

// ── 블록 유지: blocking 가드가 있으면 자동 reload 보류(데이터 유실 0) ─────────────
test('blocking 미저장이 있으면 카운트다운 후에도 reload 하지 않고 blocked 유지', async ({ page }) => {
  await armBlockingGuard(page);
  await mockVersion(page, 'REMOTE-NEW-BUILD-vB');
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });

  // reload 감지 마커 — reload 되면 사라진다.
  await page.evaluate(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
  });

  // 카운트다운(2s) 종료 후 attemptReload → blocking 이라 phase='blocked' 로 보류.
  await expect(banner(page)).toHaveAttribute('data-phase', 'blocked', { timeout: 8000 });

  // 복구주기(300ms)가 여러 번 돌 시간을 줘도, dirty 가 유지되는 한 reload 안 됨.
  await page.waitForTimeout(1500);
  const markerStillThere = await page.evaluate(
    () => (window as unknown as { __beforeReload?: boolean }).__beforeReload === true,
  );
  expect(markerStillThere).toBe(true);
  await expect(banner(page)).toHaveAttribute('data-phase', 'blocked');
});

// ── 자가복구: blocking 이 해제되면 자동으로 reload 경로 재개 → 최신 번들 착지 ────────
test('blocked 상태에서 미저장이 해제되면 자동으로 최신 번들 재적재(자가복구)', async ({ page }) => {
  await armBlockingGuard(page);
  await mockVersion(page, 'REMOTE-NEW-BUILD-vB');
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  await expect(banner(page)).toHaveAttribute('data-phase', 'blocked', { timeout: 8000 });

  // 사용자가 저장/차트 닫음을 시뮬 — dirty 해제.
  await page.evaluate(() => {
    (window as unknown as { __testDirty?: boolean }).__testDirty = false;
  });

  // 복구주기(300ms)가 blocking 이 빈 걸 감지 → attemptReload → clean → 전체 reload.
  await page.waitForLoadState('load', { timeout: 8000 });

  // reload 후 앱이 다시 정상 부팅됐는지 확인(회귀 없음).
  await expect(page.locator('#root')).toBeVisible({ timeout: 8000 });
});

// ── no-op: 버전 동일 시 배너/재적재 트리거 없음 (false positive 0) ────────────────
test('버전 동일 시 배너 미노출·재적재 트리거 없음', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ ?? ''),
      { timeout: 5000 },
    )
    .not.toBe('');
  const localBuildId = await page.evaluate(
    () => (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ ?? '',
  );

  await mockVersion(page, localBuildId);
  await page.reload();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2000);

  await expect(banner(page)).toHaveCount(0);
});
