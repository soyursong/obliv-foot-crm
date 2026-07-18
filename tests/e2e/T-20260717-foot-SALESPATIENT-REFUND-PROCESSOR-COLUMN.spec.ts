/**
 * T-20260717-foot-SALESPATIENT-REFUND-PROCESSOR-COLUMN — "처리 직원명" 컬럼 E2E spec
 *
 * 매출관리 > 환자별 탭(SalesPatientTab) 맨 우측 15번째 "처리 직원명" 컬럼.
 *   payments.created_by → user_profiles.name JOIN(processor). 과거행 NULL → '—'.
 *
 * 검증(표시 assert — 금액 아님):
 *   시나리오 1: 환불 행 처리자 표시 (AC-1)
 *   시나리오 2: 일반 결제 행 처리자 표시 (AC-2)
 *   시나리오 3: 과거 데이터 created_by NULL → '—' 정상 렌더, data loss/에러 없음 (AC-3)
 *   AC-5: '처리 직원명' 헤더 존재(15컬럼)
 *   AC-6: tfoot 합계행 정렬 무결(sales-patient-total 유지)
 *
 * READ-ONLY 뷰. 쓰기는 PaymentDialog(created_by)/refund_single_payment RPC(auth.uid()).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

async function openPatientTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  // 이번달 기간 — 환불/결제 건 확보 가능성 높임
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: /환자별/ }).click();
  await page.waitForLoadState('networkidle');
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: '처리 직원명' 헤더 존재 (15컬럼)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5: 처리 직원명 헤더', () => {
  test("맨 우측 15번째 '처리 직원명' 헤더 표시", async ({ page }) => {
    await openPatientTab(page);

    const isEmpty = await page.getByTestId('sales-patient-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 수납 내역 없음 — 헤더 테스트 스킵');
      return;
    }

    const grid = page.getByTestId('sales-patient-grid');
    await expect(grid).toBeVisible();

    // 15개 헤더 전체 (기존 14 + 처리 직원명)
    for (const col of [
      '회계귀속일', '차트번호', '환자명', '진료구분', '상병코드',
      '시술명', '본부금', '공단청구액', '과세공급가', '면세금액',
      '할인', '실수납액', '결제수단', '전표상태', '처리 직원명',
    ]) {
      await expect(grid).toContainText(col);
    }

    // 헤더 셀 개수 = 15
    const headerCount = await grid.locator('thead th').count();
    expect(headerCount).toBe(15);

    // '처리 직원명'이 마지막(맨 우측) 헤더
    const lastHeader = await grid.locator('thead th').last().textContent();
    expect(lastHeader?.trim()).toBe('처리 직원명');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1·2·3: 처리 직원명 셀 렌더 (환불/결제/과거 NULL 모두 정상)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('처리 직원명 셀 렌더 (AC-1/2/3)', () => {
  test('모든 행의 처리직원명 셀이 이름 또는 — 로 정상 렌더 (에러/유실 없음)', async ({ page }) => {
    await openPatientTab(page);

    const isEmpty = await page.getByTestId('sales-patient-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 수납 내역 없음 — 셀 렌더 테스트 스킵');
      return;
    }

    const grid = page.getByTestId('sales-patient-grid');
    await expect(grid).toBeVisible();

    const cells = page.getByTestId('sales-patient-processor');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    // 각 처리직원명 셀: 비어있지 않음(이름 or '—'). NULL이어도 '—'로 착지 → data loss/빈칸 없음(AC-3)
    for (let i = 0; i < count; i++) {
      const txt = (await cells.nth(i).textContent())?.trim() ?? '';
      expect(txt.length).toBeGreaterThan(0);
    }

    // 각 tbody 행의 셀 수 = 15 (처리직원명 td 포함, 정렬 무너짐 없음)
    const firstRowCells = await grid.locator('tbody tr:first-child td').count();
    expect(firstRowCells).toBe(15);
  });

  test('시나리오1: 환불 행(destructive Badge)에도 처리직원명 셀 존재', async ({ page }) => {
    await openPatientTab(page);

    const isEmpty = await page.getByTestId('sales-patient-empty').isVisible().catch(() => false);
    if (isEmpty) {
      test.skip(true, '해당 기간 수납 내역 없음 — 환불 행 테스트 스킵');
      return;
    }

    const grid = page.getByTestId('sales-patient-grid');
    // 환불/결제취소 배지가 있는 행 탐색
    const refundRow = grid.locator('tbody tr', { hasText: /부분환불|결제취소/ }).first();
    const hasRefund = await refundRow.count();
    if (hasRefund === 0) {
      test.skip(true, '이번달 환불 건 없음 — 환불 행 처리자 셀 테스트 스킵');
      return;
    }

    // 환불 행의 마지막 td(처리직원명) 렌더 확인
    const lastCell = refundRow.locator('td').last();
    const txt = (await lastCell.textContent())?.trim() ?? '';
    expect(txt.length).toBeGreaterThan(0); // 이름 or '—'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: 합계행(tfoot) 정렬 무결
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6: tfoot 합계행 정렬', () => {
  test('처리직원명 컬럼 추가 후에도 합계(실수납액) 정렬 유지', async ({ page }) => {
    await openPatientTab(page);

    const isEmpty = await page.getByTestId('sales-patient-empty').isVisible().catch(() => false);
    if (isEmpty) return;

    // 합계 셀 표시 확인 (정렬 깨짐 없이 렌더)
    await expect(page.getByTestId('sales-patient-total')).toBeVisible();

    // tfoot 셀 colSpan 합 = 15 (11 + 1(합계) + 3(결제수단·전표상태·처리직원명))
    const grid = page.getByTestId('sales-patient-grid');
    const footCells = grid.locator('tfoot tr td');
    let span = 0;
    const n = await footCells.count();
    for (let i = 0; i < n; i++) {
      const cs = await footCells.nth(i).getAttribute('colspan');
      span += cs ? parseInt(cs, 10) : 1;
    }
    expect(span).toBe(15);
  });
});
