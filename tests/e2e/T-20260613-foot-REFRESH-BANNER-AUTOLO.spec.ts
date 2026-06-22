/**
 * T-20260613-foot-REFRESH-BANNER-AUTOLO — 새로고침 안내 배너 자동 타이머 전환 + dirty-guard.
 *
 * 배경(김주연 총괄 컨펌): 기존 '버튼식' 배너가 며칠째 화면에 떠 불편 → 10~15초 카운트다운 후
 *   버튼 없이 자동 새로고침. 단, 자동 새로고침이 진료차트 작성 중·문자 발송 중에 무방비로
 *   발화하면 데이터 유실 → AC-3 dirty-guard로 방어(유실 0).
 *
 * AC-1: 새 버전 감지 시 "잠시 후 자동으로 화면이 업데이트됩니다 (N초)" 배너/토스트 노출(별도 창 X)
 * AC-2: 10~15초 카운트다운 후 자동 새로고침(버튼 불필요)
 * AC-3: 자동 새로고침 직전 미저장 입력 dirty-guard
 *        (a) flushable(저장 경로 보유) → 자동 저장 후 "자동 저장됨" → 새로고침
 *        (b) blocking(저장 경로 없음, 진료차트) → 새로고침 보류 + "저장 후 새로고침" 안내(유실 0)
 * AC-4: "지금 새로고침" 버튼으로 즉시 실행도 가능(동일 dirty-guard 적용)
 *
 * 테스트 전략:
 *   - /version.json 을 page.route 로 모킹해 '새 버전' 재현(기존 SPA-VERSION-AUTORELOAD 관례).
 *   - 카운트다운/저장안내 지연은 window.__updateCountdownSeconds / __updateSavedNoticeMs 로 단축.
 *   - 실제 새로고침 발생 여부는 sessionStorage 의 load 카운터로 감지(reload 가 window 를 리셋해도
 *     sessionStorage 는 보존됨 → location.reload 스텁 불가 문제 회피).
 *   - dirty-guard 분기는 window.__unsavedGuardTest 로 합성 가드(flushable/blocking)를 주입.
 */
import { test, expect, type Page } from '@playwright/test';

/** /version.json 을 임의의 buildId 로 모킹 → 로컬 번들과 불일치 = '새 버전'. */
async function mockNewVersion(page: Page, buildId = 'REMOTE-NEW-BUILD-vB') {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
    });
  });
}

/**
 * init 스크립트: 매 문서 로드마다 sessionStorage 의 load 카운터를 증가시킨다.
 * + 카운트다운/저장안내 지연을 테스트용으로 단축한다.
 */
async function setup(page: Page, opts: { countdown: number; savedNoticeMs?: number }) {
  await page.addInitScript(
    ({ countdown, savedNoticeMs }) => {
      const w = window as unknown as {
        __updateCountdownSeconds?: number;
        __updateSavedNoticeMs?: number;
      };
      w.__updateCountdownSeconds = countdown;
      if (typeof savedNoticeMs === 'number') w.__updateSavedNoticeMs = savedNoticeMs;
      const n = Number(sessionStorage.getItem('__loadCount') || '0') + 1;
      sessionStorage.setItem('__loadCount', String(n));
    },
    { countdown: opts.countdown, savedNoticeMs: opts.savedNoticeMs },
  );
}

const loadCount = (page: Page) =>
  page
    .evaluate(() => Number(sessionStorage.getItem('__loadCount') || '0'))
    // reload 발화 순간 page.evaluate 가 'execution context destroyed'(navigation)로 던질 수 있다.
    // expect.poll 이 그 예외로 중단되지 않도록 -1(불일치 sentinel)로 흡수 → 다음 polling에서 정상값을 읽는다.
    .catch(() => -1);

const banner = (page: Page) => page.getByTestId('app-update-banner');
const reloadBtn = (page: Page) => page.getByTestId('app-update-reload');

