/**
 * T-20260807-foot-SALESDOCTOR-DEDUCT-DRILLDOWN-FIX-DETAIL
 * 매출집계 > 담당치료사별 탭 — '차감 건수' 클릭 drill-down 리스트
 *   (1) 데이터 불일치 수정(AC-1)  (2) 성함+차트번호+치료종류(6종)+차감금액 컴팩트 표기(AC-2)
 *
 * 티켓 §현장 클릭 시나리오 2종 변환:
 *   시나리오 1(정상 동선): 담당치료사별 탭 → 차감 건수(≥1) 클릭 → 리스트 팝업
 *     · 리스트 행 수 == 표의 차감 건수(N)  [AC-1 집계↔drill-down 정합]
 *     · 각 행에 성함·차트번호·치료종류(6종 중 1)·차감금액 모두 표시  [AC-2]
 *     · 리스트 합계 금액 == 표의 '차감 매출(치료)'  [AC-1 금액 정합]
 *   시나리오 2(엣지): 차감 건수 0 = 비활성 / 같은 고객 다치료 = 치료별 행 분리(합산 뭉개기 금지)
 *
 * AC 매핑:
 *   AC-1 — 리스트 행 수 == 차감 건수(카운트 정합) + Σ(리스트 금액) == 표 '차감 매출(치료)'(금액 정합)
 *          (집계·drill-down 모두 동일 소스 deductSessions·동일 산식 deductAmount 파생 → 구조적 보장)
 *   AC-2 — 각 행 성함+차트번호+치료종류(비가열/가열/포돌로게/수액/체험권/Re:Born)+차감금액 컴팩트 표기
 *
 * READ-ONLY — DB 변경 없음(집계 조회 + 기존 라우팅 재사용). ADDITIVE(표시 컬럼 추가 + read 필터 정합).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

test.use({ storageState: 'playwright/.auth/user.json' });

/** 6종 화이트리스트 라벨 — drill-down 치료종류 셀이 이 중 하나(또는 폴백)여야 함. */
const SIX_BUCKET = ['비가열', '가열', '포돌로게', '수액', '체험권', 'Re:Born'];

/** 담당치료사별 탭 진입 + 이번달 프리셋(차감기준 기본). */
async function gotoStaffTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await page.waitForLoadState('networkidle');
  const staffTab = page.getByRole('tab', { name: /담당치료사별/ });
  await staffTab.waitFor({ state: 'visible', timeout: 15000 });
  await staffTab.click();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sales-preset-month').click().catch(() => {});
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sales-staff-basis-deduction').click().catch(() => {});
  await page.waitForLoadState('networkidle');
}

/** 클릭 가능한 '차감 건수' 버튼(값 ≥1) 중 첫 번째 + staffId 반환. 없으면 null. */
async function firstDeductCountButton(page: import('@playwright/test').Page) {
  const btn = page.locator('button[data-testid^="sales-staff-deduct-count-"]').first();
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) return null;
  const testId = (await btn.getAttribute('data-testid')) ?? '';
  const staffId = testId.replace('sales-staff-deduct-count-', '');
  return { btn, staffId };
}

