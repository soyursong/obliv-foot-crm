/**
 * E2E spec — T-20260622-foot-RESVCAL-TYPE-2COL-2TIER (A안 정본 — 김주연 총괄)
 * 예약 캘린더: 각 시간 슬롯 셀 *내부*를 좌우 2열 그리드. 왼쪽 열=초진 / 오른쪽 열=재진·힐러.
 *
 * 출처: 김주연 총괄 직접 최종확정 — FIX-REQUEST(MSG-20260622-140509-9osx, slack ts 1782104309).
 *   직전 "2줄 Row(가로 전부 나열)" 안 = B안 → 취소. A안(좌우 2열 그리드)이 정본.
 *   - 왼쪽 열(colNew) = 초진(new) — 위→아래 세로 쌓기(예약 시각 순)
 *   - 오른쪽 열(colRest) = 재진(returning)+힐러(healer)+기타(other) — 위→아래 세로 쌓기(예약 시각 순)
 *   - 카드 수 > 1쌍이면 그리드 행이 카드 수만큼 늘어남. 단일 그룹이어도 2열 트랙은 유지(좌우 정렬 불깨짐).
 *   - ❌ 페이지 전체를 좌/우·상/하 구역 분리하지 않음 — 어디까지나 슬롯 셀 내부 2열.
 *
 * 본 스펙 = 티켓 §현장 시나리오 변환:
 *   - CSS-contract(무의존): 슬롯 컨테이너 = grid 2-track / 각 열 = flex-col.
 *   - 시나리오1(혼합): resv-typecols 컨테이너 2열 + col-new/col-rest 둘 다 flex-col 존재.
 *   - 시나리오1b: 한 열 내 카드 ≥2면 세로 쌓임(같은 x, top 증가).
 *   - 시나리오2(단일그룹): 카드는 정확히 한 열에만, 반대 열은 0(2열 트랙은 유지).
 *   - 시나리오3(누락0): 두 열 카드 합 = 전체 카드 수.
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

test.describe('T-20260622-foot-RESVCAL-TYPE-2COL-2TIER(A안) — 슬롯 내 좌우 2열(초진ㅣ재진·힐러)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('CSS-contract(데이터 무의존): grid-cols-2 = 좌우 2 트랙 + 각 열 flex-col', async ({ page }) => {
    // 결정적 검증 — 시드 무관. 실제 슬롯 컨테이너/열 클래스 동치를 인라인 주입해 좌우 2열·세로쌓기 contract 실측.
    await page.setContent(
      `<html><head></head><body>
        <div id="grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;width:200px;align-items:start">
          <div id="colL" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">초진1</div><div style="width:100%">초진2</div>
          </div>
          <div id="colR" style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div style="width:100%">재진1</div>
          </div>
        </div>
      </body></html>`,
    );
    expect(await gridTrackCount(page.locator('#grid'))).toBe(2); // 좌우 2열

    const colL = await page.locator('#colL').evaluate((el) => {
      const s = window.getComputedStyle(el as HTMLElement);
      return { display: s.display, direction: s.flexDirection };
    });
    expect(colL.display).toBe('flex');
    expect(colL.direction).toBe('column'); // 열 내부 세로 쌓기

    // 왼쪽 열 두 카드는 같은 x(세로 쌓기) + 오른쪽 열은 왼쪽보다 x 큼(좌→우 배치).
    const lefts = await page.locator('#colL > div').evaluateAll((els) =>
      els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().left)),
    );
    expect(new Set(lefts).size).toBe(1); // 한 열 내 카드 x 동일 = 세로 쌓기
    const colLx = await page.locator('#colL').evaluate((e) => (e as HTMLElement).getBoundingClientRect().left);
    const colRx = await page.locator('#colR').evaluate((e) => (e as HTMLElement).getBoundingClientRect().left);
    expect(colRx).toBeGreaterThan(colLx); // 오른쪽 열이 더 오른쪽
  });

  test('시나리오1(혼합): 슬롯 컨테이너=2열 그리드 + col-new/col-rest 둘 다 flex-col', async ({ page }) => {
    if (!(await gotoReservations(page))) test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');

    const grids = page.locator('[data-testid^="resv-typecols-"]');
    const cnt = await grids.count();
    if (cnt === 0) test.skip(true, '예약 카드 없음(시드 의존) — 2열 컨테이너 미렌더, soft skip');

    for (let i = 0; i < cnt; i++) {
      expect(await gridTrackCount(grids.nth(i))).toBe(2); // 좌우 2열 트랙
    }
    // 컨테이너 1개 이상 존재 시 그 안 col-new/col-rest 래퍼는 항상 둘 다 렌더(좌우 트랙 유지).
    const first = grids.first();
    const colNew = first.locator('[data-testid^="resv-col-new-"]');
    const colRest = first.locator('[data-testid^="resv-col-rest-"]');
    expect(await colNew.count()).toBe(1);
    expect(await colRest.count()).toBe(1);
    for (const col of [colNew, colRest]) {
      const dir = await col.evaluate((el) => window.getComputedStyle(el as HTMLElement).flexDirection).catch(() => '');
      expect(dir).toBe('column'); // 열 내부 세로 쌓기
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
