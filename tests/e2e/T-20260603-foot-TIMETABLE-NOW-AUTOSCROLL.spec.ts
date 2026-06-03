/**
 * T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL
 * 통합시간표 현재 시각 자동 스크롤 + 라이브 마커
 *
 * AC-1: 진입 시 1회 자동 스크롤 → 현재 시각 위치(가급적 뷰포트 중앙).
 *        영업시간 외 등 그리드 범위 밖이면 깨지지 말 것.
 * AC-2: 라이브 시간 마커(가로 표시줄) + 30초(≤60초) 틱 위치 갱신.
 * AC-3: "지금 시간으로 이동" 버튼(진입 스크롤 로직 재사용).
 * AC-4: 이탈/언마운트 시 clearInterval (메모리 누수 방지) — now 30초 틱 단일 인터벌.
 * AC-5: 기존 통합시간표 로딩 + 모바일 가로스크롤 회귀 없음.
 *
 * 주: E2E 실행 시각이 영업시간(10:00~20:30) 밖이면 현재 슬롯 행/마커가
 *     렌더되지 않는다. 마커 검증은 "있으면 올바르게, 없으면 깨지지 않게"로 분기.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL — 현재 시각 자동 스크롤 + 라이브 마커', () => {
  // ── 시나리오 1: 진입 자동 스크롤 + 지금 버튼 (AC-1, AC-3) ──────────────────
  test('AC-1/AC-3: 진입 시 시간표 로딩 + "지금" 버튼 클릭이 깨지지 않음', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 통합시간표 세로 스크롤 컨테이너 로딩 확인 (AC-5: 기존 로딩 회귀 없음)
    const innerScroll = page.getByTestId('timeline-inner-scroll');
    await expect(innerScroll).toBeVisible();

    // AC-3: "지금 시간으로 이동" 버튼은 오늘·시간표 뷰에서 항상 노출
    const jumpBtn = page.getByTestId('timeline-now-jump');
    await expect(jumpBtn).toBeVisible();

    // 진입 직후 자동 스크롤(AC-1)이 동작했다면, 현재 슬롯 행이 있을 때
    // 컨테이너 scrollTop 이 0 이상(중앙 정렬 시도)일 수 있다. 깨짐 없음만 보장.
    await expect(page.getByTestId('timeline-time-col')).toBeAttached();

    // 버튼 클릭 → 진입 스크롤 로직 재사용. 에러 없이 동작하고 시간표 유지.
    await jumpBtn.click();
    await page.waitForTimeout(600); // smooth scroll 안정 대기
    await expect(innerScroll).toBeVisible();

    // 현재 슬롯 행이 렌더된 경우(영업시간 내) → 뷰포트 안에 들어와야 함
    const marker = page.getByTestId('timeline-now-marker');
    if ((await marker.count()) > 0) {
      const containerBox = await innerScroll.boundingBox();
      const markerBox = await marker.first().boundingBox();
      expect(containerBox).not.toBeNull();
      expect(markerBox).not.toBeNull();
      if (containerBox && markerBox) {
        // 마커가 스크롤 컨테이너 세로 범위 내(약간의 여유 포함)에 위치
        expect(markerBox.y).toBeGreaterThanOrEqual(containerBox.y - 5);
        expect(markerBox.y).toBeLessThanOrEqual(containerBox.y + containerBox.height + 5);
      }
    }
  });

  // ── 시나리오 2: 라이브 시간 마커 (AC-2) ──────────────────────────────────
  test('AC-2: 라이브 시간 마커가 있으면 올바르게, 없으면 그리드 무손상', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const innerScroll = page.getByTestId('timeline-inner-scroll');
    await expect(innerScroll).toBeVisible();

    const marker = page.getByTestId('timeline-now-marker');
    const markerCount = await marker.count();

    if (markerCount > 0) {
      // 영업시간 내 — 마커는 단 하나(현재 슬롯), top% 스타일·라이브 라벨 보유
      expect(markerCount).toBe(1);
      await expect(marker.first()).toBeAttached();

      // top: NN% 인라인 스타일 (분 위치 비율)
      const topStyle = await marker.first().evaluate(
        (el) => (el as HTMLElement).style.top,
      );
      expect(topStyle).toMatch(/%$/);

      // 현재 시각(HH:mm) 라벨 텍스트가 마커 안에 존재
      const labelText = (await marker.first().innerText()).trim();
      expect(labelText).toMatch(/^\d{2}:\d{2}$/);
    } else {
      // 영업시간 외 — 마커 미렌더가 정상. 시간표 그리드는 깨지지 않아야 함.
      await expect(page.getByTestId('timeline-time-col')).toBeAttached();
      const rows = page.getByTestId('timeline-slot-row');
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });

  // ── 시나리오 3: 모바일 가로스크롤 회귀 없음 (AC-5) ───────────────────────
  // 주: portrait(세로) 진입 시 태블릿 정책(T-20260522)상 시간표가 자동 접힘(strip) →
  //     hscroll 회귀는 접힘과 무관하게 검증하고, 시간표를 펼친 뒤 시간열/지금버튼 검증.
  test('AC-5: 모바일 portrait — 가로스크롤 회귀 없음 + 펼친 시간표에 sticky 시간열·지금 버튼', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 기존 모바일 가로스크롤 동선(T-20260514) 회귀 없음 — 접힘 여부와 무관
    const scrollContainer = page.getByTestId('dashboard-content-scroll');
    await expect(scrollContainer).toBeVisible();
    const isScrollable = await scrollContainer.evaluate(
      (el) => el.scrollWidth > el.clientWidth || getComputedStyle(el).overflowX !== 'hidden',
    );
    expect(isScrollable).toBe(true);

    // portrait 자동 접힘 → strip의 "시간표 펼치기"로 펼친다
    const unfold = page.getByLabel('시간표 펼치기');
    if (await unfold.count() > 0) {
      await unfold.first().click();
      await page.waitForTimeout(300);
    }

    // 펼친 뒤 sticky 시간 컬럼 유지 (회귀 없음)
    const timeCol = page.getByTestId('timeline-time-col');
    await expect(timeCol).toBeAttached();
    const pos = await timeCol.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe('sticky');

    // AC-3: 펼친 시간표에 "지금" 버튼 노출 + 클릭이 깨지지 않음
    const jumpBtn = page.getByTestId('timeline-now-jump');
    await expect(jumpBtn).toBeVisible();
    await jumpBtn.click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('timeline-inner-scroll')).toBeVisible();

    // 가로 300px 스크롤 후에도 시간 컬럼이 좌측 근처 고정 (회귀 없음)
    await scrollContainer.evaluate((el) => { el.scrollLeft = 300; });
    const box = await timeCol.boundingBox();
    if (box) expect(box.x).toBeLessThan(50);
  });
});
