/**
 * T-20260609-foot-RESV-LIVE-AUTOSCROLL
 * 예약관리 화면 현재시각 자동 스크롤 (실시간 반영)
 *
 * 배경 (풋센터 현장):
 *   대시보드 통합시간표(T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL)처럼 예약관리 탭도
 *   진입 시 현재 시각 슬롯이 보이도록 자동 스크롤되길 요청.
 *   → 신규 메커니즘 도입 없이 대시보드의 auto-scroll 패턴
 *      (now 30초 틱 + isToday 가드 + 진입 1회 scrollIntoView('center') + 가장자리 클램핑)을
 *      Reservations 타임테이블에 그대로 이식.
 *
 * 변경 (presentation only, DB/EF 무변경 — src/pages/Reservations.tsx):
 *   - now 상태 + 30초 인터벌, gridSlots 단일화, currentSlot(slot_interval 내림) 산출.
 *   - 스크롤 컨테이너 ref + 현재 슬롯 행 ref(data-testid=resv-slot-row, data-slot-time).
 *   - 진입/오늘 포함 뷰 복귀 시 1회 자동 스크롤(사용자 스크롤 보존), 로딩 완료 후 트리거.
 *
 * AC:
 *   AC-1: 예약관리 진입 시 현재 시각 슬롯이 뷰포트 내로 자동 스크롤.
 *   AC-2: 시간 흐름/주기 갱신 시 현재 시각 위치 반영 (30초 틱 — 대시보드 동일).
 *   AC-3: 대시보드 기존 로직 재사용(별도 메커니즘 금지) → 동작 일관성.
 *   AC-4: 사용자 수동 스크롤 직후 즉시 끼어들지 않음(진입 1회 정책).
 *   AC-5: 오늘이 아닌 날짜/주에서는 자동 스크롤 미적용.
 *
 * 주: E2E 실행 시각이 영업시간(10:00~) 밖이면 현재 슬롯 행이 그리드 범위 밖일 수 있음.
 *     "있으면 올바르게, 없으면 깨지지 않게"로 분기 검증한다.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 그리드 시간 행 메타: 현재시각 / 첫·마지막 슬롯 / 영업시간 내 여부 / 현재 슬롯(now 이하 최댓값). */
async function gridMeta(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="resv-slot-row"]'));
    const tm = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
    const times = rows.map((r) => r.dataset.slotTime ?? '').filter(Boolean);
    const firstMin = times.length ? tm(times[0]) : 0;
    const lastMin = times.length ? tm(times[times.length - 1]) : 0;
    let cur: string | null = null;
    let curMin = -1;
    for (const t of times) {
      const m = tm(t);
      if (m <= nowMin && m > curMin) { curMin = m; cur = t; }
    }
    return { nowMin, firstMin, lastMin, currentSlotTime: cur, rowCount: rows.length };
  });
}

/** 스크롤이 멈출 때까지(연속 동일 2회) 대기 후 최종 scrollTop 반환. */
async function settleScroll(page: Page): Promise<number> {
  const container = page.getByTestId('resv-timetable-scroll');
  let prev = -1;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(200);
    const cur = await container.evaluate((el) => (el as HTMLElement).scrollTop);
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}

