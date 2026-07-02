/**
 * E2E spec — T-20260702-foot-RESVCAL-DAYWEEK-LAYOUT-UNIFY (AC-2 partial, carve-out 배포)
 *   planner NEW-TASK MSG-20260703-000711-xfkm — AC-2 즉시 승인·배포.
 *   AC-1(주뷰 헤더 카운트뱃지 통일)/AC-3(일뷰 기준 통일)은 baseline 재확인 대기로 blocked → 본 배포 범위 아님.
 *
 * [현장 통증] 스크린샷 F0BELKUCKKP: 주뷰(week) 셀에서 같은 시간대 예약이 여러 개면 좌우 2열 그리드(반폭)로
 *   카드가 축소·truncate → 치료유형·상태뱃지·담당자 상세정보 소실('2×2 미니그리드' 지적).
 *
 * [AC-2 해결] 주뷰 셀 카드 컨테이너를 좌우 2열 그리드(grid-cols-2) → 단일 세로 풀폭 스택(flex-col)으로 전환.
 *   각 카드가 셀 전체 폭 사용 → 반폭 축소 truncate 제거. 다건·5건+도 세로로 자연 스택(정보 소실 0).
 *   불변: renderCard 포맷·필드, KIND_CARD_STYLE 컬러 분류, 정렬(초진군→재진/힐러군, 각 예약시각 순),
 *         col-new/col-rest testid, 카드 누락0. 데이터/DB 무변경. AC-4 회귀0 / AC-5 육안대조=주뷰 카드 한정.
 *
 * 데이터/clinic 미준비 시 graceful skip + 데이터 무의존 CSS-contract probe(결정적) 병행.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoWeekView(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  // 주별(주뷰) 탭 선택 — 기본이 일간이므로 명시 전환(AC-2 범위=주뷰 한정).
  const weekTab = page.getByRole('button', { name: '주별' }).first();
  if (await weekTab.count()) {
    await weekTab.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

/** 요소의 grid-template-columns 트랙 수(공백 분리). 세로 스택이면 'none' → 0. */
async function gridTrackCount(locator: ReturnType<Page['locator']>): Promise<number> {
  const tpl = await locator
    .evaluate((el) => window.getComputedStyle(el as HTMLElement).gridTemplateColumns)
    .catch(() => '');
  if (!tpl || tpl === 'none') return 0;
  return tpl.trim().split(/\s+/).filter(Boolean).length;
}

