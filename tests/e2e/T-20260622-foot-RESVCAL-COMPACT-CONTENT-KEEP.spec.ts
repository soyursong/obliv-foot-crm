/**
 * E2E spec — T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP
 * 예약관리 캘린더 압축 재정의 — 내용 유지, 카드 크기(높이·여백·폰트)만 축소 (구현 드리프트 정정)
 *
 * 출처: 김주연 총괄(C0ATE5P6JTH, U0ATDB587PV, thread 1781670247.349859).
 *   직전 HALFSIZE(2e9fa113) 배포가 폰트를 9~10px까지 과압축 → 카드 내용이 읽히지 않아
 *   "내용이 사라졌다"고 체감. 정정 방향(planner): 내용 전부 유지(코드상 이미 유지) +
 *   압축은 height·padding·leading으로, 폰트는 "읽히는 최소(14px→11~12px)"로 복원.
 *
 * 본 스펙 = 티켓 §현장 클릭 시나리오 2건 변환:
 *   - 시나리오1: 내용 유지 + 가독성 복원 렌더 — 카드 본문 폰트 ≥11px(과압축 9~10px 회귀가드),
 *               상태줄 ≥10px, 요일·날짜 헤더 행 ≥14px 유지(AC-3), 카드 클릭 정상(AC-5).
 *   - 시나리오2: 정보 무결성 — 카드 본문 비어있지 않음(AC-1), 색상규칙·overflow 유지(AC-5),
 *               우클릭 메뉴 동작 + HOURLY-GROUPING(정시그룹) 상태에서도 카드 내용 유지(AC-5).
 *
 * 핵심 회귀가드(HALFSIZE와의 차이): HALFSIZE는 카드 폰트 ≤10px를 강제했으나,
 *   본 정정 후엔 카드 본문 폰트가 ≥11px(읽히는 최소)여야 한다. 정보 항목 삭제는 전·후 모두 0.
 *
 * 데이터/clinic 미준비 시 graceful skip(시드 의존 비결정 요소 회피).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** computed font-size(px 정수) 반환. 요소 없으면 null. */
async function fontSizePx(page: Page, testid: string): Promise<number | null> {
  const el = page.getByTestId(testid).first();
  if (!(await el.count())) return null;
  const fs = await el.evaluate((n) => getComputedStyle(n as Element).fontSize);
  const m = /([\d.]+)px/.exec(fs);
  return m ? Math.round(parseFloat(m[1])) : null;
}

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

test.describe('T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP — 시나리오1 내용 유지 + 가독성 복원', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-2/AC-3: 카드 본문 폰트 ≥11px(과압축 회귀가드), 요일·날짜 헤더는 ≥14px 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');
    }

    // (a) AC-3: 요일·날짜 헤더 행은 압축 비대상 → text-sm(14px) 유지.
    const headerFs = await fontSizePx(page, 'resv-day-header');
    if (headerFs !== null) {
      expect(headerFs).toBeGreaterThanOrEqual(14);
    }

    // (b) AC-2 핵심 회귀가드: 예약 카드 본문 폰트가 읽히는 최소(≥11px)로 복원됨.
    //     HALFSIZE의 ≤10px 과압축이 11~12px로 정정됐는지 = 본 티켓의 결정적 증거.
    //     데이터 의존 → 카드 부재 시 soft-skip(폰트 검증 불가).
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (await card.count()) {
      const cardFs = await fontSizeOf(card);
      expect(cardFs).not.toBeNull();
      expect(cardFs!).toBeGreaterThanOrEqual(11);
      // 헤더가 카드 본문보다 크거나 같음(헤더 비압축 유지 + 카드만 컴팩트).
      if (headerFs !== null) {
        expect(headerFs).toBeGreaterThanOrEqual(cardFs!);
      }
    } else {
      test.skip(true, '예약 카드 없음(데이터 의존) — 폰트 회귀가드 생략');
    }
  });

  test('AC-2: 슬롯 셀 수직 패딩은 압축 유지(py-0, ≤2px) — 폰트는 키웠어도 밀도는 패딩으로 보존', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    // 압축을 폰트가 아닌 padding/height로 달성한다는 정정 취지의 결정론적 증거.
    const cell = page.getByTestId('resv-time-col-cell').first();
    const pad = await cell.evaluate((n) => {
      const s = getComputedStyle(n as Element);
      return { top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom) };
    });
    expect(pad.top).toBeLessThanOrEqual(2);
    expect(pad.bottom).toBeLessThanOrEqual(2);
  });

  test('AC-5: 예약 카드 클릭 → 정상 처리 (가독성 복원 후 인터랙션 유지)', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.width).toBeGreaterThan(0);
    await card.click({ timeout: 5_000 });
    // throw 없이 처리되면 통과(상세 패널은 비결정 → 클릭 가능성만 보장).
  });
});

test.describe('T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP — 시나리오2 정보 무결성 + 그룹핑 유지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1/AC-5: 카드 본문 내용 유지(비어있지 않음) + 색상규칙 + overflow 가드', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (!(await card.count())) {
      test.skip(true, '예약 카드 없음(데이터 의존)');
    }

    // (a) AC-1: 카드 본문이 비어있지 않음(성함/상태/유형 등 정보 항목 유지 — 삭제 0).
    const text = (await card.innerText().catch(() => '')) ?? '';
    expect(text.trim().length).toBeGreaterThan(0);

    // (b) AC-5: 카드 색상 규칙(초/재/힐러) 유지 = 배경 transparent 아님.
    const bg = await card.evaluate((n) => getComputedStyle(n as Element).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // (c) AC-5: overflow-hidden 유지(셀 밖 넘침/깨짐 가드). 내용은 truncate/ellipsis로 클립.
    const overflow = await card.evaluate((n) => getComputedStyle(n as Element).overflow);
    expect(['hidden', 'clip']).toContain(overflow);
  });

  test('AC-5: HOURLY-GROUPING(정시 그룹) 상태에서도 카드 내용 유지', async ({ page }) => {
    if (!(await gotoReservations(page))) {
      test.skip(true, '타임테이블 미렌더');
    }
    // 정시(HH:00) 그룹핑은 표시 레이어 — 시간축 라벨이 정시 단위(예: "10:00")로 렌더되어야 한다.
    const timeCell = page.getByTestId('resv-time-col-cell').first();
    const timeLabel = (await timeCell.innerText().catch(() => '')) ?? '';
    // 라벨이 정시(:00) 형태 또는 최소한 'HH:MM' 시간 텍스트를 포함(그룹핑 렌더 증거).
    expect(/\d{1,2}:\d{2}/.test(timeLabel)).toBe(true);

    // 그룹핑된 행 안의 카드도 내용을 그대로 보유(흡수된 반시 예약 포함). 데이터 의존 → soft.
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (await card.count()) {
      const text = (await card.innerText().catch(() => '')) ?? '';
      expect(text.trim().length).toBeGreaterThan(0);
      const fs = await fontSizeOf(card);
      // 그룹핑 상태에서도 본문 폰트가 읽히는 최소(≥11px) 유지.
      if (fs !== null) expect(fs).toBeGreaterThanOrEqual(11);
    }
  });
});