test.describe('T-20260609-foot-RESV-LIVE-AUTOSCROLL — 예약관리 현재시각 자동 스크롤', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndWaitForDashboard(page);
  });

  // ── 시나리오 1: 진입 자동 스크롤 (AC-1/AC-3) ──────────────────────────────
  // 대시보드와 동일: 영업시간 내 → 현재 슬롯 행을 뷰포트로(center) / 영업시간 외 → 가장자리 클램핑.
  test('AC-1/AC-3: 예약관리 진입 시 현재 시각 위치로 자동 스크롤(영업시간 내) 또는 가장자리 클램핑(영업시간 외)', async ({ page }) => {
    await page.goto('/admin/reservations'); // 기본 week 뷰 = 이번 주(오늘 포함)
    const slotRows = page.getByTestId('resv-slot-row');
    await expect(slotRows.first()).toBeVisible({ timeout: 15_000 });

    const finalScrollTop = await settleScroll(page); // 진입 1회 smooth 스크롤 안정 대기
    const meta = await gridMeta(page);
    expect(meta.rowCount).toBeGreaterThan(0);

    const container = page.getByTestId('resv-timetable-scroll');
    const maxScroll = await container.evaluate(
      (el) => (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
    );

    if (meta.nowMin >= meta.firstMin && meta.nowMin <= meta.lastMin) {
      // 영업시간 내 — 현재 슬롯 행이 뷰포트 가시 범위와 겹쳐야 함 (center 스크롤)
      const currentRow = container.locator(
        `[data-testid="resv-slot-row"][data-slot-time="${meta.currentSlotTime}"]`,
      );
      await expect(currentRow).toHaveCount(1);
      const containerBox = await container.boundingBox();
      const rowBox = await currentRow.boundingBox();
      expect(containerBox).not.toBeNull();
      expect(rowBox).not.toBeNull();
      if (containerBox && rowBox) {
        const overlapTop = Math.max(rowBox.y, containerBox.y);
        const overlapBottom = Math.min(rowBox.y + rowBox.height, containerBox.y + containerBox.height);
        expect(overlapBottom - overlapTop).toBeGreaterThan(0);
      }
    } else if (meta.nowMin > meta.lastMin) {
      // 영업시간 후 — 마지막 행으로 클램핑(block:end) → 뷰포트가 하단부로 크게 이동(엔게이지).
      // (데이터 카드 높이 변화로 정밀 정렬은 변동 → 충분히 아래로 스크롤됐는지로 검증)
      expect(maxScroll).toBeGreaterThan(0);
      expect(finalScrollTop).toBeGreaterThan(maxScroll * 0.5);
    } else {
      // 영업시간 전 — 첫 행으로 클램핑(block:start) → 최상단 유지
      expect(finalScrollTop).toBeLessThanOrEqual(10);
    }
  });

  // ── 시나리오 2: 현재 시각 행 ref 부착 + 라이브 틱 무손상 (AC-2/AC-3) ────────
  test('AC-2/AC-3: 현재 슬롯 행이 단 하나 ref 타깃으로 식별되고 그리드 무손상', async ({ page }) => {
    await page.goto('/admin/reservations');
    const slotRows = page.getByTestId('resv-slot-row');
    await expect(slotRows.first()).toBeVisible({ timeout: 15_000 });
    const rowCount = await slotRows.count();
    expect(rowCount).toBeGreaterThan(0); // 그리드 무손상

    const meta = await gridMeta(page);
    if (meta.currentSlotTime) {
      // now 이하 최대 슬롯 행은 정확히 1개 (대시보드와 동일하게 단일 타깃) + HH:mm 포맷
      const currentRow = page.locator(
        `[data-testid="resv-slot-row"][data-slot-time="${meta.currentSlotTime}"]`,
      );
      expect(await currentRow.count()).toBe(1);
      expect(meta.currentSlotTime).toMatch(/^\d{2}:\d{2}$/);
    }
    // 30초 틱은 단일 setInterval — 에러/그리드 손상 없음만 보장
    await page.waitForTimeout(500);
    await expect(slotRows.first()).toBeVisible();
  });

  // ── 시나리오 3: 오늘 아닌 주 — 자동 스크롤 미적용 (AC-5) ────────────────────
  test('AC-5: 과거 주(오늘 미포함) 진입 시 자동 스크롤 미적용(scrollTop≈0)', async ({ page }) => {
    // 과거 날짜로 진입 → weekStart 가 과거 주로 설정되어 오늘 미포함
    const past = new Date();
    past.setDate(past.getDate() - 28);
    const y = past.getFullYear();
    const m = String(past.getMonth() + 1).padStart(2, '0');
    const d = String(past.getDate()).padStart(2, '0');
    await page.goto(`/admin/reservations?date=${y}-${m}-${d}`);

    const slotRows = page.getByTestId('resv-slot-row');
    await expect(slotRows.first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);

    // isTodayInView=false → 자동 스크롤 미적용 → 스크롤 컨테이너 최상단 유지
    const scrollTop = await page.getByTestId('resv-timetable-scroll').evaluate(
      (el) => (el as HTMLElement).scrollTop,
    );
    expect(scrollTop).toBeLessThanOrEqual(5);
  });

  // ── 시나리오 4: 수동 스크롤 보존 (AC-4) ──────────────────────────────────
  test('AC-4: 진입 자동 스크롤 후 사용자 수동 스크롤이 즉시 되돌려지지 않음', async ({ page }) => {
    await page.goto('/admin/reservations');
    const slotRows = page.getByTestId('resv-slot-row');
    await expect(slotRows.first()).toBeVisible({ timeout: 15_000 });

    const container = page.getByTestId('resv-timetable-scroll');

    // 진입 1회 smooth 스크롤이 완전히 안정될 때까지 대기 (연속 2회 동일하면 settle)
    let prev = -1;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      const cur = await container.evaluate((el) => (el as HTMLElement).scrollTop);
      if (cur === prev) break;
      prev = cur;
    }

    // 사용자가 의도적으로 다른 위치(현재 위치 + 240px 또는 최하단)로 수동 스크롤
    const target = await container.evaluate((el) => {
      const e = el as HTMLElement;
      const t = Math.min(e.scrollTop + 240, e.scrollHeight - e.clientHeight);
      e.scrollTop = t;
      return t;
    });
    await page.waitForTimeout(900); // 자동 스크롤이 끼어든다면 이 사이에 위치가 원위치로 바뀔 것

    const after = await container.evaluate((el) => (el as HTMLElement).scrollTop);
    // 진입 1회 정책 — 수동 스크롤 직후 자동으로 되돌아가지 않아야 함 (위치 유지, smooth 오차 허용)
    expect(Math.abs(after - target)).toBeLessThanOrEqual(8);
  });
});
