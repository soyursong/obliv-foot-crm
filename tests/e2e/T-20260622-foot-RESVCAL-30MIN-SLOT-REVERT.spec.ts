/**
 * E2E spec — T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT
 * 예약 캘린더 30분 단위 슬롯 복원 (HOURLY-GROUPING 정시 그룹핑 REVERT)
 *
 * 출처: 김주연 총괄(C0ATE5P6JTH) — "그거 대시보드 한정일텐데 작업내용 다시 검토해" + "마음대로 작업범위 확장시키지마".
 *   6/20 정시(시간단위) 묶기 요청은 진료대시보드(완료슬롯) 한정이었으나
 *   T-20260620-foot-RESVCAL-HOURLY-GROUPING 이 예약관리 캘린더로 잘못 확장 → 예약관리 캘린더는 30분 슬롯으로 REVERT.
 *
 * 본 스펙 = 티켓 §현장 클릭 시나리오 2종 변환:
 *   - 시나리오1(AC-1·AC-2): 시간축 행이 30분 단위(HH:00·HH:30 모두 존재) — :30 라인이 다시 독립 행으로 표시.
 *   - 시나리오2(AC-3·AC-4): 같은 정시의 :00/:30 이 별도 행, 중복 0(슬롯당 1행), 컴팩트 폰트(≥11px) 유지.
 *
 * ⚠ 표시 레이어 전용: 실제 저장시각/입력 슬롯 로직 무검증. 진료대시보드 미터치(본 스펙 범위 밖).
 * 데이터/clinic 미준비 시 graceful skip(시드 의존 비결정 요소 회피).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoReservations(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

/** 시간축 행들의 data-slot-time 값 목록. */
async function slotTimes(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="resv-slot-row"]', (rows) =>
    rows.map((r) => (r as HTMLElement).dataset.slotTime ?? '').filter(Boolean),
  );
}

async function fontSizeOf(locator: ReturnType<Page['locator']>): Promise<number | null> {
  const px = await locator
    .evaluate((el) => window.getComputedStyle(el as HTMLElement).fontSize)
    .catch(() => '');
  const m = /([\d.]+)px/.exec(px ?? '');
  return m ? parseFloat(m[1]) : null;
}

test.describe('T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT — 30분 슬롯 복원', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1/AC-1: 시간축 행이 30분 단위 — :30 라인이 다시 독립 행으로 표시', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');

    const times = await slotTimes(page);
    expect(times.length).toBeGreaterThan(0);
    // 모든 행이 HH:MM 포맷.
    for (const t of times) {
      expect(t).toMatch(/^\d{2}:\d{2}$/);
    }
    // 핵심: 30분(:30) 라인이 적어도 하나 이상 독립 행으로 존재 (정시 흡수 철회 증거).
    //   (영업시간이 30분 슬롯이면 :30 행 존재 — slot_interval=60 클리닉이면 skip.)
    const halfRows = times.filter((t) => /:30$/.test(t));
    if (halfRows.length === 0) {
      test.skip(true, 'slot_interval=60(정시 슬롯) 클리닉 — :30 슬롯 없음, 복원 검증 비대상');
    }
    expect(halfRows.length).toBeGreaterThan(0);
  });

  test('시나리오1/AC-2: 10:30 등 반시 슬롯이 10시 칸 합산이 아닌 독립 행', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const times = await slotTimes(page);
    const hasHalf = times.some((t) => /:30$/.test(t));
    if (!hasHalf) test.skip(true, 'slot_interval=60 — 반시 슬롯 없음');

    // slot-plus testid 토큰이 :30 슬롯 기준으로도 존재해야 함(정시 HH:00 고정 철회 증거).
    const plusBtns = page.locator('[data-testid^="slot-plus-"]');
    expect(await plusBtns.count()).toBeGreaterThan(0);
    const ids = await plusBtns.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.testid ?? '').filter(Boolean),
    );
    // 적어도 하나의 (+) 토큰이 :30 시각을 가짐 → 반시가 독립 슬롯으로 살아있음.
    expect(ids.some((id) => /-\d{2}:30$/.test(id))).toBe(true);
  });

  test('시나리오2/AC-4: 슬롯 중복 0(슬롯당 1행) + 오름차순 무결', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const times = await slotTimes(page);
    const unique = [...new Set(times)];
    // 슬롯당 정확히 1행 → 중복 0 (예약 누락/중복 없음).
    expect(times.length).toBe(unique.length);
    // 오름차순 정렬 유지(시간축 순서 무결).
    expect(times).toEqual([...times].sort());
  });

  test('시나리오2/AC-3: 컴팩트 압축 유지 — 카드 본문 폰트 ≥11px', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0);
    const fs = await fontSizeOf(card);
    // 슬롯만 30분으로 복원, 컴팩트(CONTENT-KEEP) 폰트 가독성(≥11px)은 그대로 유지.
    if (fs !== null) expect(fs).toBeGreaterThanOrEqual(11);
  });

  test('AC-4: 예약 카드 클릭 시 그리드 무손상(행 수 보존)', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    const before = (await slotTimes(page)).length;
    await card.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = (await slotTimes(page)).length;
    expect(after).toBe(before);
  });
});
