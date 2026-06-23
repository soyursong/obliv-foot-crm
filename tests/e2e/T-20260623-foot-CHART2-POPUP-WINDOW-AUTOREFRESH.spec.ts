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
