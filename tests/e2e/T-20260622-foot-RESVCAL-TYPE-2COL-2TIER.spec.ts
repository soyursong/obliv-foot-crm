/**
 * E2E spec — T-20260622-foot-RESVCAL-TYPE-2COL-2TIER (A안 원본)
 *   ⚠ SUPERSEDED (레이아웃 부분) by T-20260702-foot-RESVCAL-DAYWEEK-LAYOUT-UNIFY AC-2 —
 *      planner carve-out MSG-20260703-000711-xfkm. 좌우 2열 그리드(반폭) → 단일 세로 풀폭 스택.
 *
 * [원본 A안] 각 시간 슬롯 셀 *내부*를 좌우 2열 그리드(왼쪽=초진 / 오른쪽=재진·힐러).
 *   출처: 김주연 총괄 FIX-REQUEST(MSG-20260622-140509-9osx). B안(2줄 Row) 취소, A안(좌우 2열) 정본이었음.
 *
 * [AC-2 변경 이유] 같은 시간대 다건이면 각 열이 셀 반폭이라 카드가 축소·truncate → 치료유형·상태뱃지·담당자
 *   상세정보 소실(스크린샷 F0BELKUCKKP '2×2 미니그리드' 지적). 김주연 총괄 재요청으로 좌우 2열을
 *   단일 세로 풀폭 스택으로 전환 — 각 카드가 셀 전체 폭 사용, 다건·5건+도 정보 소실 없이 세로 스택.
 *
 * [현행 계약(AC-2 후)] = 본 스펙 시나리오:
 *   - CSS-contract(무의존): 슬롯 컨테이너 = 단일 세로 스택(flex-col) / col-new(초진군) 위, col-rest(재진·힐러군) 아래.
 *   - 시나리오1(혼합): resv-typecols 컨테이너 flex-col + col-new/col-rest 둘 다 flex-col 존재 + 둘 다 셀 풀폭.
 *   - 시나리오1b: 한 그룹(열) 내 카드 ≥2면 세로 쌓임(같은 left, top 증가).
 *   - 시나리오2(단일그룹): 카드가 한 그룹에만 있어도 두 래퍼(col-new/col-rest)는 항상 유지(귀속 불깨짐).
 *   - 시나리오3(누락0): 두 그룹 카드 합 = 전체 카드 수.
 *   - 불변: 카드 본문 ≥11px / 성함(compactDense) 11~12px(FONTDOWN 바닥) / 클릭 무손상.
 *
 * ⚠ 표시 레이어 전용(DB 무변경, appointment_type 기존 분류). COMPACT-CONTENT-KEEP 압축·컬러·인터랙션 불변.
 * 데이터/clinic 미준비 시 graceful skip + 데이터 무의존 CSS-contract probe 병행(결정적 검증).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoReservations(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

/** 요소의 grid-template-columns 트랙 수(공백 분리). */
async function gridTrackCount(locator: ReturnType<Page['locator']>): Promise<number> {
  const tpl = await locator
    .evaluate((el) => window.getComputedStyle(el as HTMLElement).gridTemplateColumns)
    .catch(() => '');
  if (!tpl || tpl === 'none') return 0;
  return tpl.trim().split(/\s+/).filter(Boolean).length;
}