// ── AC-1: 새 버전 감지 → 카운트다운 안내 배너 노출(별도 창 X) ──────────────────
test('AC-1: 새 버전 감지 시 카운트다운 안내 배너 노출 (별도 창 아님)', async ({ page }) => {
  await setup(page, { countdown: 12 });
  await mockNewVersion(page);
  await page.goto('/');

  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  await expect(banner(page)).toContainText('자동으로 화면이 업데이트됩니다');
  await expect(banner(page)).toHaveAttribute('role', 'status');
  // 별도 팝업/dialog 가 아니라 inline 배너인지 확인
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

// ── 시나리오 1 (AC-2): 미저장 없음 → 카운트다운 후 자동 새로고침(버튼 불필요) ──
test('AC-2/시나리오1: 카운트다운 종료 시 버튼 없이 자동 새로고침', async ({ page }) => {
  await setup(page, { countdown: 2 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // 클릭 없이 카운트다운(2초) 만료 → 자동 reload → load 카운터 2로 증가.
  await expect.poll(() => loadCount(page), { timeout: 10000 }).toBe(2);
});

// ── 시나리오 1 (AC-3a): flushable dirty → 자동 저장 후 "자동 저장됨" → 새로고침 ──
test('AC-3a/시나리오1: 저장 경로 보유(flushable) → 자동 저장 후 새로고침', async ({ page }) => {
  // 자동만료 방지(countdown 30) → 버튼으로 트리거.
  // savedNoticeMs 1200: flush 직후 "자동 저장됨"이 reload 전에 안정적으로 관측되도록 여유를 둔다
  //   (400ms는 toBeVisible 폴링이 잡기 전에 reload가 발화해 saved-notice/loadCount poll과 경합).
  await setup(page, { countdown: 30, savedNoticeMs: 1200 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // flushable 합성 가드 주입: dirty=true, flush 시 sessionStorage 에 저장 흔적 기록(reload 후에도 보존).
  await page.evaluate(() => {
    const w = window as unknown as { __unsavedGuardTest?: { register: (g: unknown) => void } };
    w.__unsavedGuardTest?.register({
      id: 'syn-flushable',
      isDirty: () => true,
      flush: () => {
        sessionStorage.setItem('__flushed', '1');
      },
      label: '합성 메모',
    });
  });

  await reloadBtn(page).click();

  // flush 직후 "자동 저장됨" 노출 → 잠시 후 reload(load 카운터 2)
  await expect(page.getByTestId('app-update-saved-notice')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => loadCount(page), { timeout: 8000 }).toBe(2);

  // 저장(flush)이 새로고침보다 먼저 실행됐는지 — sessionStorage 흔적으로 확인
  const flushed = await page.evaluate(() => sessionStorage.getItem('__flushed'));
  expect(flushed).toBe('1');
});

// ── 시나리오 2 (AC-4): "지금 새로고침" 즉시 버튼 (dirty 없음) ──────────────────
test('AC-4/시나리오2: "지금 새로고침" 버튼으로 즉시 새로고침', async ({ page }) => {
  await setup(page, { countdown: 30 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  await reloadBtn(page).click();

  // dirty 없음 → 즉시 reload → load 카운터 2.
  await expect.poll(() => loadCount(page), { timeout: 8000 }).toBe(2);
});

// ── 시나리오 3 (AC-3b): 저장 경로 없는 화면(진료차트) blocking → 새로고침 보류 ──
test('AC-3b/시나리오3: blocking(저장 경로 없음) → 새로고침 보류 + 저장 안내 (유실 0)', async ({ page }) => {
  // countdown 6초 — 가드 주입 전에 만료되지 않도록 여유. (주입 후 만료 → blocking 검증)
  await setup(page, { countdown: 6 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // unsavedGuard 모듈 로드 보장 후 blocking 합성 가드 주입: dirty=true, flush 없음(진료차트 모사)
  await page.waitForFunction(
    () => Boolean((window as unknown as { __unsavedGuardTest?: unknown }).__unsavedGuardTest),
  );
  await page.evaluate(() => {
    const w = window as unknown as { __unsavedGuardTest?: { register: (g: unknown) => void } };
    w.__unsavedGuardTest?.register({
      id: 'syn-blocking',
      isDirty: () => true,
      // flush 없음 → blocking
      label: '진료차트',
    });
  });

  // 카운트다운 만료 → attemptReload → blocking 감지 → 보류 안내, reload 안 함
  await expect(banner(page)).toHaveAttribute('data-phase', 'blocked', { timeout: 8000 });
  await expect(banner(page)).toContainText('저장 후 새로고침');

  // 데이터 유실 0 — 강제 새로고침이 발화하지 않아 load 카운터는 1 그대로.
  await page.waitForTimeout(1500);
  expect(await loadCount(page)).toBe(1);
});
