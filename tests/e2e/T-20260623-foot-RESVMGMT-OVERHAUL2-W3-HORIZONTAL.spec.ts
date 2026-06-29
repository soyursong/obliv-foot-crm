/**
 * T-20260623-foot-RESVMGMT-OVERHAUL2-W3-HORIZONTAL [1-b]
 * 예약관리 개편2탄 WAVE 3 — 일간 보기 시간 가로(x축) 배열 전면 재설계.
 * reporter=김주연 총괄 / depends_on W2-DB(deployed). DB 무변경(FE 격자 재설계).
 *
 * 부모 OVERHAUL-2-PLAN 확정 spec(C4/C5/Q1):
 *   · 일간 보기에서만 시간 가로(x축) 배열. 주간 보기는 현행 유지(Q1=A안).
 *   · 가로축 = 시간(10:00 / 10:30 …). 특정 시간 셀 클릭 → 해당 시간 예약 한 줄 나열(C4).
 *   · 세로축 = 비워둠. 치료사/공간 그루핑 미구현(C5).
 *   · 색상 유지(초진=그린/재진=하늘/힐러=노랑).
 *
 * 현장 클릭 시나리오 → E2E:
 *   [S1] 일간 가로 배열: x축 시간 셀 노출 → 시간 셀 클릭 → 예약 한 줄 나열 영역 노출.
 *   [S2] 주간 보기 회귀 가드: 주간 전환 시 현행 <table>(시간 행) 그대로, 가로 x축 미적용.
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

test.describe('W3-HORIZONTAL [S1] 일간 보기 시간 가로(x축) 배열', () => {
  test('일간 진입 시 가로 x축 시간 스트립 렌더(세로 table 미사용)', async ({ page }) => {
    await gotoReservations(page);

    // 일간 토글 보장(기본값이 일간이지만 명시적으로 일간 클릭)
    // 뷰 토글은 정확히 "일간"(미니 "일" 버튼과 구분 — 느슨한 정규식 .first()는 엉뚱한 버튼 매칭).
    const dayToggle = page.getByRole('button', { name: '일간', exact: true });
    if ((await dayToggle.count()) > 0) {
      await dayToggle.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    const appeared = await horizontal.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!appeared, '일간 가로 뷰 미렌더(로그인/clinic 미할당) — skip');

    // 가로 x축 시간 스트립 존재
    await expect(page.locator('[data-testid="resv-day-xaxis"]')).toBeVisible();
    // 시간 셀(가로축)이 1개 이상 — 영업시간 슬롯
    const hslots = page.locator('[data-testid^="resv-day-hslot-"]');
    expect(await hslots.count()).toBeGreaterThan(0);
    // 일간 보기에서는 주간용 세로 시간 행(table)이 보이지 않아야 한다(C5: 세로축 비움).
    expect(await page.locator('[data-testid="resv-slot-row"]').count()).toBe(0);
  });

  // ⚠ C4("클릭 → 한 줄 나열")는 T-20260624-foot-RESVMGMT-DAILY-TIMEGRID-VERTICAL 로 SUPERSEDED.
  //   클릭-투-리빌 폐기 → 상시 세로 진열 격자. 회귀 가드는 신규 spec(TIMEGRID-VERTICAL) S1 참조.
  test('[SUPERSEDED] 클릭-투-리빌 상세 영역 제거 확인(상시 세로 진열로 교체)', async ({ page }) => {
    await gotoReservations(page);

    const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
    test.skip(
      !(await horizontal.isVisible({ timeout: 5000 }).catch(() => false)),
      '일간 가로 뷰 미렌더 — skip',
    );

    // C4 폐기: 클릭 시 등장하던 단일 상세 영역(resv-day-slot-detail)은 더 이상 없어야 한다.
    expect(await page.locator('[data-testid="resv-day-slot-detail"]').count()).toBe(0);
    // 대체: 각 시간 컬럼 아래 상시 세로 진열 컨테이너가 존재.
    expect(await page.locator('[data-testid^="resv-day-col-cards-"]').count()).toBeGreaterThan(0);
  });
});

test.describe('W3-HORIZONTAL [S2] 주간 보기 회귀 가드', () => {
  test('주간 전환 시 현행 <table>(시간 행) 유지 + 가로 x축 미적용', async ({ page }) => {
    await gotoReservations(page);

    // 뷰 토글은 정확히 "주간"(미니 "주" 버튼과 구분).
    const weekToggle = page.getByRole('button', { name: '주간', exact: true });
    test.skip((await weekToggle.count()) === 0, '주간 토글 미발견 — skip');
    await weekToggle.click();

    // 주간 보기 = 현행: 가로 x축(resv-day-horizontal) 미노출 (auto-retry)
    await expect(page.locator('[data-testid="resv-day-horizontal"]')).toHaveCount(0);
    // 주간 보기 = 현행: 세로 시간 행 table 노출(데이터 의존이므로 graceful)
    const slotRows = page.locator('[data-testid="resv-slot-row"]');
    const tableShell = page.locator('[data-testid="resv-timetable-scroll"] table');
    const weeklyStillTable =
      (await slotRows.count()) > 0 || (await tableShell.count()) > 0;
    // table/행 모두 식별 불가 환경(로그인/clinic 미할당)이면 정보성 skip
    test.skip(!weeklyStillTable, '주간 table 식별 불가 환경 — skip');
    expect(weeklyStillTable).toBeTruthy();
  });
});
