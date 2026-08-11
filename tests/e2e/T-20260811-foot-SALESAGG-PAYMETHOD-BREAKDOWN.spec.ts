/**
 * T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN — 결제수단별 매출 분해 E2E spec
 *
 * 검증 대상:
 *   시나리오 1: 매출집계 → '결제수단별' 탭 렌더 (헤더·표 컨테이너)
 *   시나리오 2 (D2 hinge / tie-out): 결제수단별 '합계 순매출' === 담당실장별 '총 매출'
 *              (동일 SSOT fetchAttributedPayments 를 method vs staffId 로만 재버킷팅 → 구조적 정합)
 *   시나리오 3: 데이터 없는 기간 → 빈 상태
 *   엣지: 미분류/기타 버킷은 method 미기록 결제가 있을 때만 노출(누락 0) — 표 렌더 자체로 확인
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

/** "1,234,000원" / "−1,234원" → 정수(부호 유지). 파싱 실패 시 NaN. */
function parseWon(text: string | null): number {
  if (!text) return NaN;
  const neg = /[-−]/.test(text);
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return NaN;
  const v = Number(digits);
  return neg ? -v : v;
}

async function openPayMethodTab(page: Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /결제수단별/ }).click();
  await page.waitForLoadState('networkidle');
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 결제수단별 탭 렌더
// ─────────────────────────────────────────────────────────────────────────────
test.describe('결제수단별 탭 기본 렌더', () => {
  test('탭 클릭 → active + 표 또는 빈 상태 렌더', async ({ page }) => {
    await openPayMethodTab(page);

    await expect(page.getByRole('tab', { name: /결제수단별/ })).toHaveAttribute(
      'data-state',
      'active',
    );

    // 표(sales-paymethod-tab) 또는 빈 상태(sales-paymethod-empty) 중 하나는 반드시 렌더.
    const table = page.getByTestId('sales-paymethod-tab');
    const empty = page.getByTestId('sales-paymethod-empty');
    await expect(table.or(empty)).toBeVisible();
  });

  test('데이터 있을 때 표 헤더(결제수단·순매출·합계) 표시', async ({ page }) => {
    await openPayMethodTab(page);

    const table = page.getByTestId('sales-paymethod-tab');
    if (await table.isVisible().catch(() => false)) {
      await expect(table).toContainText('결제수단');
      await expect(table).toContainText('순매출');
      await expect(page.getByTestId('sales-paymethod-total-net')).toBeVisible();
    } else {
      // 데이터 없음 → 빈 상태 허용(테스트 환경 데이터 의존, 오류 아님)
      await expect(page.getByTestId('sales-paymethod-empty')).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (D2 hinge): 결제수단별 합계 순매출 === 담당실장별 총 매출
//   동일 모집단(fetchAttributedPayments)을 축만 바꿔 집계 → 합계는 반드시 일치.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D2 tie-out: 결제수단별 합계 == 담당실장별 총매출', () => {
  test('두 탭의 합계 금액 문자열 일치(동일 기간)', async ({ page }) => {
    // 1) 결제수단별 합계 순매출
    await openPayMethodTab(page);
    const payMethodTable = page.getByTestId('sales-paymethod-tab');
    const hasPayData = await payMethodTable.isVisible().catch(() => false);

    if (!hasPayData) {
      // 데이터 없음 → 담당실장별도 empty 여야 정합. 양쪽 empty 확인으로 종료.
      await expect(page.getByTestId('sales-paymethod-empty')).toBeVisible();
      await page.getByRole('tab', { name: /담당실장별/ }).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('sales-doctor-empty')).toBeVisible();
      return;
    }

    const payMethodTotal = parseWon(
      await page.getByTestId('sales-paymethod-total-net').textContent(),
    );
    expect(Number.isNaN(payMethodTotal)).toBeFalsy();

    // 2) 담당실장별 총 매출 합계 (동일 필터 상태 유지 — 같은 페이지에서 탭만 전환)
    await page.getByRole('tab', { name: /담당실장별/ }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sales-doctor-total-total')).toBeVisible();
    const doctorTotal = parseWon(
      await page.getByTestId('sales-doctor-total-total').textContent(),
    );
    expect(Number.isNaN(doctorTotal)).toBeFalsy();

    // 3) 구조적 tie-out — 동일 rows·동일 net 규칙이라 정확히 일치해야 함.
    expect(payMethodTotal).toBe(doctorTotal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 데이터 없는 기간 → 빈 상태
// ─────────────────────────────────────────────────────────────────────────────
test.describe('빈 상태', () => {
  test('미래 날짜 범위 → 빈 상태 표시', async ({ page }) => {
    await openPayMethodTab(page);

    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill('2099-01-01');
    await page.getByTestId('sales-date-to').fill('2099-01-01');
    await page.waitForTimeout(800);

    await expect(page.getByTestId('sales-paymethod-empty')).toBeVisible();
    await expect(page.getByTestId('sales-paymethod-tab')).toHaveCount(0);
  });
});
