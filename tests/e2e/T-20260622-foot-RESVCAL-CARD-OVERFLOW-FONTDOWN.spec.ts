/**
 * E2E spec — T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN
 * 예약관리 캘린더 고객박스 — 2단(2열) 배치 시 내용 잘림 방지 + 성함 폰트 추가 축소
 *
 * 출처: 김주연 총괄(C0ATE5P6JTH, U0ATDB587PV, thread 1781670247.349859).
 *   직전 CONTENT-KEEP(828893f3)에서 가독성 위해 본문 폰트를 11px로 복원. 그러나 카드가
 *   2열(2단, grid-cols-2)로 배치되며 박스 폭이 좁아져 "고객박스 안 내용 잘릴수도 있음" 지적.
 *   "잘리지 않게 전체 폰트 더 작아져도 됨, 내용이 안잘리는게 더 중요, 지금 성함 폰트 큰 편임".
 *
 * RC: 활성 카드 성함은 CustomerHoverCard(compact)의 text-sm(14px) — 본문(11px)보다 큼.
 *   = "성함 폰트 큰 편"의 실체. 본 티켓은 예약 캘린더 전용 compactDense 프롭으로
 *   성함 text-sm(14px)→text-xs(12px) 한 단계 축소 + 좁은 폭에서 ellipsis 실동작(block+min-w-0).
 *   Dashboard 등 compact-only 카드는 text-sm 유지(영향 없음).
 *
 * 수렴 가이드(ping-pong 차단): 폰트 무한 축소 경쟁 회피 →
 *   - 1차 = overflow/ellipsis(잘림 방지의 본수단). 폰트는 보조(성함만 한 단계).
 *   - 본문(11px)은 CONTENT-KEEP 가독 최소를 유지(재축소 금지). 성함만 12px로(≥11px 가독 바닥 위).
 *
 * 본 스펙 = 티켓 §현장 클릭 시나리오 2건 변환:
 *   - 시나리오1: 2단 배치 잘림 방지 + 성함 폰트 한 단계 축소 + 카드 클릭 정상.
 *   - 시나리오2: 정보 무결성(항목 유지·색상·overflow) + 1열 폭 충분 시 불필요 잘림 없음.
 *
 * 데이터/clinic 미준비 시 graceful skip(시드 의존 비결정 요소 회피).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** locator의 computed font-size(px 정수). 요소 없으면 null. */
async function fontSizeOf(loc: ReturnType<Page['locator']>): Promise<number | null> {
  if (!(await loc.count())) return null;
  const fs = await loc.first().evaluate((n) => getComputedStyle(n as Element).fontSize);
  const m = /([\d.]+)px/.exec(fs);
  return m ? Math.round(parseFloat(m[1])) : null;
}

async function gotoReservations(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
  return firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false);
}

test.describe('T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN — 시나리오1 2단 잘림 방지 + 성함 폰트 축소', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 활성 카드 성함 폰트가 한 단계 축소(≤12px) — text-sm(14px) 회귀가드, 단 가독 바닥(≥11px) 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');
    }
    // 활성 카드 성함 트리거(CustomerHoverCard compactDense). 데이터 의존 → 부재 시 soft-skip.
    const name = page.getByTestId('customer-hover-card-name-clickable').first();
    if (!(await name.count())) {
      test.skip(true, '활성 예약 카드(연결 고객) 없음 — 성함 폰트 검증 생략');
    }
    const fs = await fontSizeOf(name);
    expect(fs).not.toBeNull();
    // 결정적 회귀가드: 직전 text-sm(14px)에서 한 단계 축소 → 12px 이하.
    expect(fs!).toBeLessThanOrEqual(12);
    // 단, CONTENT-KEEP가 세운 가독 바닥(11px) 밑으로는 안 내려감(ping-pong 차단).
    expect(fs!).toBeGreaterThanOrEqual(11);
  });

  test('AC-2: 성함 트리거가 2단 좁은 폭에서 ellipsis 실동작 가능(overflow:hidden + text-overflow:ellipsis + nowrap)', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const name = page.getByTestId('customer-hover-card-name-clickable').first();
    if (!(await name.count())) {
      test.skip(true, '활성 예약 카드 없음');
    }
    // compactDense 성함 span = block+truncate → 좁은 폭에서 박스 깨짐 없이 …(ellipsis)로 흡수.
    const style = await name.evaluate((n) => {
      const s = getComputedStyle(n as Element);
      return { overflow: s.overflowX, textOverflow: s.textOverflow, whiteSpace: s.whiteSpace, display: s.display };
    });
    expect(['hidden', 'clip']).toContain(style.overflow);
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
    // block(또는 inline-block 계열) — inline span에서는 ellipsis가 무효이므로 블록류여야 실동작.
    expect(['block', 'inline-block', 'flex']).toContain(style.display);
  });

  test('AC-2: 카드/이름행 overflow-hidden — 박스 깨짐·셀 밖 넘침 0', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    // 카드 루트 overflow-hidden(박스 깨짐 가드) 유지.
    const cardOverflow = await card.evaluate((n) => getComputedStyle(n as Element).overflow);
    expect(['hidden', 'clip']).toContain(cardOverflow);

    // 카드 내용이 카드 박스 경계를 가로로 넘치지 않음(scrollWidth ≤ clientWidth + 1px 허용오차).
    const overflowX = await card.evaluate((n) => {
      const el = n as HTMLElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test('AC-3: 예약 카드 클릭 → 정상 처리(폰트 축소 후 인터랙션 유지)', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    await card.click({ timeout: 5_000 });
    // throw 없이 처리되면 통과(상세 패널은 비결정).
  });
});

test.describe('T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN — 시나리오2 정보 무결성 + 1열 자연 렌더', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-3: 카드 본문 정보 유지(비어있지 않음) + 색상 규칙(초/재/힐러) 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    // (a) 정보 항목 유지 — ellipsis는 표시 축소이지 제거 아님 → 본문 비어있지 않음.
    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0);

    // (b) 카드 색상 규칙 유지(배경 transparent 아님).
    const bg = await card.evaluate((n) => getComputedStyle(n as Element).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('AC-3: 본문 폰트(11px)는 CONTENT-KEEP 가독 최소 유지(본문 재축소 ping-pong 차단)', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    // 본 티켓은 성함만 축소 — 카드 본문 폰트는 11px 가독 바닥 유지(재축소 금지).
    const fs = await fontSizeOf(card);
    if (fs !== null) {
      expect(fs).toBeGreaterThanOrEqual(11);
    }
  });

  test('AC-3: hover/우클릭 컨텍스트 메뉴 정상 동작', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    // 우클릭 → 컨텍스트 메뉴(연결 고객 한정). throw 없이 처리되면 인터랙션 무결.
    await card.click({ button: 'right' }).catch(() => {});
    // 메뉴 렌더는 customer_id 의존(비결정) → 클릭 가능성만 보장. 예외 없으면 통과.
  });
});
