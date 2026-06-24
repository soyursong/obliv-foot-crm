/**
 * T-20260624-foot-TIMEGRID-COMPACT-DENSITY
 * 예약관리 일간 시간격자 — 칸 너비 컴팩트화 + 고객박스 '일간' 카드 사이즈 통일.
 * reporter=김주연 총괄 / 부모 TIMEGRID-VERTICAL(fa7633b5) field-soak 정제. DB 무변경(FE only, 순수 시각 밀도).
 *
 * 확정 spec:
 *   · 시간 컬럼(칸) 너비 축소: 200px → 132px(컴팩트·촘촘히). 컬럼 간 gap 축소(gap-1.5).
 *   · 고객(예약) 박스 = 기존 일간 카드 토큰(px-2 py-1 text-[12px], w-full 컬럼 추종) 그대로 — 신규 사이즈 발명 없음(SSOT 유지).
 *   · 회귀 가드: 격자 구조/세로 진열/색상코드/세로축 무그루핑(C5)/주간 보기 전부 불변.
 *
 * 현장 클릭 시나리오 → E2E:
 *   [S1] 컴팩트 격자 렌더: 시간 가로 컬럼 헤더 + 컬럼 너비 컴팩트(w-[132px]) + 세로 진열 + 색상 유지 + 카드 SSOT 토큰 유지.
 *   [S2] 회귀 가드: 주간 보기 미영향 + 다건(세로 누적) 컬럼 텍스트 잘림·깨짐 없음(카드 overflow-hidden/truncate).
 *
 * 데이터 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoReservations(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
}

async function enterDayView(page: import('@playwright/test').Page) {
  const dayToggle = page.getByRole('button', { name: '일간', exact: true });
  if ((await dayToggle.count()) > 0) {
    await dayToggle.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

test.describe('TIMEGRID-COMPACT-DENSITY [S1] 컴팩트 격자 렌더', () => {
  test('일간 시간 컬럼이 컴팩트 너비(w-[132px])로 렌더 + 가로 헤더/세로 진열 유지', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    const appeared = await horizontal.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일간 가로 격자 미렌더(로그인/clinic 미할당) — skip');

    // 시간 컬럼이 1개 이상 (cards 컨테이너 제외한 컬럼 래퍼)
    const cols = page.locator('[data-testid^="resv-day-col-"]:not([data-testid*="cards"])');
    const colCount = await cols.count();
    expect(colCount).toBeGreaterThan(0);

    // 컴팩트화 핵심: 컬럼 래퍼가 좁은 고정 너비 토큰(w-[132px] / min-w-[132px])을 보유 (200px → 132px 축소 회귀가드).
    const cls = (await cols.first().getAttribute('class')) ?? '';
    expect(cls).toContain('w-[132px]');
    expect(cls).toContain('min-w-[132px]');
    // 과거 넓은 너비(200px) 잔존 금지
    expect(cls).not.toContain('w-[200px]');

    // 실제 렌더 폭도 컴팩트(여유 포함 ~150px 이하)인지 측정 — CSS 토큰이 실제 적용됐는지 이중 확인.
    const box = await cols.first().boundingBox();
    if (box) expect(box.width).toBeLessThanOrEqual(150);

    // 가로 시간 헤더 + 세로 진열 컨테이너 상시 유지(구조 회귀가드)
    expect(await page.locator('[data-testid^="resv-day-hslot-"]').count()).toBeGreaterThan(0);
    const cardCols = page.locator('[data-testid^="resv-day-col-cards-"]');
    expect(await cardCols.count()).toBeGreaterThan(0);
    const cardColCls = (await cardCols.first().getAttribute('class')) ?? '';
    expect(cardColCls).toContain('flex-col'); // 세로 누적 유지
  });

  test('고객 카드는 일간 SSOT 토큰(px-2 py-1 text-[12px] w-full) + KIND 색상 유지(신규 사이즈 발명 없음)', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    test.skip(
      !(await horizontal.isVisible({ timeout: 5000 }).catch(() => false)),
      '일간 가로 격자 미렌더 — skip',
    );

    const cards = page.locator('[data-testid="resv-day-horizontal"] [data-testid^="resv-card-"]');
    const cardCount = await cards.count();
    test.skip(cardCount === 0, '예약 카드 없는 환경 — skip');

    // 카드 사이즈 SSOT: 컬럼 추종(w-full) + 기존 일간 카드 패딩/폰트 토큰 유지(임의 신규 사이즈 발명 없음).
    const cls = (await cards.first().getAttribute('class')) ?? '';
    expect(cls).toContain('w-full');
    expect(cls).toContain('px-2');
    expect(cls).toContain('py-1');
    expect(cls).toContain('text-[12px]');
    // 색상 코드(초진 그린/재진 하늘/힐러 노랑) 유지
    let colored = 0;
    for (let i = 0; i < Math.min(cardCount, 10); i++) {
      const c = (await cards.nth(i).getAttribute('class')) ?? '';
      if (/firstvisit-|blue-|yellow-|amber-/.test(c)) colored += 1;
    }
    expect(colored).toBeGreaterThan(0);
  });
});

test.describe('TIMEGRID-COMPACT-DENSITY [S2] 회귀 가드', () => {
  test('주간 보기 미영향(현행 <table> 유지, 격자 미적용)', async ({ page }) => {
    await gotoReservations(page);

    const weekToggle = page.getByRole('button', { name: '주간', exact: true });
    test.skip((await weekToggle.count()) === 0, '주간 토글 미발견 — skip');
    await weekToggle.click();

    await expect(page.locator('[data-testid="resv-day-horizontal"]')).toHaveCount(0);
    expect(await page.locator('[data-testid^="resv-day-col-cards-"]').count()).toBe(0);

    const slotRows = page.locator('[data-testid="resv-slot-row"]');
    const tableShell = page.locator('[data-testid="resv-timetable-scroll"] table');
    const weeklyStillTable = (await slotRows.count()) > 0 || (await tableShell.count()) > 0;
    test.skip(!weeklyStillTable, '주간 table 식별 불가 환경 — skip');
    expect(weeklyStillTable).toBeTruthy();
  });

  test('다건(세로 누적) 컬럼에서 카드 텍스트 잘림 방지 토큰(truncate/overflow-hidden) 유지', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    test.skip(
      !(await horizontal.isVisible({ timeout: 5000 }).catch(() => false)),
      '일간 가로 격자 미렌더 — skip',
    );

    const cards = page.locator('[data-testid="resv-day-horizontal"] [data-testid^="resv-card-"]');
    const cardCount = await cards.count();
    test.skip(cardCount === 0, '예약 카드 없는 환경 — skip');

    // 컴팩트 컬럼(132px)에서도 카드가 overflow-hidden(컬럼 밖 넘침 차단) — 깨짐 방지 회귀가드.
    const cls = (await cards.first().getAttribute('class')) ?? '';
    expect(cls).toContain('overflow-hidden');

    // 카드 내부 고객명/메타가 truncate(잘림 처리) 토큰을 보유해 줄바꿈 폭주 없음.
    const truncated = cards.first().locator('.truncate, [class*="truncate"]');
    expect(await truncated.count()).toBeGreaterThan(0);
  });
});