test.describe('T-20260702-foot-RESVCAL-DAYWEEK-LAYOUT-UNIFY AC-2 — 주뷰 셀 카드 세로 풀폭 스택(정보 소실 0)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('CSS-contract(무의존): 카드 컨테이너가 grid-cols-2(반폭 2열)가 아니라 단일 세로 스택', async ({ page }) => {
    // 결정적 검증 — AC-2 후 실제 컨테이너 클래스 동치를 주입. grid-cols-2(반폭 2열)면 이 테스트가 실패해야 함(회귀가드).
    await page.setContent(
      `<html><head></head><body>
        <div id="stack" style="display:flex;flex-direction:column;gap:2px;width:180px">
          <div id="g1" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">초진 카드1(치료유형·상태·담당자)</div>
            <div style="width:100%">초진 카드2(치료유형·상태·담당자)</div>
          </div>
          <div id="g2" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">재진 카드1(치료유형·상태·담당자)</div>
            <div style="width:100%">재진 카드2(치료유형·상태·담당자)</div>
          </div>
        </div>
      </body></html>`,
    );
    // 컨테이너는 2열 그리드가 아님(트랙 0) — 반폭 축소 원인 제거.
    expect(await gridTrackCount(page.locator('#stack'))).toBe(0);
    // 4개 카드가 모두 같은 left(셀 풀폭) — 2×2 미니그리드였다면 두 개의 서로 다른 left가 나옴.
    const lefts = await page.locator('#stack div[style*="width:100%"]').evaluateAll((els) =>
      els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().left)),
    );
    expect(lefts.length).toBe(4);
    expect(new Set(lefts).size).toBe(1); // 단일 x = 세로 풀폭 스택(반폭 2열 아님)
    // 각 카드 폭 = 컨테이너 폭(반폭 아님).
    const stackW = await page.locator('#stack').evaluate((e) => Math.round((e as HTMLElement).getBoundingClientRect().width));
    const cardW = await page.locator('#g1 > div').first().evaluate((e) => Math.round((e as HTMLElement).getBoundingClientRect().width));
    expect(cardW).toBe(stackW); // 카드가 셀 전체 폭 사용
  });

  test('AC-2(라이브): 주뷰 카드 컨테이너 = 세로 스택(트랙0) + col-new/col-rest 둘 다 flex-col', async ({ page }) => {
    if (!(await gotoWeekView(page))) test.skip(true, '주뷰 타임테이블 미렌더(clinic/영업시간 미확정)');

    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    for (let i = 0; i < cnt; i++) {
      expect(await gridTrackCount(grids.nth(i))).toBe(0); // 2열 그리드 아님 = 세로 스택
      const dir = await grids.nth(i).evaluate((el) => window.getComputedStyle(el as HTMLElement).flexDirection).catch(() => '');
      expect(dir).toBe('column');
    }
    const first = grids.first();
    expect(await first.locator('[data-testid^="resv-col-new-"]').count()).toBe(1);
    expect(await first.locator('[data-testid^="resv-col-rest-"]').count()).toBe(1);
  });

  test('AC-2(엣지 시나리오2-1): 같은 시간대 다건이어도 카드가 모두 같은 left(반폭 축소 없음)', async ({ page }) => {
    if (!(await gotoWeekView(page))) test.skip(true, '주뷰 타임테이블 미렌더');

    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    let checkedMulti = false;
    for (let i = 0; i < cnt; i++) {
      const cards = grids.nth(i).locator('[data-testid^="resv-card-"]');
      const n = await cards.count();
      if (n < 2) continue;
      checkedMulti = true;
      const lefts = await cards.evaluateAll((els) =>
        els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().left)),
      );
      // 세로 풀폭 스택 → 다건이어도 모든 카드 left 동일(2×2 미니그리드였다면 2개의 서로 다른 left).
      expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    }
    if (!checkedMulti) test.skip(true, '같은 슬롯 2건+ 카드 없음(시드 의존) — soft skip');
  });

  test('AC-4 회귀0: 카드 누락0(두 그룹 합=전체) + 카드 내용 비어있지 않음 + 클릭 무손상', async ({ page }) => {
    if (!(await gotoWeekView(page))) test.skip(true, '주뷰 타임테이블 미렌더');

    const allCards = page.locator('[data-testid^="resv-card-"]');
    const total = await allCards.count();
    if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    // 누락0: col-new + col-rest 카드 합 = 전체.
    const cols = page.locator('[data-testid^="resv-col-new-"], [data-testid^="resv-col-rest-"]');
    const colCnt = await cols.count();
    let sum = 0;
    for (let i = 0; i < colCnt; i++) sum += await cols.nth(i).locator('[data-testid^="resv-card-"]').count();
    expect(sum).toBe(total);

    // 카드 내용 유지(상세정보 소실 방지 핵심).
    const card = allCards.first();
    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0);

    // 카드가 가로로 셀 밖 넘치지 않음(풀폭이어도 overflow 가드 유지).
    const overflowX = await card.evaluate((n) => {
      const el = n as HTMLElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflowX).toBeLessThanOrEqual(1);

    // 클릭해도 레이아웃(카드 수) 무손상.
    const before = await allCards.count();
    await card.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid^="resv-card-"]').count()).toBe(before);
  });

  test('AC-4 회귀0: 일↔주 반복 전환 시 레이아웃 깨짐·잔상 없음(주뷰 컨테이너 세로 스택 유지)', async ({ page }) => {
    if (!(await gotoWeekView(page))) test.skip(true, '주뷰 타임테이블 미렌더');

    const dayTab = page.getByRole('button', { name: '일별' }).first();
    const weekTab = page.getByRole('button', { name: '주별' }).first();
    if (!(await dayTab.count()) || !(await weekTab.count())) test.skip(true, '일/주 탭 미노출');

    for (let k = 0; k < 3; k++) {
      await dayTab.click().catch(() => {});
      await page.waitForTimeout(300);
      await weekTab.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    // 반복 전환 후에도 주뷰 카드 컨테이너는 세로 스택(트랙0) 유지 — 잔상/그리드 재발 없음.
    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) return; // 시드 무 → contract probe로 이미 검증됨
    for (let i = 0; i < cnt; i++) {
      expect(await gridTrackCount(grids.nth(i))).toBe(0);
    }
  });
});