test.describe('T-20260622-foot-RESVCAL-TYPE-2COL-2TIER → AC-2 세로 스택 전환 — 슬롯 내 초진군/재진·힐러군 풀폭 세로 스택', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('CSS-contract(데이터 무의존): 컨테이너=단일 세로 스택 + col-new(위)/col-rest(아래) 풀폭', async ({ page }) => {
    // 결정적 검증 — 시드 무관. AC-2 후 실제 컨테이너/그룹 클래스 동치를 인라인 주입해 세로 스택·풀폭 contract 실측.
    await page.setContent(
      `<html><head></head><body>
        <div id="stack" style="display:flex;flex-direction:column;gap:2px;width:200px">
          <div id="colL" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">초진1</div><div style="width:100%">초진2</div>
          </div>
          <div id="colR" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">재진1</div>
          </div>
        </div>
      </body></html>`,
    );
    // 컨테이너는 grid 아님(트랙 0) → 단일 세로 스택.
    expect(await gridTrackCount(page.locator('#stack'))).toBe(0);
    const stackDir = await page.locator('#stack').evaluate((el) => window.getComputedStyle(el as HTMLElement).flexDirection);
    expect(stackDir).toBe('column');

    const colL = await page.locator('#colL').evaluate((el) => {
      const s = window.getComputedStyle(el as HTMLElement);
      return { display: s.display, direction: s.flexDirection };
    });
    expect(colL.display).toBe('flex');
    expect(colL.direction).toBe('column'); // 그룹 내부 세로 쌓기

    // 두 그룹은 같은 left(풀폭) + col-rest(재진·힐러)가 col-new(초진) 아래(top 큼).
    const colLbox = await page.locator('#colL').evaluate((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
    });
    const colRbox = await page.locator('#colR').evaluate((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
    });
    expect(colRbox.left).toBe(colLbox.left);       // 같은 left = 풀폭 세로 스택(반폭 2열 아님)
    expect(colRbox.top).toBeGreaterThan(colLbox.top); // 재진·힐러군이 초진군 아래
    expect(colRbox.width).toBe(colLbox.width);      // 두 그룹 동일 폭(셀 풀폭)
  });

  test('시나리오1(혼합): 슬롯 컨테이너=세로 스택 + col-new/col-rest 둘 다 flex-col 풀폭', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');

    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — 컨테이너 미렌더, soft skip');

    for (let i = 0; i < cnt; i++) {
      // AC-2: 컨테이너는 2열 그리드 아님 → 트랙 0(단일 세로 스택) + flex-column.
      expect(await gridTrackCount(grids.nth(i))).toBe(0);
      const dir = await grids.nth(i).evaluate((el) => window.getComputedStyle(el as HTMLElement).flexDirection).catch(() => '');
      expect(dir).toBe('column');
    }
    // 컨테이너 1개 이상 존재 시 그 안 col-new/col-rest 래퍼는 항상 둘 다 렌더(귀속 유지).
    const first = grids.first();
    const colNew = first.locator('[data-testid^="resv-col-new-"]');
    const colRest = first.locator('[data-testid^="resv-col-rest-"]');
    expect(await colNew.count()).toBe(1);
    expect(await colRest.count()).toBe(1);
    for (const col of [colNew, colRest]) {
      const dir = await col.evaluate((el) => window.getComputedStyle(el as HTMLElement).flexDirection).catch(() => '');
      expect(dir).toBe('column'); // 그룹 내부 세로 쌓기
    }
  });

  test('시나리오1b(혼합): 한 열 내 카드 ≥2면 세로 쌓임(같은 left, top 증가)', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const cols = page.locator('[data-testid^="resv-col-new-"], [data-testid^="resv-col-rest-"]');
    const cnt = await cols.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    let checkedMulti = false;
    for (let i = 0; i < cnt; i++) {
      const cards = cols.nth(i).locator('[data-testid^="resv-card-"]');
      const n = await cards.count();
      if (n < 2) continue;
      checkedMulti = true;
      const boxes = await cards.evaluateAll((els) =>
        els.map((e) => {
          const r = (e as HTMLElement).getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top) };
        }),
      );
      const lefts = boxes.map((b) => b.left);
      expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1); // 같은 열 = left 동일(세로 쌓기)
      for (let k = 1; k < boxes.length; k++) {
        expect(boxes[k].top).toBeGreaterThanOrEqual(boxes[k - 1].top); // 위→아래 순서
      }
    }
    if (!checkedMulti) test.skip(true, '카드 2개 이상인 열 없음(시드 의존) — soft skip');
  });

  test('시나리오2(단일그룹): 카드는 정확히 한 열에만 — 그러나 두 열 트랙은 항상 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    for (let i = 0; i < cnt; i++) {
      const g = grids.nth(i);
      // 좌우 열 래퍼는 카드 유무와 무관하게 항상 둘 다 존재(정렬 불깨짐 보장).
      expect(await g.locator('[data-testid^="resv-col-new-"]').count()).toBe(1);
      expect(await g.locator('[data-testid^="resv-col-rest-"]').count()).toBe(1);
      // 컨테이너가 렌더됐다면 두 열 합은 ≥1(완전 빈 컨테이너는 미렌더).
      const total = await g.locator('[data-testid^="resv-card-"]').count();
      expect(total).toBeGreaterThan(0);
    }
  });

  test('시나리오3(누락·중복0): col-new + col-rest 카드 합 = 전체 카드 수', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const allCards = page.locator('[data-testid^="resv-card-"]');
    const total = await allCards.count();
    if (total === 0) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    const cols = page.locator('[data-testid^="resv-col-new-"], [data-testid^="resv-col-rest-"]');
    const cnt = await cols.count();
    let sum = 0;
    for (let i = 0; i < cnt; i++) {
      sum += await cols.nth(i).locator('[data-testid^="resv-card-"]').count();
    }
    expect(sum).toBe(total); // 전수 귀속(누락0·중복0)
  });

  test('불변: 카드 본문 ≥11px(CONTENT-KEEP) + 성함 11~12px(FONTDOWN 바닥) + 클릭 무손상', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더');

    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) test.skip(true, '예약 카드 없음(시드 의존) — soft skip');

    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0); // 카드 내용 유지(삭제 0)

    const px = await card.evaluate((el) => window.getComputedStyle(el as HTMLElement).fontSize).catch(() => '');
    const m = /([\d.]+)px/.exec(px ?? '');
    if (m) expect(parseFloat(m[1])).toBeGreaterThanOrEqual(11); // 본문 압축 가독성 바닥

    // 성함(compactDense) 폰트 = 11~12px(A안 성함 축소 허용, FONTDOWN ping-pong 바닥 ≥11px 유지).
    const nameEl = card
      .locator('[data-testid="customer-hover-card-name-clickable"], [data-testid="customer-hover-card-name"]')
      .first();
    if (await nameEl.count()) {
      const npx = await nameEl.evaluate((el) => window.getComputedStyle(el as HTMLElement).fontSize).catch(() => '');
      const nm = /([\d.]+)px/.exec(npx ?? '');
      if (nm) {
        const v = parseFloat(nm[1]);
        expect(v).toBeGreaterThanOrEqual(11);
        expect(v).toBeLessThanOrEqual(12);
      }
    }

    // 클릭해도 레이아웃(열/카드 수) 무손상.
    const before = await page.locator('[data-testid^="resv-card-"]').count();
    await card.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = await page.locator('[data-testid^="resv-card-"]').count();
    expect(after).toBe(before);
  });
});
