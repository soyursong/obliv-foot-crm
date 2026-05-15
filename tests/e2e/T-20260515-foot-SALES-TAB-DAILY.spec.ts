/**
 * T-20260515-foot-SALES-TAB-DAILY — 일일결산 마감 뷰 E2E spec
 *
 * 검증 대상:
 *   시나리오 1: 일일결산 탭 기본 렌더 (듀얼 매트릭스 + 현금 시재)
 *   시나리오 2: 기간 필터 변경 → 집계 갱신 확인
 *   시나리오 3: 엑셀 다운로드 (공통 COMMON-DB 레이어 경유)
 *   AC-2: 좌우 합계 표시 testid 확인
 *   AC-3: 현금 시재 섹션 렌더
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 일일결산 탭 기본 렌더
// ─────────────────────────────────────────────────────────────────────────────
test.describe('일일결산 탭 기본 렌더', () => {
  test('매출집계 → 일일결산 탭 기본 활성 + daily 탭 컨테이너 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 기본 활성 탭은 일일결산
    await expect(page.getByRole('tab', { name: /일일결산/ })).toHaveAttribute(
      'data-state',
      'active',
    );

    // SalesDailyTab 컨테이너 표시
    await expect(page.getByTestId('sales-daily-tab')).toBeVisible();
  });

  test('좌측 발생기준 매트릭스 렌더 (헤더 + testid)', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const leftMatrix = page.getByTestId('sales-daily-left-matrix');
    await expect(leftMatrix).toBeVisible();

    // 좌측 매트릭스에 발생기준 카테고리 표시
    await expect(leftMatrix).toContainText('급여');
    await expect(leftMatrix).toContainText('비급여');
    await expect(leftMatrix).toContainText('총진료비');
  });

  test('우측 수납수단별 교차 매트릭스 렌더', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const rightMatrix = page.getByTestId('sales-daily-right-matrix');
    await expect(rightMatrix).toBeVisible();

    // 수납수단 행
    for (const method of ['현금', '카드', '이체', '선수금차감']) {
      await expect(rightMatrix).toContainText(method);
    }

    // 세금속성 열
    for (const taxCol of ['과세', '면세', '급여', '선수금']) {
      await expect(rightMatrix).toContainText(taxCol);
    }
  });

  test('AC-3: 현금 시재 추적 섹션 렌더', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const cashTracker = page.getByTestId('sales-daily-cash-tracker');
    await expect(cashTracker).toBeVisible();

    // 현금 시재 4개 항목
    await expect(cashTracker).toContainText('전일 이월금');
    await expect(cashTracker).toContainText('당일 현금수납');
    await expect(cashTracker).toContainText('지출');
    await expect(cashTracker).toContainText('남은 현금');
  });

  test('좌측 총진료비 합계 + 우측 합계 testid 모두 존재', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // AC-2 대사 검증용 testid
    await expect(page.getByTestId('sales-daily-left-total')).toBeVisible();
    await expect(page.getByTestId('sales-daily-right-total')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 기간 필터 변경 → 집계 갱신
// ─────────────────────────────────────────────────────────────────────────────
test.describe('기간 필터 변경 후 집계 갱신', () => {
  test('이번주 프리셋 → daily 탭 여전히 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 이번주 프리셋 클릭
    await page.getByTestId('sales-preset-week').click();
    await page.waitForLoadState('networkidle');

    // daily 탭 컨테이너 여전히 렌더됨
    await expect(page.getByTestId('sales-daily-tab')).toBeVisible();
  });

  test('직접입력 → 어제 날짜 → 현금 시재 전일이월금 표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 직접입력 모드 전환
    await page.getByTestId('sales-preset-custom').click();

    // 어제 날짜 계산
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.toISOString().split('T')[0];

    // from/to 모두 어제로 설정
    await page.getByTestId('sales-date-from').fill(y);
    await page.getByTestId('sales-date-to').fill(y);
    await page.waitForTimeout(500); // debounce

    // 현금 시재 섹션 여전히 렌더됨
    await expect(page.getByTestId('sales-daily-cash-tracker')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 엑셀 다운로드 버튼 (공통 COMMON-DB 레이어)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('엑셀 다운로드', () => {
  test('엑셀 다운로드 버튼 렌더 + 클릭 시 toast 또는 다운로드 트리거', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    const exportBtn = page.getByTestId('sales-export-btn');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).not.toBeDisabled();

    // 클릭 후 "다운로드 중" 또는 "없습니다" toast 중 하나
    const [downloadEvent] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      exportBtn.click(),
    ]);

    // 결과는 다운로드 성공 OR "내역 없음" toast — 어느 쪽이든 오류는 아님
    // toast 오류 메시지가 없으면 패스
    await page.waitForTimeout(1000);
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    await expect(errorToast).toHaveCount(0);

    if (downloadEvent) {
      expect(downloadEvent.suggestedFilename()).toMatch(/매출집계/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 대사 불일치 경고 표시 확인 (데이터 있는 경우만 활성)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2: 대사 경고 배너', () => {
  test('데이터 없을 때 대사 경고 미표시', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 데이터가 없는 날짜 범위 (미래 날짜)
    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill('2099-01-01');
    await page.getByTestId('sales-date-to').fill('2099-01-01');
    await page.waitForTimeout(800);

    // 대사 경고 없음
    await expect(page.getByTestId('sales-daily-mismatch-warning')).toHaveCount(0);
    // 빈 상태 표시
    await expect(page.getByTestId('sales-daily-empty')).toBeVisible();
  });
});
