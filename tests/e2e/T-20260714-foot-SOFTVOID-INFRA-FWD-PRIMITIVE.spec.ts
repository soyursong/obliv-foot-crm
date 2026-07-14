/**
 * T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE — soft-void 인프라 forward 프리미티브 E2E spec
 *
 * 배경 (DA Q2 승인, MSG-20260714-182105-296w):
 *   closing_manual_payments 에 soft-void 메타 3컬럼(voided_at/voided_reason/voided_by) ADDITIVE 신설.
 *   전 합산경로(foot 스코프)에 `WHERE voided_at IS NULL` 필터를 원자배포:
 *     (a) 일마감(Closing) grossTotal — foot 라이브 확정 경로(수기 포함)
 *     (b) 매출집계(SalesDailyTab) 비급여버킷 — revenue_insurance_split §2-1 산식 소스
 *
 * forward 프리미티브 = 인프라 선행. 배포 직후 기존행 전부 voided_at=NULL → 3버킷 합계 불변(net-zero).
 *
 * 검증지문:
 *   PostgREST 는 .is('voided_at', null) 을 쿼리스트링 `voided_at=is.null` 로 인코딩한다.
 *   두 합산경로 모두 이 필터가 붙은 요청을 보내야 forward 프리미티브가 연결된 것.
 *
 * 현장 클릭 시나리오 2종:
 *   1) 일마감 화면 진입 → 수기결제 조회에 voided_at IS NULL 필터 + 합계 카드 회귀 0
 *   2) 매출집계 화면 진입 → 수기결제 조회에 voided_at IS NULL 필터 + 좌/우 매트릭스 회귀 0
 *
 * READ-ONLY (프리미티브 배포 검증 — 무효행 생성 없음). DDL 은 별도 마이그레이션 러너로 선행 적용.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const CLOSING_URL = `${BASE_URL}/admin/closing`;
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

test.describe('soft-void forward 프리미티브 — 합산경로 필터 연결', () => {
  test('시나리오1: 일마감 grossTotal — 수기결제 조회에 voided_at=is.null 필터', async ({ page }) => {
    let filteredQuery = false;
    let anyManualQuery = false;
    page.on('request', (req) => {
      const u = req.url();
      if (/closing_manual_payments/.test(u)) {
        anyManualQuery = true;
        if (/voided_at=is\.null/.test(u)) filteredQuery = true;
      }
    });

    await page.goto(CLOSING_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // 수기결제 조회가 발생했고, 그 조회에 soft-void 필터가 붙어야 한다 (합산경로 a).
    expect(anyManualQuery).toBeTruthy();
    expect(filteredQuery).toBeTruthy();
  });

  test('시나리오1-회귀: 일마감 합계 카드 정상 렌더 (net-zero — 화면 크래시 0)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(CLOSING_URL);
    await page.waitForLoadState('networkidle');

    // 합계 영역이 렌더되고, 컬럼 미존재 등으로 인한 런타임 크래시가 없어야 한다.
    await expect(page.getByText(/합계/).first()).toBeVisible();
    expect(errors.join('\n')).not.toMatch(/voided_at|column .* does not exist/i);
  });

  test('시나리오2: 매출집계 비급여버킷 — 수기결제 조회에 voided_at=is.null 필터', async ({ page }) => {
    let filteredQuery = false;
    let anyManualQuery = false;
    page.on('request', (req) => {
      const u = req.url();
      if (/closing_manual_payments/.test(u)) {
        anyManualQuery = true;
        if (/voided_at=is\.null/.test(u)) filteredQuery = true;
      }
    });

    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // 매출집계 비급여버킷 조회에 soft-void 필터가 붙어야 한다 (합산경로 b).
    expect(anyManualQuery).toBeTruthy();
    expect(filteredQuery).toBeTruthy();
  });

  test('시나리오2-회귀: 매출집계 좌/우 매트릭스 + 대사 정합 유지', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('sales-daily-left-matrix')).toBeVisible();
    await expect(page.getByTestId('sales-daily-right-matrix')).toBeVisible();
    await expect(page.getByTestId('sales-daily-left-total')).toBeVisible();
    await expect(page.getByTestId('sales-daily-right-total')).toBeVisible();
    // 대사 경고: 좌우 합 정합이 깨지지 않아야(무효행 제거가 좌/우 동시 적용 → mismatch 없음)
    await expect(page.getByTestId('sales-daily-mismatch-warning')).toHaveCount(0);
  });
});
