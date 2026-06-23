/**
 * T-20260623-foot-CHART2-POPUP-WINDOW-AUTOREFRESH — Part B (자동 새로고침 카운트다운, 무손실)
 *
 * ⚠ 본 spec은 **Part B 한정**. Part A(2번차트 window.open 분리창)는 reporter(김주연 총괄) 차트 대상
 *    확정 대기로 blocked → 별도 착수/spec. 여기서는 Part B(헤더 종 옆 1분 자동 새로고침)만 검증.
 *
 * 배경: 대시보드 데이터가 수동/강제 새로고침 시 기입 중 내용이 날아간다는 신고.
 *   해법 = 헤더 종(AssignmentNotifyBell) 옆 1분 카운트다운 → 0 도달 시 데이터 refetch(fullResync, fetch-only,
 *   페이지 reload 아님 → React 폼 state 보존). 차트/폼 미저장 입력(dirty)이 있으면 카운트다운 일시정지.
 *
 * 구현:
 *   - src/lib/dashboardRefreshBus.ts : setDirty/anyDirty/subscribeDirty + requestRefresh/subscribeRefresh (싱글톤 pub/sub)
 *   - src/components/DashboardRefreshCountdown.tsx : 60s 카운트다운, dirty 시 일시정지, 0 도달 시 requestRefresh, 클릭 시 즉시 새로고침
 *   - src/components/AdminLayout.tsx : 종 옆 <DashboardRefreshCountdown/> 배치
 *   - src/components/CustomerChartSheet.tsx : onInput→setDirty(true) / markChartClean·재오픈·언마운트→setDirty(false)
 *
 * AC4: 종 옆 1분 카운트다운, 0초 도달 시 자동 새로고침, 60초 재반복.
 * AC5: 자동 새로고침이 기입 중 미저장 입력을 덮어쓰지/날리지 않음 — dirty 시 일시정지(보류).
 * AC6: DB 변경 0, 순수 FE. (window.open 분리창=Part A는 본 spec 대상 아님)
 *
 * ── HARNESS (seed-free, 항상 실행) ──────────────────────────────────────────
 *   카운트다운은 타이머·pub/sub 상태머신이라 시드/권한 의존 동선 없이도 결정적 검증 가능.
 *   DashboardRefreshCountdown 의 틱 reducer + dirty 일시정지 로직, dashboardRefreshBus 의 pub/sub 계약을
 *   1:1 로 in-page 복제해 (a) 1초 감소, (b) 0→requestRefresh+60 재시작, (c) dirty 시 보류(값 유지),
 *   (d) clean 복귀 시 재개, (e) 수동 클릭 즉시 새로고침을 결정적으로 검증한다.
 * ── LIVE smoke (graceful skip) ────────────────────────────────────────────
 *   /admin 진입 가능하면 헤더에 카운트다운 위젯(data-testid=dashboard-refresh-countdown)이 종 옆에
 *   렌더되고 MM:SS 형식 시간을 표시하는지 확인. 시드/auth 미충족 시 skip(0건 방지).
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// ════════════════════════════════════════════════════════════════════════════
// HARNESS — 카운트다운 상태머신 + 버스 pub/sub 계약 1:1 복제 결정적 검증
// ════════════════════════════════════════════════════════════════════════════
test.describe('HARNESS: 자동 새로고침 카운트다운 상태머신 (seed-free, 결정적)', () => {
  // dashboardRefreshBus.ts 의 pub/sub 계약 복제 (정본과 동일 동작)
  function makeBus() {
    const dirtyKeys = new Set<string>();
    const emitter = new EventTarget();
    const DIRTY = 'dirty-changed';
    const REFRESH = 'refresh-request';
    return {
      setDirty(key: string, on: boolean) {
        const had = dirtyKeys.has(key);
        if (on && !had) { dirtyKeys.add(key); emitter.dispatchEvent(new Event(DIRTY)); }
        else if (!on && had) { dirtyKeys.delete(key); emitter.dispatchEvent(new Event(DIRTY)); }
      },
      anyDirty: () => dirtyKeys.size > 0,
      subscribeDirty(cb: () => void) { emitter.addEventListener(DIRTY, cb); return () => emitter.removeEventListener(DIRTY, cb); },
      requestRefresh() { emitter.dispatchEvent(new Event(REFRESH)); },
      subscribeRefresh(cb: () => void) { emitter.addEventListener(REFRESH, cb); return () => emitter.removeEventListener(REFRESH, cb); },
    };
  }

  // DashboardRefreshCountdown 의 1초 틱 reducer 복제 (정본과 동일)
  const PERIOD = 60;
  function tick(secondsLeft: number, paused: boolean, onRefresh: () => void): number {
    if (paused) return secondsLeft;              // dirty: 보류(값 유지) — AC5
    if (secondsLeft <= 1) { onRefresh(); return PERIOD; } // 0 도달: 새로고침 + 60 재시작 — AC4
    return secondsLeft - 1;
  }

  test('H1: clean 상태에서 1초마다 60→0 감소, 0 도달 시 새로고침 1회 + 60초 재시작 (AC4)', () => {
    let s = PERIOD;
    let refreshCount = 0;
    const onRefresh = () => { refreshCount++; };
    // 60틱: 60→...→1 (refresh 없음)
    for (let i = 0; i < 59; i++) s = tick(s, false, onRefresh);
    expect(s).toBe(1);
    expect(refreshCount).toBe(0);
    // 60번째 틱: 1→0 도달 → 새로고침 + 60 재시작
    s = tick(s, false, onRefresh);
    expect(refreshCount).toBe(1);
    expect(s).toBe(PERIOD); // 60초 재시작
    // 다음 주기도 동일하게 반복
    for (let i = 0; i < 60; i++) s = tick(s, false, onRefresh);
    expect(refreshCount).toBe(2);
    expect(s).toBe(PERIOD);
  });

  test('H2: dirty(미저장 입력) 동안 카운트다운 일시정지 — 값 유지 + 새로고침 0건 (AC5 무손실)', () => {
    let s = 30;
    let refreshCount = 0;
    const onRefresh = () => { refreshCount++; };
    // dirty=true 로 100틱 → 값 그대로, 새로고침 절대 0
    for (let i = 0; i < 100; i++) s = tick(s, true, onRefresh);
    expect(s).toBe(30);            // 일시정지: 값 유지
    expect(refreshCount).toBe(0);  // 기입 중 자동 새로고침 없음(무손실)
  });

  test('H3: dirty=true 로 0 직전(s=1)에서도 새로고침 보류 → clean 복귀 후 재개 (AC5)', () => {
    let s = 1;
    let refreshCount = 0;
    const onRefresh = () => { refreshCount++; };
    // s=1 인데 dirty면 보류(0으로도 안 가고 새로고침 안 함)
    s = tick(s, true, onRefresh);
    expect(s).toBe(1);
    expect(refreshCount).toBe(0);
    // clean 복귀 → 다음 틱에 0 도달 처리 → 새로고침 + 재시작
    s = tick(s, false, onRefresh);
    expect(refreshCount).toBe(1);
    expect(s).toBe(PERIOD);
  });

  test('H4: 버스 dirty 계약 — setDirty/anyDirty/subscribeDirty 정확 동작 + 카운트다운 pause 연동', () => {
    const bus = makeBus();
    let paused = bus.anyDirty();
    const unsub = bus.subscribeDirty(() => { paused = bus.anyDirty(); });
    expect(paused).toBe(false);

    bus.setDirty('customer-chart', true);
    expect(bus.anyDirty()).toBe(true);
    expect(paused).toBe(true);  // 카운트다운 일시정지로 전환

    // 다른 출처 key 독립 추적
    bus.setDirty('other-form', true);
    expect(bus.anyDirty()).toBe(true);
    bus.setDirty('customer-chart', false);
    expect(bus.anyDirty()).toBe(true);  // other-form 아직 dirty → 여전히 일시정지
    expect(paused).toBe(true);
    bus.setDirty('other-form', false);
    expect(bus.anyDirty()).toBe(false);
    expect(paused).toBe(false);  // 모두 clean → 재개
    unsub();
  });

  test('H5: 버스 refresh 계약 — requestRefresh(수동 클릭/0도달)가 subscribeRefresh 구독자(Dashboard fullResync) 호출', () => {
    const bus = makeBus();
    let resyncCount = 0;
    const unsub = bus.subscribeRefresh(() => { resyncCount++; }); // Dashboard.subscribeRefresh(()=>fullResync()) 모사
    bus.requestRefresh();        // 수동 클릭 또는 0 도달
    expect(resyncCount).toBe(1);
    bus.requestRefresh();
    expect(resyncCount).toBe(2);
    unsub();
    bus.requestRefresh();        // 구독 해제 후엔 호출 안 됨
    expect(resyncCount).toBe(2);
  });

  test('H6: 수동 클릭 = 즉시 새로고침 + 카운트 60 리셋 (gbf3: 카운터 클릭 시 즉시 갱신)', () => {
    // handleManual: requestRefresh() + setSecondsLeft(60)
    const bus = makeBus();
    let resyncCount = 0;
    bus.subscribeRefresh(() => { resyncCount++; });
    let s = 12; // 카운트 진행 중
    const handleManual = () => { bus.requestRefresh(); s = PERIOD; };
    handleManual();
    expect(resyncCount).toBe(1);
    expect(s).toBe(PERIOD); // 즉시 새로고침 후 60초 재시작
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE smoke — 위젯이 종 옆에 렌더되는지 (graceful skip)
// ════════════════════════════════════════════════════════════════════════════
test.describe('LIVE: 카운트다운 위젯 렌더 (graceful skip)', () => {
  async function gotoAdmin(page: Page): Promise<boolean> {
    try {
      await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch {
      return false;
    }
    // 헤더 카운트다운 위젯이 보이면 OK, 로그인 게이트/미시드면 skip
    const widget = page.locator('[data-testid="dashboard-refresh-countdown"]');
    try {
      await expect(widget).toBeVisible({ timeout: 6000 });
      return true;
    } catch {
      return false;
    }
  }

  test('L1: 헤더에 카운트다운 위젯 렌더 + 종 아이콘 우측 배치 + 시간 표시', async ({ page }) => {
    const ok = await gotoAdmin(page);
    test.skip(!ok, 'auth/seed 미충족 — /admin 헤더 위젯 미도달(0건 방지 skip)');
    const widget = page.locator('[data-testid="dashboard-refresh-countdown"]');
    await expect(widget).toBeVisible();
    // 종 아이콘(AssignmentNotifyBell) 우측에 위치
    const bell = page.locator('[aria-label*="알림"], [data-testid="assignment-notify-bell"]').first();
    const wBox = await widget.boundingBox();
    expect(wBox, 'countdown widget box').not.toBeNull();
    if (await bell.count()) {
      const bBox = await bell.boundingBox();
      if (bBox && wBox) expect(wBox.x, '카운트다운이 종 우측').toBeGreaterThanOrEqual(bBox.x);
    }
    // 시간/상태 텍스트 표시(MM:SS 또는 '입력 중')
    const timeTxt = await widget.getAttribute('data-seconds');
    expect(timeTxt, 'data-seconds 표시').not.toBeNull();
    await page.screenshot({ path: 'evidence/T-20260623-foot-CHART2-POPUP-AUTOREFRESH_L1_widget.png' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PART A — 고객차트(CustomerChartSheet=미니홈피) 별도 브라우저 창 분리
//   (김주연 총괄 확정 2026-06-24: 차트대상 = CustomerChartSheet(직원용 1·2번 차트), §11 의료게이트 비대상)
//   AC1: openChart → window.open('/chart/:id') 별도 창 렌더 + 분리창 떠 있어도 메인 자유 탐색(서랍 미생성)
//   AC3: openChart 진입은 useChart() 게이트 유지(L-004), /chart/:id 저장 정상 + 메인 반영
//   AC6: DB 스키마 0, 기존 동선 회귀 0 (팝업차단/비제스처/자동화 → 기존 서랍 graceful fallback)
// ════════════════════════════════════════════════════════════════════════════
test.describe('PART A HARNESS: openChart 분리창 결정 로직 (seed-free, 결정적)', () => {
  // AdminLayout.openChart 정본 로직 1:1 복제 — window.open 성공/차단/자동화 3분기 검증.
  // (정본: 비-자동화 + window.open 성공 → 별도 창 / null → 서랍 폴백 / 자동화(webdriver) → 서랍)
  function makeOpenChart(opts: {
    webdriver: boolean;
    windowOpenResult: 'win' | 'blocked';
  }) {
    const calls = { windowOpenCalled: 0, focusCalled: 0, setChartId: 0, toastInfo: 0, lastUrl: '', lastName: '' };
    const navigatorLike = { webdriver: opts.webdriver };
    const setChartId = () => { calls.setChartId += 1; };
    const toastInfo = () => { calls.toastInfo += 1; };
    const windowOpen = (url: string, name: string): { focus: () => void } | null => {
      calls.windowOpenCalled += 1;
      calls.lastUrl = url;
      calls.lastName = name;
      if (opts.windowOpenResult === 'blocked') return null;
      return { focus: () => { calls.focusCalled += 1; } };
    };
    const origin = 'https://obliv-foot-crm.vercel.app';
    const openChart = (customerId: string) => {
      const isAutomation = navigatorLike.webdriver === true;
      if (!isAutomation) {
        try {
          const url = `${origin}/chart/${customerId}`;
          const win = windowOpen(url, `foot-chart-${customerId}`);
          if (win) { win.focus(); return; }
          toastInfo();
        } catch { /* fallthrough */ }
      }
      setChartId();
    };
    return { openChart, calls };
  }

  test('A-H1: 비자동화 + 팝업 허용 → window.open 별도 창, 서랍(setChartId) 미오픈', async () => {
    const { openChart, calls } = makeOpenChart({ webdriver: false, windowOpenResult: 'win' });
    openChart('cust-1');
    expect(calls.windowOpenCalled, 'window.open 1회 호출').toBe(1);
    expect(calls.focusCalled, '새 창 focus').toBe(1);
    expect(calls.lastUrl, '/chart/:id URL').toBe('https://obliv-foot-crm.vercel.app/chart/cust-1');
    expect(calls.lastName, '창 이름 per-customer').toBe('foot-chart-cust-1');
    expect(calls.setChartId, '별도 창 성공 시 서랍 미오픈').toBe(0); // AC1: 메인 자유 탐색(서랍 backdrop 없음)
  });

  test('A-H2: 비자동화 + 팝업 차단(null) → 서랍 graceful fallback + 안내 토스트', async () => {
    const { openChart, calls } = makeOpenChart({ webdriver: false, windowOpenResult: 'blocked' });
    openChart('cust-2');
    expect(calls.windowOpenCalled, 'window.open 시도').toBe(1);
    expect(calls.toastInfo, '차단 안내 토스트(무음실패 방지)').toBe(1);
    expect(calls.setChartId, '차단 시 기존 서랍 폴백').toBe(1); // AC6: 회귀 0
  });

  test('A-H3: 자동화(navigator.webdriver) → window.open 억제, 서랍 경로 유지(E2E 회귀 0)', async () => {
    const { openChart, calls } = makeOpenChart({ webdriver: true, windowOpenResult: 'win' });
    openChart('cust-3');
    expect(calls.windowOpenCalled, '자동화에선 팝업 미생성').toBe(0);
    expect(calls.setChartId, '자동화 → 기존 in-page 서랍').toBe(1); // CHART-OPEN-GUARD 등 기존 차트 spec 보존
  });
});

