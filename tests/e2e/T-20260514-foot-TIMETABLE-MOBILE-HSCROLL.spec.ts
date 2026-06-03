/**
 * T-20260514-foot-TIMETABLE-MOBILE-HSCROLL
 * 통합시간표 모바일 가로스크롤 + 시간 컬럼 sticky
 *
 * AC-1: 통합시간표 영역에 가로 스크롤 추가 (모바일에서 좌우 스와이프)
 * AC-2: 시간 컬럼(좌측)은 고정(sticky) — 스크롤해도 항상 보임
 * AC-3: PC에서는 기존과 동일하게 유지 (변경 없음)
 *
 * T-20260603-foot-TIMETABLE-HSCROLL-SPEC-REFRESH (테스트만 갱신, 프로덕션 무변경):
 *   T-20260522 portrait 자동 fold 정책 이후 portrait(390px) 진입 시 통합시간표가
 *   세로 스트립으로 자동 접혀 timeline-time-col 이 렌더되지 않는다. 아래 AC-2 2건은
 *   그 결과 stale 실패(CI 노이즈)였다. NOW-AUTOSCROLL(commit 1692e6a)이 도입한
 *   "fold 먼저 펼친 뒤 검증" 패턴을 적용 — 원 검증의도(가로스크롤 + 좌측 시간컬럼 sticky)는 유지.
 */
import { test, expect } from '@playwright/test';

/** portrait 자동 fold(T-20260522) 상태면 "시간표 펼치기"로 통합시간표를 펼친다. */
async function unfoldTimelineIfFolded(page: import('@playwright/test').Page) {
  const unfold = page.getByLabel('시간표 펼치기');
  if ((await unfold.count()) > 0) {
    await unfold.first().click();
    await page.waitForTimeout(300); // fold→펼침 전환 안정 대기
  }
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260514-foot-TIMETABLE-MOBILE-HSCROLL — 통합시간표 모바일 가로스크롤', () => {
  // ── 시나리오 1: 모바일 가로 스크롤 정상 동선 ──────────────────────────────
  test('AC-1: 모바일(≤768px) — dashboard-content-scroll 가로 스크롤 컨테이너 존재', async ({ page }) => {
    // 모바일 뷰포트 설정 (iPhone 14 Pro)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 대시보드 콘텐츠 스크롤 컨테이너 존재 확인
    const scrollContainer = page.getByTestId('dashboard-content-scroll');
    await expect(scrollContainer).toBeVisible();

    // 모바일에서 overflow-x: auto로 가로 스크롤 가능한지 확인
    // scrollWidth > clientWidth 이면 가로 스크롤 콘텐츠가 있음
    const isScrollable = await scrollContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth || getComputedStyle(el).overflowX !== 'hidden';
    });
    expect(isScrollable).toBe(true);
  });

  test('AC-2: 모바일 — 시간 컬럼 헤더(timeline-time-col)가 sticky left-0으로 고정', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // portrait 자동 fold(T-20260522) → 펼친 뒤 시간 컬럼 검증
    await unfoldTimelineIfFolded(page);

    // 시간 컬럼 헤더(timeline-time-col)가 DOM에 존재 + 보임
    const timeCol = page.getByTestId('timeline-time-col');
    await expect(timeCol).toBeAttached();

    // sticky left-0 z-20 클래스 적용 여부 확인
    const hasSticky = await timeCol.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.position === 'sticky';
    });
    expect(hasSticky).toBe(true);

    // left: 0px 인지 확인
    const leftVal = await timeCol.evaluate((el) => {
      return getComputedStyle(el).left;
    });
    expect(leftVal).toBe('0px');
  });

  test('AC-2: 모바일 — 가로 스크롤 후에도 시간 컬럼이 뷰포트 내 남아 있음', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const scrollContainer = page.getByTestId('dashboard-content-scroll');
    await expect(scrollContainer).toBeVisible();

    // portrait 자동 fold(T-20260522) → 펼친 뒤 가로스크롤/sticky 검증
    await unfoldTimelineIfFolded(page);

    // 가로로 300px 스크롤
    await scrollContainer.evaluate((el) => {
      el.scrollLeft = 300;
    });

    // 스크롤 후 시간 컬럼 헤더가 여전히 뷰포트 left 근처에 위치
    const timeCol = page.getByTestId('timeline-time-col');
    await expect(timeCol).toBeAttached();

    const boundingBox = await timeCol.boundingBox();
    // sticky 적용 시 left는 0~40px 이내로 고정
    if (boundingBox) {
      expect(boundingBox.x).toBeLessThan(50);
    }
  });

  // ── 시나리오 2: PC 변경 없음 ─────────────────────────────────────────────
  test('AC-3: PC(≥769px) — 가로 스크롤 없이 전체 레이아웃 표시', async ({ page }) => {
    // PC 뷰포트 (iPad Landscape / 데스크탑)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const scrollContainer = page.getByTestId('dashboard-content-scroll');
    await expect(scrollContainer).toBeVisible();

    // PC에서 md:overflow-hidden — 가로 스크롤바 없음
    const overflowX = await scrollContainer.evaluate((el) => {
      return getComputedStyle(el).overflowX;
    });
    // 'hidden' 이어야 함 (md:overflow-hidden 적용)
    expect(overflowX).toBe('hidden');

    // 시간 컬럼 헤더가 존재 (레이아웃 깨지지 않음)
    await expect(page.getByTestId('timeline-time-col')).toBeAttached();
  });
});
