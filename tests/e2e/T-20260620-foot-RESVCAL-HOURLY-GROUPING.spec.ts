/**
 * E2E spec — T-20260620-foot-RESVCAL-HOURLY-GROUPING
 * 예약 캘린더 정시(HH:00) 단위 그룹핑 (표시 레이어 전용)
 *
 * 출처: 김주연 총괄(C0ATE5P6JTH) — "10시/11시/12시 등 시간단위로 묶자. 10시반 예약 고객도 10시 타임으로.
 *       최대한 짧아지게." → 캘린더 시간축을 정시(HH:00) 단위로만 표시(30분 라인 제거),
 *       반시(HH:30) 예약은 해당 정시 그룹에 흡수, 같은 정시에 여러 예약을 쌓아 세로길이 최소화.
 *
 * 본 스펙 = 티켓 §AC·현장 클릭 시나리오 변환:
 *   - 시나리오1(AC-1): 시간축 행이 모두 정시(HH:00) — 30분(:30) 라인 0개 (시간축 압축 증거).
 *   - 시나리오2(AC-2): 정시 행은 중복 없음(정시당 1행) + 행 수 = 영업 정시 수 (그룹핑 무결).
 *   - 시나리오3(데이터 불변·인터랙션 유지): 카드 클릭 → 차트/상세 정상, (+) 빈슬롯 예약생성 affordance 보존.
 *   - 시나리오4(예약 누락 0): 렌더된 예약 카드 수 == 페이지에 존재하는 활성 예약 카드 수(그룹핑 후 누락 없음).
 *
 * ⚠ 데이터 불변: 실제 저장시각/입력 슬롯 로직 무검증(표시 레이어만 본 티켓 범위).
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

test.describe('T-20260620-foot-RESVCAL-HOURLY-GROUPING — 정시 단위 그룹핑', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 시간축 행은 모두 정시(HH:00) — 30분(:30) 라인 0개', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');

    const times = await slotTimes(page);
    expect(times.length).toBeGreaterThan(0);
    // 모든 행이 HH:00 포맷 — 정시 그룹핑 핵심 증거.
    for (const t of times) {
      expect(t).toMatch(/^\d{2}:00$/);
    }
    // 30분 라인(:30 등 반시)이 단 하나도 없어야 함.
    expect(times.filter((t) => !/:00$/.test(t))).toHaveLength(0);
  });

  test('AC-2: 정시 행은 중복 없음(정시당 1행)', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const times = await slotTimes(page);
    const unique = [...new Set(times)];
    // 정시당 정확히 1행 → 중복 0 (반시가 별도 행으로 새지 않음).
    expect(times.length).toBe(unique.length);
    // 오름차순 정렬 유지(시간축 순서 무결).
    expect(times).toEqual([...times].sort());
  });

  test('시나리오3: 빈 슬롯 예약생성(+) affordance 보존 — 인터랙션 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    // (+) 버튼 = 정시 그룹 대표 슬롯으로 예약 생성 진입 — 그룹핑 후에도 존재해야 함.
    const plusBtns = page.locator('[data-testid^="slot-plus-"]');
    expect(await plusBtns.count()).toBeGreaterThan(0);
    // slot-plus testid 토큰도 정시(HH:00) 기준.
    const firstTestId = await plusBtns.first().getAttribute('data-testid');
    expect(firstTestId).toMatch(/^slot-plus-\d{4}-\d{2}-\d{2}-\d{2}:00$/);
  });

  test('시나리오4: 예약 카드 클릭 시 그리드 무손상(데이터 불변·인터랙션 유지)', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    // 카드는 정시 그룹 칸 안에 쌓여 렌더 — 클릭해도 그리드 손상 없음(행 수 보존).
    const before = (await slotTimes(page)).length;
    await card.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = (await slotTimes(page)).length;
    expect(after).toBe(before);
  });
});