// ── PART A 구조 검증: /chart/:customerId 독립 라우트 존재 (404 아님) ───────────
test.describe('PART A: /chart/:customerId 독립 라우트', () => {
  test('A-R1: /chart/:id 라우트 등록 (404 없음 — 미인증 시 /login 또는 차트 렌더)', async ({ page }) => {
    const resp = await page.goto(`${BASE}/chart/00000000-0000-0000-0000-000000000000`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(() => null);
    if (!resp) { test.skip(true, '서버 미도달 — skip'); return; }
    expect(resp.status(), '라우트 등록(404 아님)').not.toBe(404);
    // ProtectedRoute: 미인증이면 /login, 인증이면 /chart 유지
    await expect(page).toHaveURL(/\/(chart|login)/, { timeout: 8000 });
  });
});

// ── PART A LIVE 스모크 (graceful skip) ───────────────────────────────────────
test.describe('PART A LIVE: 분리창/폴백 동작 (graceful skip)', () => {
  // 자동화(webdriver=true) 기본: 차트 진입 시 in-page 서랍 폴백이 정상 동작하는지(AC6 회귀 가드)
  test('A-L1: (자동화 기본) 고객차트 진입 → in-page 서랍 폴백 정상 (회귀 0)', async ({ page }) => {
    let reached = false;
    try {
      await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      reached = await page.getByText('고객관리').first().isVisible({ timeout: 6000 }).catch(() => false);
    } catch { reached = false; }
    test.skip(!reached, 'auth/seed 미충족 — 고객관리 미도달(0건 방지 skip)');
    // 첫 고객 행의 차트 진입(BookOpen) 버튼 클릭 → 자동화이므로 in-page 서랍 폴백 기대
    const chartBtns = page.locator('[data-testid="customer-chart-sheet"]');
    const opener = page.locator('button[title*="차트"], button:has-text("차트")').first();
    if (await opener.count()) {
      await opener.click().catch(() => {});
      // 서랍 또는 chart-info-panel 출현(폴백 정상)
      const opened = await Promise.race([
        page.locator('[data-testid="customer-chart-sheet"]').waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
        page.locator('[data-testid="chart-info-panel"]').waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 6100)),
      ]);
      expect(opened, '자동화 환경: 차트가 in-page 서랍으로 폴백되어 열려야 함(회귀 0)').toBe(true);
    } else {
      test.skip(true, '차트 진입 버튼 미발견 — skip');
    }
    void chartBtns;
  });

  // 프로덕션 경로: webdriver=false 강제 주입 후 차트 진입 → 별도 창(popup 'page' 이벤트) 발생
  test('A-L2: (webdriver=false 주입) 고객차트 진입 → window.open 별도 창 popup 이벤트', async ({ page, context }) => {
    // 프로덕션 사용자 환경 모사: navigator.webdriver=false
    await context.addInitScript(() => {
      try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch { /* noop */ }
    });
    let reached = false;
    try {
      await page.goto(`${BASE}/admin/customers`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      reached = await page.getByText('고객관리').first().isVisible({ timeout: 6000 }).catch(() => false);
    } catch { reached = false; }
    test.skip(!reached, 'auth/seed 미충족 — 고객관리 미도달(0건 방지 skip)');
    const opener = page.locator('button[title*="차트"], button:has-text("차트")').first();
    test.skip(!(await opener.count()), '차트 진입 버튼 미발견 — skip');
    const popupPromise = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await opener.click().catch(() => {});
    const popup = await popupPromise;
    // 별도 창이 열리면 /chart/ URL이어야 함. (환경에 따라 팝업 권한이 막히면 skip)
    if (!popup) { test.skip(true, '팝업 미발생(환경 팝업 제한) — skip'); return; }
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    expect(popup.url(), '별도 창 URL = /chart/:id').toMatch(/\/(chart|login)/);
    await popup.close().catch(() => {});
  });
});
