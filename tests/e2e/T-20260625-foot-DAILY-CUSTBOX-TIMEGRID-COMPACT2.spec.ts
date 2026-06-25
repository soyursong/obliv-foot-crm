/**
 * T-20260625-foot-DAILY-CUSTBOX-TIMEGRID-COMPACT2
 * 예약관리 일간 시간격자 — 2차 컴팩트(김주연 총괄 field-soak 2차 피드백 확정).
 * 부모 TIMEGRID-COMPACT-DENSITY(b3efe75c) field-soak 정제. DB 무변경(FE only, 순수 시각 밀도).
 *
 * 확정 spec(MSG-20260625-101647-ao5s):
 *   · 시간 컬럼(칸) 너비 추가 축소: 132px → 90px(한 화면 더 많은 시간 칸). 컬럼 간 gap 1.5→1.
 *   · 고객(예약) 박스·글자 전체 축소: 카드 px-2 py-1 text-[12px] → px-1 py-0.5 text-[8px](현장 확정 8px), 메타/담당자 라인 text-[10px]→text-[7px].
 *   · 헤더 컴팩트: min-h 40→32, 시간라벨 text-xs→text-[10px], 뱃지 text-[9px]→text-[8px].
 *   · 회귀 가드: 격자 구조/세로 진열/색상코드/세로축 무그루핑(C5)/주간 보기 전부 불변.
 *
 * 현장 클릭 시나리오 → E2E:
 *   [S1] 2차 컴팩트 격자 렌더: 컬럼 너비 w-[90px] + 카드 토큰 축소(px-1 py-0.5 text-[8px]) + 색상 유지.
 *   [S2] 회귀 가드: 주간 보기 미영향 + 다건 세로 누적 카드 텍스트 잘림·깨짐 없음(overflow-hidden/truncate).
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

test.describe('COMPACT2 [S1] 2차 컴팩트 격자 렌더', () => {
  test('일간 시간 컬럼이 90px 너비(w-[90px])로 추가 축소 + 가로 헤더/세로 진열 유지', async ({ page }) => {
    await gotoReservations(page);
    await enterDayView(page);

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    const appeared = await horizontal.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일간 가로 격자 미렌더(로그인/clinic 미할당) — skip');

    const cols = page.locator('[data-testid^="resv-day-col-"]:not([data-testid*="cards"])');
    expect(await cols.count()).toBeGreaterThan(0);

    // 2차 컴팩트 핵심: 컬럼 래퍼 너비 토큰 132px → 90px 축소.
    const cls = (await cols.first().getAttribute('class')) ?? '';
    expect(cls).toContain('w-[90px]');
    expect(cls).toContain('min-w-[90px]');
    // 이전 너비(132px/200px) 잔존 금지
    expect(cls).not.toContain('w-[132px]');
    expect(cls).not.toContain('w-[200px]');

    // 실제 렌더 폭도 더 좁아졌는지(여유 포함 ~110px 이하) 측정.
    const box = await cols.first().boundingBox();
    if (box) expect(box.width).toBeLessThanOrEqual(110);

    // 가로 시간 헤더 + 세로 진열 컨테이너 상시 유지(구조 회귀가드)
    expect(await page.locator('[data-testid^="resv-day-hslot-"]').count()).toBeGreaterThan(0);
    const cardCols = page.locator('[data-testid^="resv-day-col-cards-"]');
    expect(await cardCols.count()).toBeGreaterThan(0);
    const cardColCls = (await cardCols.first().getAttribute('class')) ?? '';
    expect(cardColCls).toContain('flex-col'); // 세로 누적 유지
  });

  test('고객 카드 박스·글자 전체 축소(px-1 py-0.5 text-[8px] w-full) + KIND 색상 유지', async ({ page }) => {
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

    // 카드 박스·글자 축소: 컬럼 추종(w-full) + 축소 패딩/폰트 토큰.
    const cls = (await cards.first().getAttribute('class')) ?? '';
    expect(cls).toContain('w-full');
    expect(cls).toContain('px-1');
    expect(cls).toContain('py-0.5');
    expect(cls).toContain('text-[8px]');
    // 이전 더 큰 토큰 잔존 금지(12px/9px 미세 언더슛 포함)
    expect(cls).not.toContain('text-[12px]');
    expect(cls).not.toContain('text-[9px]');
    // 색상 코드(초진 그린/재진 하늘/힐러 노랑) 유지
    let colored = 0;
    for (let i = 0; i < Math.min(cardCount, 10); i++) {
      const c = (await cards.nth(i).getAttribute('class')) ?? '';
      if (/firstvisit-|blue-|yellow-|amber-/.test(c)) colored += 1;
    }
    expect(colored).toBeGreaterThan(0);
  });
});

test.describe('COMPACT2 [S2] 회귀 가드', () => {
  test('주간 보기 미영향(현행 <table> 유지, 격자 미적용)', async ({ page }) => {
    await gotoReservations(page);

    const weekToggle = page.getByRole('button', { name: '주간', exact: true });
    test.skip((await weekToggle.count()) === 0, '주간 토글 미발견 — skip');
    await weekToggle.click();

    await expect(page.locator('[data-testid="resv-day-horizontal"]')).toHaveCount(0);
    expect(await page.locator('[data-testid^="resv-day-col-cards-"]').count()).toBe(0);
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

    // 90px 컬럼에서도 카드가 overflow-hidden(컬럼 밖 넘침 차단) — 깨짐 방지 회귀가드.
    const cls = (await cards.first().getAttribute('class')) ?? '';
    expect(cls).toContain('overflow-hidden');

    // 카드 내부 고객명/메타가 truncate 토큰을 보유해 줄바꿈 폭주 없음.
    const truncated = cards.first().locator('.truncate, [class*="truncate"]');
    expect(await truncated.count()).toBeGreaterThan(0);
  });
});
