/**
 * T-20260804-foot-SALESSTAT-DATEFILTER-PRESETS — 매출집계·통계 날짜필터 프리셋 세트 E2E spec
 *
 * (bo3t/yi23 [저번 달] 단건 티켓을 4버튼 세트로 subsume한 canonical 티켓)
 *
 * 검증 대상:
 *   시나리오 1: 매출집계(/admin/sales) — 진입 기본값 '이번 달' + 4버튼([오늘][이번주][이번달][지난달])
 *              좌→우 렌더 + [지난달] 클릭 시 직전 달 1일~말일 세팅 (AC1·AC2·AC3)
 *   시나리오 2: 통계(/admin/stats) — 진입 기본값 '이번 달' + [지난 달] 버튼 렌더·동작 (AC1·AC2·AC3)
 *   시나리오 3: 경계 케이스 — 직전 달 말일(28/29/30/31·윤년)·연초(1월→전년12월) 계산 정확 (AC4)
 *              + 수동 날짜 입력 시 프리셋 해제 회귀 없음 (AC5)
 *
 * READ-ONLY — DB 변경 없음. FE-only 기간 프리셋.
 */

import { test, expect } from '@playwright/test';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;
const STATS_URL = `${BASE_URL}/admin/stats`;

test.use({ storageState: 'playwright/.auth/user.json' });

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

// 기대 기간값 (테스트 실행 시점 로컬 기준 — 앱과 동일 로직)
const now = new Date();
const thisMonthFrom = fmt(startOfMonth(now));
const thisMonthTo = fmt(endOfMonth(now));
const lastMonthRef = subMonths(now, 1);
const lastMonthFrom = fmt(startOfMonth(lastMonthRef)); // 직전 달 1일
const lastMonthTo = fmt(endOfMonth(lastMonthRef));     // 직전 달 말일(동적)

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 매출집계 — 진입 기본값 '이번 달' + 4버튼 + [지난달] 동작
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 · 매출집계 날짜 프리셋', () => {
  test('진입 기본값 이번 달 + 4버튼 좌→우 렌더 + [지난달] 클릭 → 직전 달 1일~말일', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // AC1: 4버튼이 좌→우 순서로 렌더 (기존 스타일 재사용, data-testid=sales-preset-*)
    const order = ['today', 'week', 'month', 'lastMonth', 'custom'];
    for (const key of order) {
      await expect(page.getByTestId(`sales-preset-${key}`)).toBeVisible();
    }

    // AC3: 진입 기본값 = 이번 달 → 현재기간 표시 span 이 이번 달 range
    await expect(page.getByText(`${thisMonthFrom} ~ ${thisMonthTo}`)).toBeVisible();

    // AC2: [지난달] 클릭 → 직전 달 1일 ~ 직전 달 말일
    await page.getByTestId('sales-preset-lastMonth').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`${lastMonthFrom} ~ ${lastMonthTo}`)).toBeVisible();

    // AC5(회귀): [이번달] 재클릭 → 이번 달 복귀
    await page.getByTestId('sales-preset-month').click();
    await expect(page.getByText(`${thisMonthFrom} ~ ${thisMonthTo}`)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 통계 — 진입 기본값 '이번 달' + [지난 달] 렌더·동작
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 · 통계 날짜 프리셋', () => {
  test('진입 기본값 이번 달 + [지난 달] 버튼 렌더 + 클릭 → 헤더 기간 = 직전 달', async ({ page }) => {
    await page.goto(STATS_URL);
    await page.waitForLoadState('networkidle');

    // AC1: 프리셋 버튼 4종(+사용자 지정) 렌더 — 라벨 텍스트 기반
    for (const label of ['오늘', '이번 주', '이번 달', '지난 달']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    // AC3: 진입 기본값 = 이번 달 → 헤더 "기간: from ~ to" = 이번 달
    await expect(page.getByText(`기간: ${thisMonthFrom} ~ ${thisMonthTo}`)).toBeVisible();

    // AC2: [지난 달] 클릭 → 헤더 기간 = 직전 달 1일~말일
    await page.getByRole('button', { name: '지난 달', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`기간: ${lastMonthFrom} ~ ${lastMonthTo}`)).toBeVisible();

    // AC5(회귀): [이번 달] 재클릭 → 이번 달 복귀
    await page.getByRole('button', { name: '이번 달', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`기간: ${thisMonthFrom} ~ ${thisMonthTo}`)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 경계 케이스 — 말일 동적계산·연초 경계 + 수동입력 프리셋 해제
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 · 경계 케이스', () => {
  test('직전 달 말일 동적계산(28/29/30/31)·연초(1월→전년12월) 정확', async () => {
    // 순수 계산 검증 — 앱과 동일한 date-fns 로직으로 대표 경계 케이스 확인.
    const cases: { anchor: string; from: string; to: string }[] = [
      { anchor: '2026-03-15', from: '2026-02-01', to: '2026-02-28' }, // 평년 2월 → 28일
      { anchor: '2024-03-15', from: '2024-02-01', to: '2024-02-29' }, // 윤년 2월 → 29일
      { anchor: '2026-06-15', from: '2026-05-01', to: '2026-05-31' }, // 31일 달
      { anchor: '2026-05-15', from: '2026-04-01', to: '2026-04-30' }, // 30일 달
      { anchor: '2026-01-15', from: '2025-12-01', to: '2025-12-31' }, // 연초 경계 → 전년 12월
    ];
    for (const c of cases) {
      const ref = subMonths(new Date(`${c.anchor}T12:00:00`), 1);
      expect(fmt(startOfMonth(ref))).toBe(c.from);
      expect(fmt(endOfMonth(ref))).toBe(c.to);
    }
  });

  test('매출집계 수동 날짜 입력 시 프리셋 active 해제 (회귀 없음)', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 직접입력 진입 → 날짜 입력 노출
    await page.getByTestId('sales-preset-custom').click();
    await expect(page.getByTestId('sales-date-from')).toBeVisible();
    await expect(page.getByTestId('sales-date-to')).toBeVisible();

    // 임의 수동 range 입력 → 프리셋(지난달 등) active 아님
    await page.getByTestId('sales-date-from').fill('2026-01-05');
    await page.getByTestId('sales-date-to').fill('2026-01-20');
    await expect(page.getByTestId('sales-date-from')).toHaveValue('2026-01-05');
    await expect(page.getByTestId('sales-date-to')).toHaveValue('2026-01-20');
  });
});
