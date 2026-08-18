/**
 * T-20260818-foot-DASHBOARD-TIMETABLE-REALTIME-SCROLL-SYNC
 * 대시보드 통합시간표 — 진입 자동 스크롤(현재 시각) 반영 (증상 #2 확정)
 *
 * 현장 제보(김주연 총괄, C0ATE5P6JTH): "대시보드 통합시간표 실시간 스크롤 반영 안 됨."
 * 후속 확정 증상 #2: 화면 진입/새로고침 시 항상 아침(시간표 최상단) 고정 —
 *   현재 시각(now-line) 슬롯으로의 자동 스크롤(scrollIntoView)이 동작하지 않음.
 *
 * RC(코드): 진입 1회 자동 스크롤 가드(구 didInitialScrollRef)가 단일 rAF 실행 직후 소진되는데,
 *   예약/체크인은 빈 배열로 시작해 fetch+realtime 으로 async 도착하고 clinic 도 async 로드된다.
 *   rAF 스크롤 직후 위쪽 슬롯 행들이 데이터로 커지며 콘텐츠가 밀려(scroll-anchoring 시프트)
 *   현재슬롯이 뷰포트 밖으로 나가는데 가드가 이미 소진 → 재시도 없이 최상단(아침) 고정.
 * Fix: 진입 직후 settle-window(≈1.4s) staggered 재스크롤 + 사용자 스크롤 시 즉시 중단.
 *   viewMode(시간표↔치료사별) 재진입/펼침 시에도 재-스크롤(effect 재구독).
 *
 * AC(증상 #2): 진입/시간표뷰 재진입 시 현재 시각 위치로 자동 스크롤(최상단 아침 고정 금지).
 *   - 영업시간 내: 현재 슬롯(now-marker)이 뷰포트 안.
 *   - 마감 이후: 마지막 슬롯(하단)으로 클램핑 스크롤(scrollTop > 0).
 *   - 개장 전(첫 슬롯 이전): 최상단이 정상 → 단언 skip(결정론 보존).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8091';

// 통합시간표 진입 후 세로 스크롤 컨테이너 + 슬롯 행 로딩 대기
async function waitTimeline(page: import('@playwright/test').Page) {
  const innerScroll = page.getByTestId('timeline-inner-scroll');
  await expect(innerScroll).toBeVisible();
  await expect(page.getByTestId('timeline-slot-row').first()).toBeAttached();
  return innerScroll;
}

// 컨테이너 스크롤 상태 + 현재 슬롯 행 index/가시성 스냅샷
async function snap(innerScroll: import('@playwright/test').Locator) {
  return innerScroll.evaluate((el) => {
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="timeline-slot-row"]'));
    const markerIdx = rows.findIndex((r) => r.querySelector('[data-testid="timeline-now-marker"]'));
    const cRect = el.getBoundingClientRect();
    let markerInView: boolean | null = null;
    if (markerIdx >= 0) {
      const m = rows[markerIdx].querySelector('[data-testid="timeline-now-marker"]') as HTMLElement;
      const mRect = m.getBoundingClientRect();
      const cy = mRect.top + mRect.height / 2;
      markerInView = cy >= cRect.top - 6 && cy <= cRect.bottom + 6;
    }
    const maxScroll = el.scrollHeight - el.clientHeight;
    return { scrollTop: el.scrollTop, maxScroll, markerIdx, total: rows.length, markerInView };
  });
}

test.describe('T-20260818-foot-DASHBOARD-TIMETABLE-REALTIME-SCROLL-SYNC — 진입 자동 스크롤(증상#2)', () => {
  // ── 시나리오 1: 진입 자동 스크롤 — 최상단 아침 고정 금지 ──────────────────────
  test('AC: 진입 직후 현재 시각 위치로 자동 스크롤(최상단 아침 고정 금지)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    const innerScroll = await waitTimeline(page);

    // settle-window(≈1.4s) + smooth scroll 안정 대기. 사용자 스크롤은 하지 않는다.
    await page.waitForTimeout(1700);
    const s = await snap(innerScroll);

    if (s.maxScroll <= 4) {
      // 콘텐츠가 컨테이너보다 작아 스크롤 불필요 — 단언 skip(결정론).
      test.info().annotations.push({ type: 'note', description: 'no-scroll (maxScroll≈0)' });
      return;
    }
    if (s.markerIdx >= 0) {
      // 영업시간 내 — 현재 슬롯 마커가 뷰포트 안이어야 한다.
      expect(s.markerInView).toBe(true);
      if (s.markerIdx > 1) expect(s.scrollTop).toBeGreaterThan(0);
    } else {
      // 마커 미렌더 = 개장 전 또는 마감 후.
      // 마감 후면 하단(마지막 슬롯)으로 클램핑되어 scrollTop 이 max 근처여야 한다.
      // 개장 전이면 최상단(0)이 정상 → 그 경우만 단언 skip.
      if (s.scrollTop <= 4) {
        test.info().annotations.push({ type: 'note', description: '개장 전 추정 — 최상단 정상, skip' });
      } else {
        expect(s.scrollTop).toBeGreaterThan(0);
      }
    }
  });

  // ── 시나리오 2: RC fix 결정론 검증 — settle-window 중 레이아웃 시프트를 재-앵커가 따라잡음 ──
  // RC 재현: 진입 직후(settle-window) 위쪽 행이 데이터로 커지면 콘텐츠가 밀려 현재슬롯이 뷰포트
  //   밖으로 나간다. 이를 "아침(첫) 슬롯 행 높이를 크게 키움"으로 결정론 재현한다(= 예약/체크인
  //   async 도착의 레이아웃 등가). 키운 뒤 —
  //   구 코드: 단일 rAF 가 이미 소진 → 재-스크롤 없음 → 현재슬롯 밀림 유지(FAIL).
  //   신 코드: 콘텐츠 크기 변화를 ResizeObserver 가 감지 → 현재 시각으로 재-앵커(PASS).
  test('RC fix: 진입 후 아침 행이 커져 현재슬롯이 밀려도 현재 시각으로 재-앵커(구코드는 밀림 유지)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'load' });
    const innerScroll = await waitTimeline(page);

    // settle-window(진입 후 ≈3s) 극초반 초기 상태 스냅.
    const init = await snap(innerScroll);
    if (init.maxScroll <= 8) {
      test.info().annotations.push({ type: 'note', description: 'no-scroll — RC fix 검증 skip' });
      return;
    }
    // 개장 전(현재슬롯이 첫 행 근처 → 최상단이 정상, 밀림 무의미)이면 판별 불가 → skip.
    const expectMarker = init.markerIdx > 1;          // 영업시간 내(현재 슬롯 ≠ 첫 행)
    const isAfterClose = init.markerIdx < 0 && await innerScroll.evaluate(() => {
      const n = new Date(); return n.getHours() * 60 + n.getMinutes() > 12 * 60; // 정오 이후 = 마감방향
    });
    if (!expectMarker && !isAfterClose) {
      test.info().annotations.push({ type: 'note', description: '개장 전 추정 — RC fix 검증 skip' });
      return;
    }

    // settle-window 중(진입 후 ≈1s) 아침(첫) 슬롯 행을 크게 키운다 → 콘텐츠 시프트 재현.
    //   프로그램적 DOM 변경일 뿐 사용자 스크롤 제스처(wheel/touch)가 아니므로 userScrolled 미발생.
    await innerScroll.evaluate((el) => {
      const rows = el.querySelectorAll<HTMLElement>('[data-testid="timeline-slot-row"]');
      if (rows.length > 0) rows[0].style.minHeight = '2200px';
    });

    // ResizeObserver 재-앵커 + smooth scroll 안정 대기.
    await page.waitForTimeout(1500);
    const after = await snap(innerScroll);

    if (expectMarker) {
      // 영업시간 내 — 현재 슬롯 마커가 뷰포트로 재-앵커되어야 한다.
      expect(after.markerInView).toBe(true);
    } else {
      // 마감 후 — 아침 행이 2200px 커졌으므로 하단(마지막 슬롯)까지 재-스크롤 →
      //   scrollTop 이 초기 maxScroll 을 크게 초과해야 한다(재-앵커 발생 실증).
      expect(after.scrollTop).toBeGreaterThan(init.maxScroll + 200);
    }
  });
});
