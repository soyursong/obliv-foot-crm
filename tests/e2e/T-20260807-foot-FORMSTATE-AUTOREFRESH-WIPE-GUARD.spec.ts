/**
 * T-20260807-foot-FORMSTATE-AUTOREFRESH-WIPE-GUARD — 메모/차트 작성·예약 입력 중 자동 새로고침 유실 방지.
 *
 * 배경(김주연 총괄): 메모/차트 작성 중 또는 예약 입력 중에 자동 새로고침(배포감지 full-page reload)이
 *   발화하면 입력 중이던 데이터가 전부 초기화됨('자꾸' 반복 = 업무 중단).
 *
 * 처방(본 티켓): 예약 입력 폼(ReservationDetailPopup)·2번 고객차트(CustomerChartPage)를 기존 dirty-guard
 *   레지스트리(unsavedGuard/collectDirty)에 편입한다. 진료차트(MedicalChartPanel)·체크인메모
 *   (CheckInDetailSheet)·예약메모(ReservationMemoTimeline localStorage 초안)·차트메모(CustomerChartSheet
 *   dashboardRefreshBus)는 旣존 커버 → 본 티켓으로 예약/2번차트 갭을 메워 전 입력 경로 무손실 완성.
 *
 * 검증 계약(reload-gating): 자동 새로고침(UpdateBanner)이 발화하기 직전 collectDirty 로 미저장 입력을 훑어
 *   - flushable(저장 경로 보유, 예: 2번차트 handleInfoPanelSave) → 자동 저장(flush) 후 새로고침(무손실).
 *   - blocking(부분저장 위험, 예: 예약 입력 폼) → 새로고침 보류 + "저장 후 새로고침" 안내(유실 0).
 *   - dirty 없음(clean) → 정상 새로고침(보존 로직이 정상 갱신을 막지 않음, AC-3 회귀 0).
 *
 * 결정론 전략(旣존 REFRESH-BANNER-AUTOLO 관례 재사용):
 *   - /version.json page.route 모킹 → 로컬 번들과 불일치 = '새 버전'(자동 새로고침 트리거).
 *   - 카운트다운/저장안내 지연은 window.__updateCountdownSeconds / __updateSavedNoticeMs 로 단축.
 *   - 실제 새로고침 여부는 sessionStorage load 카운터로 감지(reload 가 window 리셋해도 보존).
 *   - 예약/차트 폼의 dirty 계약은 실제 라벨('예약 입력','고객차트')의 합성 가드로 재현 —
 *     RDP/CustomerChartPage 가 useUnsavedGuard 로 등록하는 것과 동일한 레지스트리 계약을 태움.
 */
import { test, expect, type Page } from '@playwright/test';

/** /version.json 을 임의의 buildId 로 모킹 → 로컬 번들과 불일치 = '새 버전'. */
async function mockNewVersion(page: Page, buildId = 'REMOTE-NEW-BUILD-FORMSTATE') {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
    });
  });
}

/** 매 문서 로드마다 sessionStorage load 카운터 증가 + 카운트다운/저장안내 지연 단축. */
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
    // reload 발화 순간 evaluate 가 navigation 으로 던질 수 있다 → -1 로 흡수(다음 polling 정상값).
    .catch(() => -1);

const banner = (page: Page) => page.getByTestId('app-update-banner');
const reloadBtn = (page: Page) => page.getByTestId('app-update-reload');

async function waitGuardApi(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __unsavedGuardTest?: unknown }).__unsavedGuardTest),
  );
}

// ── 시나리오 1 (AC1/AC2): 2번차트/메모 작성 중(flushable) → 자동 저장 후 새로고침(무손실) ──
test('시나리오1: 차트/메모 작성 중 자동 새로고침 시 자동 저장 후 갱신(입력 유실 0)', async ({ page }) => {
  await setup(page, { countdown: 30, savedNoticeMs: 1200 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // 2번차트(CustomerChartPage)가 등록하는 것과 동일한 flushable 가드 재현(라벨 '고객차트').
  await waitGuardApi(page);
  await page.evaluate(() => {
    const w = window as unknown as { __unsavedGuardTest?: { register: (g: unknown) => void } };
    w.__unsavedGuardTest?.register({
      id: 'customer-chart-2',
      isDirty: () => true,
      // 실제 handleInfoPanelSave 대응 — 저장 흔적을 sessionStorage 에 남겨(reload 후 보존) 저장 선행을 검증.
      flush: () => {
        sessionStorage.setItem('__chartFlushed', '1');
      },
      label: '고객차트',
    });
  });

  await reloadBtn(page).click();

  // 저장 완료 안내 → 새로고침(load 카운터 2). 저장(flush)이 reload 보다 먼저 실행됐는지 흔적으로 검증.
  await expect(page.getByTestId('app-update-saved-notice')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => loadCount(page), { timeout: 8000 }).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('__chartFlushed'))).toBe('1');
});

// ── 시나리오 2 (AC1/AC4): 예약 입력 중(blocking) → 자동 새로고침 보류(입력 유실 0) ──
test('시나리오2: 예약 입력 중 자동 새로고침 보류 — 입력값 유실 0', async ({ page }) => {
  await setup(page, { countdown: 6 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // 예약 입력 폼(ReservationDetailPopup)이 등록하는 것과 동일한 blocking 가드 재현(라벨 '예약 입력').
  await waitGuardApi(page);
  await page.evaluate(() => {
    const w = window as unknown as { __unsavedGuardTest?: { register: (g: unknown) => void } };
    w.__unsavedGuardTest?.register({
      id: 'reservation-detail-popup',
      isDirty: () => true,
      // flush 없음 → blocking(예약은 부분저장 위험 → 보류 + 저장 안내).
      label: '예약 입력',
    });
  });

  // 카운트다운 만료 → attemptReload → blocking 감지 → 보류(새로고침 안 함).
  await expect(banner(page)).toHaveAttribute('data-phase', 'blocked', { timeout: 8000 });
  await expect(banner(page)).toContainText('저장 후 새로고침');

  // 유실 0 — 강제 새로고침 미발화 → load 카운터 1 그대로.
  await page.waitForTimeout(1500);
  expect(await loadCount(page)).toBe(1);
});

// ── 시나리오 3 (AC2/AC3 회귀): 작성 중 아님(clean) → 자동 새로고침 정상 진행 ──
test('시나리오3: dirty 없음(조회만) → 자동 새로고침 정상 진행(보존 로직이 정상 갱신을 막지 않음)', async ({ page }) => {
  await setup(page, { countdown: 2 });
  await mockNewVersion(page);
  await page.goto('/');
  await expect(banner(page)).toBeVisible({ timeout: 8000 });
  expect(await loadCount(page)).toBe(1);

  // 가드 미등록(clean) → 카운트다운 만료 시 정상 자동 새로고침(load 카운터 2).
  await expect.poll(() => loadCount(page), { timeout: 10000 }).toBe(2);
});
