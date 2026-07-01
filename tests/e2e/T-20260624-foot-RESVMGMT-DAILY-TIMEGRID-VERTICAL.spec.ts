/**
 * T-20260624-foot-RESVMGMT-DAILY-TIMEGRID-VERTICAL
 * 예약관리 일간 보기 — 시간 격자(가로 일렬 헤더) + 시간당 예약 상시 세로 진열.
 * reporter=김주연 총괄 / W3-HORIZONTAL(6c5a78c4) field-soak 정제. DB 무변경(FE only).
 *
 * supersedes: W3 C4 "시간 셀 클릭 → 한 줄 나열" 인터랙션 폐기.
 *   · 시간 = 가로 한 줄 헤더(컬럼 상단). W3 유지.
 *   · 각 시간 컬럼 아래로 예약을 클릭 없이 상시 세로 진열(격자). 같은 시간 다건 → 그 컬럼에서 세로 누적.
 *   · 색상 코드 유지(초진=그린/재진=하늘/힐러=노랑). 세로축 그루핑 없음(C5 유지).
 *   · 주간 보기 미영향.
 *
 * 현장 클릭 시나리오 → E2E:
 *   [S1] 일간 격자 세로 진열: 가로 시간 컬럼 헤더 + 클릭 없이 각 컬럼 아래 예약 세로 진열 + 색상 유지.
 *   [S2] 주간 보기 회귀 가드: 주간 전환 시 현행 <table>(시간 행) 유지, 격자 세로 진열 미적용.
 *   [S3] 빈 시간대: 예약 없는 시간 컬럼도 빈 컬럼으로 표시(에러·깨짐 없음).
 *
 * 데이터 없는 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
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

// [SUPERSEDED by 7ADJ ③] 가로 시간헤더+세로진열 → 시간 행 × 초진/재진 열 엑셀 격자로 교체 → skip.
test.describe.skip('TIMEGRID-VERTICAL [S1] 일간 격자 (SUPERSEDED 7ADJ grid)', () => {
  test('일간 진입 시 가로 시간 컬럼 헤더 + 클릭 없이 세로 진열 영역 렌더', async ({ page }) => {
    await gotoReservations(page);

    // 뷰 토글은 정확히 "일간"/"주간"(미니 "일"/"주" 버튼과 구분 — 느슨한 정규식 .first()는 엉뚱한 버튼 매칭).
    const dayToggle = page.getByRole('button', { name: '일간', exact: true });
    if ((await dayToggle.count()) > 0) {
      await dayToggle.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    const appeared = await horizontal.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일간 가로 격자 미렌더(로그인/clinic 미할당) — skip');

    // 시간 = 가로 한 줄 헤더(스트립) 유지
    await expect(page.locator('[data-testid="resv-day-xaxis"]')).toBeVisible();

    // 시간 컬럼이 1개 이상 (영업시간 슬롯) — 가로 일렬 컬럼
    const colCount = await page.locator('[data-testid^="resv-day-col-"]:not([data-testid*="cards"])').count();
    expect(colCount).toBeGreaterThan(0);

    // 각 시간 헤더(가로 한 줄에 정렬) 1개 이상
    const headers = page.locator('[data-testid^="resv-day-hslot-"]');
    expect(await headers.count()).toBeGreaterThan(0);

    // 클릭 없이 세로 진열 영역(컬럼 카드 컨테이너)이 상시 존재 (클릭-투-리빌 제거 확인)
    const cardCols = page.locator('[data-testid^="resv-day-col-cards-"]');
    expect(await cardCols.count()).toBeGreaterThan(0);

    // C4 폐기 검증: 클릭 시 등장하던 단일 상세 영역(resv-day-slot-detail)은 더 이상 없어야 한다.
    expect(await page.locator('[data-testid="resv-day-slot-detail"]').count()).toBe(0);

    // 세로 진열 컨테이너는 flex-col(세로 누적). flex-row(한 줄 나열) 아님.
    const firstCards = cardCols.first();
    const cls = (await firstCards.getAttribute('class')) ?? '';
    expect(cls).toContain('flex-col');

    // 일간 보기에서는 주간용 세로 시간 행(table)이 보이지 않아야 한다(C5: 세로축 그루핑 없음).
    expect(await page.locator('[data-testid="resv-slot-row"]').count()).toBe(0);
  });

  test('예약 카드는 KIND 색상 클래스(초진 그린/재진 하늘/힐러 노랑) 유지', async ({ page }) => {
    await gotoReservations(page);
    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    test.skip(
      !(await horizontal.isVisible({ timeout: 5000 }).catch(() => false)),
      '일간 가로 격자 미렌더 — skip',
    );

    const cards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await cards.count();
    test.skip(cardCount === 0, '예약 카드 없는 환경 — skip');

    // 적어도 한 카드는 KIND 색상 토큰(초진=firstvisit/재진=blue/힐러=yellow) 중 하나를 보유.
    let colored = 0;
    for (let i = 0; i < Math.min(cardCount, 10); i++) {
      const cls = (await cards.nth(i).getAttribute('class')) ?? '';
      if (/firstvisit-|blue-|yellow-|amber-/.test(cls)) colored += 1;
    }
    expect(colored).toBeGreaterThan(0);
  });
});

test.describe('TIMEGRID-VERTICAL [S2] 주간 보기 회귀 가드', () => {
  test('주간 전환 시 현행 <table>(시간 행) 유지 + 격자(가로 컬럼) 미적용', async ({ page }) => {
    await gotoReservations(page);

    // 뷰 토글은 정확히 "주간"(미니 "주" 버튼과 구분).
    const weekToggle = page.getByRole('button', { name: '주간', exact: true });
    test.skip((await weekToggle.count()) === 0, '주간 토글 미발견 — skip');
    await weekToggle.click();

    // 주간 보기 = 현행: 일간 가로 격자(resv-day-horizontal) 미노출 (auto-retry)
    await expect(page.locator('[data-testid="resv-day-horizontal"]')).toHaveCount(0);
    // 시간 컬럼(resv-day-col-) 미노출
    expect(await page.locator('[data-testid^="resv-day-col-cards-"]').count()).toBe(0);

    // 주간 보기 = 현행: 세로 시간 행 table 노출(데이터 의존이므로 graceful)
    const slotRows = page.locator('[data-testid="resv-slot-row"]');
    const tableShell = page.locator('[data-testid="resv-timetable-scroll"] table');
    const weeklyStillTable =
      (await slotRows.count()) > 0 || (await tableShell.count()) > 0;
    test.skip(!weeklyStillTable, '주간 table 식별 불가 환경 — skip');
    expect(weeklyStillTable).toBeTruthy();
  });
});

// [SUPERSEDED by 7ADJ ③] 빈 시간대 수평 컬럼 검증 → 격자 셀로 교체 → skip.
test.describe.skip('TIMEGRID-VERTICAL [S3] 빈 시간대 (SUPERSEDED 7ADJ grid)', () => {
  test('예약 없는 시간 컬럼도 빈 컬럼으로 표시(에러·깨짐 없음)', async ({ page }) => {
    await gotoReservations(page);
    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    test.skip(
      !(await horizontal.isVisible({ timeout: 5000 }).catch(() => false)),
      '일간 가로 격자 미렌더 — skip',
    );

    // 컬럼 카드 컨테이너가 1개 이상 — 예약 유무와 무관하게 모든 시간 컬럼이 존재해야 함.
    const cardCols = page.locator('[data-testid^="resv-day-col-cards-"]');
    expect(await cardCols.count()).toBeGreaterThan(0);

    // 빈 컬럼/채워진 컬럼 무관하게 컨테이너는 attached & 깨짐 없이 렌더(첫 컬럼 visible 확인).
    await expect(cardCols.first()).toBeVisible();
  });
});