/** '1,234원' → 1234 숫자로 파싱(콤마·원·공백 제거). */
function parseWon(text: string | null): number {
  return Number((text ?? '').replace(/[^0-9-]/g, '')) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 (차감 건수 → 리스트 → 카운트/금액 정합 + 6종 표기)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 차감 건수 drill-down 정합 + 컴팩트 표기', () => {
  test('담당치료사별 탭 진입 정상 렌더(에러 없음)', async ({ page }) => {
    await gotoStaffTab(page);
    await expect(page.getByRole('tab', { name: /담당치료사별/ })).toHaveAttribute(
      'data-state',
      'active',
    );
    const anyView = page
      .locator(
        '[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]',
      )
      .first();
    await expect(anyView).toBeVisible();
  });

  test('AC-1 — 리스트 행 수 == 표의 차감 건수(카운트 정합)', async ({ page }) => {
    await gotoStaffTab(page);
    const hit = await firstDeductCountButton(page);
    if (!hit) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — drill-down 대상 없음');
      return;
    }
    const count = Number((await hit.btn.textContent())?.trim() ?? '0');
    expect(count).toBeGreaterThan(0);

    await hit.btn.click();
    await expect(page.getByTestId('deduct-dialog-title')).toBeVisible({ timeout: 3000 });
    const rows = page.locator('[data-testid^="deduct-dialog-row-"]');
    await expect(rows).toHaveCount(count);
  });

  test('AC-1 — 리스트 합계 금액 == 표의 차감 매출(치료) (금액 정합)', async ({ page }) => {
    await gotoStaffTab(page);
    const hit = await firstDeductCountButton(page);
    if (!hit) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — 금액 정합 대상 없음');
      return;
    }
    // 표에 보이던 '차감 매출(치료)' 값
    const tableRevenue = parseWon(
      await page.getByTestId(`sales-staff-deduct-revenue-${hit.staffId}`).textContent(),
    );

    await hit.btn.click();
    await expect(page.getByTestId('deduct-dialog-total')).toBeVisible({ timeout: 3000 });
    const dialogTotal = parseWon(await page.getByTestId('deduct-dialog-total').textContent());

    // 동일 소스·동일 산식(deductAmount) → 표 매출과 드릴다운 합계가 일치해야 한다.
    expect(dialogTotal).toBe(tableRevenue);
  });

  test('AC-2 — 각 행 성함·차트번호·치료종류(6종)·차감금액 표시', async ({ page }) => {
    await gotoStaffTab(page);
    const hit = await firstDeductCountButton(page);
    if (!hit) {
      test.skip(true, '이번달 차감 건수 ≥1 치료사 행 없음 — 표시 대상 없음');
      return;
    }
    await hit.btn.click();
    await expect(page.getByTestId('deduct-dialog-list')).toBeVisible({ timeout: 3000 });

    // 헤더 5항목(고객성함·차트번호·차감 날짜·치료종류·차감 금액)
    for (const h of ['고객성함', '차트번호', '차감 날짜', '치료종류', '차감 금액']) {
      await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    }

    const firstRow = page.locator('[data-testid^="deduct-dialog-row-"]').first();
    // 5개 셀(성함·차트·날짜·치료종류·금액)
    await expect(firstRow.locator('td')).toHaveCount(5);

    // 치료종류 셀(4번째) — 6종 화이트리스트 중 하나(또는 폴백 라벨) 표기, 최소 비어있지 않음
    const treatmentText = ((await firstRow.locator('td').nth(3).textContent()) ?? '').trim();
    expect(treatmentText.length).toBeGreaterThan(0);

    // 차감 금액 셀(5번째, data-testid) — '원' 표기 금액
    const amountCell = firstRow.locator('[data-testid^="deduct-dialog-amount-"]');
    await expect(amountCell).toBeVisible();
    await expect(amountCell).toContainText('원');
  });

  test('AC-2 — 리스트 전 행 치료종류가 6종 라벨 집합에 부합(또는 폴백)', async ({ page }) => {
    await gotoStaffTab(page);
    const hit = await firstDeductCountButton(page);
    if (!hit) {
      test.skip(true, '차감 건수 ≥1 치료사 행 없음');
      return;
    }
    await hit.btn.click();
    await expect(page.getByTestId('deduct-dialog-list')).toBeVisible({ timeout: 3000 });

    const rows = page.locator('[data-testid^="deduct-dialog-row-"]');
    const n = await rows.count();
    let sixBucketHits = 0;
    for (let i = 0; i < n; i++) {
      const t = ((await rows.nth(i).locator('td').nth(3).textContent()) ?? '').trim();
      if (SIX_BUCKET.some((b) => t.includes(b))) sixBucketHits += 1;
    }
    // 최소 1건은 6종 화이트리스트 라벨이어야 한다(전량 폴백이면 매핑 회귀 의심).
    expect(sixBucketHits).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 엣지 케이스 (차감 건수 0 비활성 / 같은 고객 다치료 행 분리)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 엣지 케이스', () => {
  test('AC-1 — 차감 건수 0 셀은 클릭 버튼이 아니다(비활성 텍스트)', async ({ page }) => {
    await gotoStaffTab(page);
    // 클릭 가능한 차감 건수 버튼의 텍스트는 모두 1 이상(0은 span).
    const btns = page.locator('button[data-testid^="sales-staff-deduct-count-"]');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const t = Number((await btns.nth(i).textContent())?.trim() ?? '0');
      expect(t).toBeGreaterThan(0);
    }
  });

  test('AC-1 — 같은 고객 여러 치료 차감 시 행이 합산 뭉개짐 없이 분리(행 수 == 건수)', async ({ page }) => {
    await gotoStaffTab(page);
    const hit = await firstDeductCountButton(page);
    if (!hit) {
      test.skip(true, '차감 건수 ≥1 치료사 행 없음');
      return;
    }
    const count = Number((await hit.btn.textContent())?.trim() ?? '0');
    await hit.btn.click();
    await expect(page.getByTestId('deduct-dialog-list')).toBeVisible({ timeout: 3000 });

    // 행 수 == 차감 건수 → 고객/치료 단위 개별 행(합산 뭉개기 금지)이 구조적으로 보장됨.
    const rows = page.locator('[data-testid^="deduct-dialog-row-"]');
    await expect(rows).toHaveCount(count);
  });
});
