/**
 * T-20260731-foot-COSMETIC-SALES-DETAIL-POPUP
 * 매출집계 > 담당치료사별 > '화장품 매출' 칸 클릭 → 판매내역 드릴다운 팝업(읽기전용) E2E
 *
 * 상보 티켓: T-20260724-foot-COSMETIC-SELLER-ATTRIB (화장품 매출 집계 컬럼, 이미 배포).
 *   본 팝업은 그 집계칸의 드릴다운 = "집계가 실제랑 상이" 자체진단 도구.
 *
 * 수용 기준:
 *   AC1: 화장품 매출 칸(금액>0) 클릭 → 팝업 노출.
 *   AC2: 팝업에 고객성함/차트번호/판매제품명/금액(+판매일자) 열 + 해당 치료사 판매 건 표시.
 *   AC3(★핵심 불변식): Σ(팝업 행 금액) === 클릭한 칸 표시금액.
 *        팝업은 집계 쿼리(cosmeticLines)와 동일 소스·동일 버킷에서 파생 → 구조적 보장.
 *   AC4: 0(—) 칸 클릭 = 무반응(팝업 미노출).
 *   AC6: X/배경 클릭으로 닫힘.
 *
 * 견고성: prod 실데이터/빈데이터 양쪽 통과 — 구조(칸/팝업) 존재는 데이터 유무와 무관 단언,
 *   AC3 금액 단언은 클릭 가능한(금액>0) 칸이 실제 있을 때만.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const SHOT_DIR = '_handoff/qa_screenshots/T-20260731-foot-COSMETIC-SALES-DETAIL-POPUP';

/** "447,000원" · "447,000" → 447000 (숫자 외 문자 제거). */
function parseAmount(text: string | null): number {
  if (!text) return NaN;
  const digits = text.replace(/[^0-9-]/g, '');
  return digits === '' ? NaN : parseInt(digits, 10);
}

async function openStaffTab(page: Page) {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: '담당치료사별' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page.locator('[data-testid="sales-staff-basis-toggle"]')).toBeVisible({ timeout: 10_000 });
}

async function settleDeduction(page: Page): Promise<'data' | 'empty'> {
  await page.locator('[data-testid="sales-staff-loading"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page
    .locator('[data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-deduct-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  return (await page.locator('[data-testid="sales-staff-deduct-tab"]').isVisible().catch(() => false))
    ? 'data'
    : 'empty';
}

async function settlePayment(page: Page): Promise<'data' | 'empty'> {
  await page.locator('[data-testid="sales-staff-loading"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page
    .locator('[data-testid="sales-staff-tab"], [data-testid="sales-staff-empty"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  return (await page.locator('[data-testid="sales-staff-tab"]').isVisible().catch(() => false))
    ? 'data'
    : 'empty';
}

/**
 * 공통 AC3 검증: 클릭 가능한(금액>0) 화장품 칸 button 하나를 열어
 *   팝업 행 금액 합 === 칸 표시금액 인지 단언.
 * clickableSelector = 'button[data-testid^="..."]' (span 은 미포함 → 실제 클릭 가능 셀만).
 */
async function assertPopupSumEqualsCell(page: Page, clickableSelector: string, label: string) {
  const buttons = page.locator(clickableSelector);
  const count = await buttons.count();
  if (count === 0) {
    test.skip(true, `${label}: 화장품 매출>0 인 치료사 없음 — AC3 금액 단언 대상 부재`);
    return;
  }
  const cellButton: Locator = buttons.first();
  await expect(cellButton).toBeVisible();
  const cellAmount = parseAmount(await cellButton.textContent());
  expect(Number.isNaN(cellAmount)).toBeFalsy();
  expect(cellAmount).toBeGreaterThan(0);

  // AC1: 클릭 → 팝업 노출
  await cellButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="cosmetic-dialog-title"]')).toBeVisible();

  // AC2: 4열(+판매일자) 헤더
  for (const h of ['고객성함', '차트번호', '판매제품명', '판매일자', '금액']) {
    await expect(dialog.getByRole('columnheader', { name: h })).toBeVisible();
  }

  // AC3: Σ(팝업 행 금액) === 칸 금액.
  //   행별 금액 셀은 각 tr 의 마지막 td. dialog-total 셀도 칸과 동일해야 함.
  const rows = dialog.locator('[data-testid="cosmetic-dialog-list"] tr');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  let sum = 0;
  for (let i = 0; i < rowCount; i++) {
    const lastCell = rows.nth(i).locator('td').last();
    sum += parseAmount(await lastCell.textContent());
  }
  const totalCell = parseAmount(
    await page.locator('[data-testid="cosmetic-dialog-total"]').textContent(),
  );
  // 세 값 모두 일치: 행합 == 팝업 합계셀 == 클릭한 칸
  expect(sum).toBe(cellAmount);
  expect(totalCell).toBe(cellAmount);
  console.log(`[COSMETIC-POPUP] ${label} AC3 OK — 칸=${cellAmount} == Σ행=${sum} == 합계셀=${totalCell} (${rowCount}건)`);

  await page.screenshot({ path: `${SHOT_DIR}/${label}_popup.png`, fullPage: true }).catch(() => {});

  // AC6: X/Escape 로 닫힘
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

test.describe('T-20260731-foot-COSMETIC-SALES-DETAIL-POPUP 화장품 매출 드릴다운 팝업', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── 시나리오 1: 차감기준 — 칸 클릭 → 팝업 → AC3 불변식 ─────────────────────
  test('차감기준: 화장품 매출 칸 클릭 → 팝업 + Σ(행) === 칸(AC1·AC2·AC3·AC6)', async ({ page }) => {
    await openStaffTab(page);
    const state = await settleDeduction(page);
    if (state === 'empty') {
      await expect(page.locator('[data-testid="sales-staff-deduct-empty"]')).toBeVisible();
      test.skip(true, '차감 데이터 없음 — empty state 정상');
      return;
    }
    await assertPopupSumEqualsCell(
      page,
      'button[data-testid^="sales-staff-deduct-cosmetic-"]',
      'deduct',
    );
  });

  // ── 시나리오 1(수납): 귀속기준 토글 후에도 동일 불변식 유지(AC3) ──────────────
  test('수납기준: 화장품 매출 칸 클릭 → 팝업 + Σ(행) === 칸(AC3 유지)', async ({ page }) => {
    await openStaffTab(page);
    await settleDeduction(page);
    await page.locator('[data-testid="sales-staff-basis-payment"]').click();
    const state = await settlePayment(page);
    if (state === 'empty') {
      await expect(page.locator('[data-testid="sales-staff-empty"]')).toBeVisible();
      test.skip(true, '수납 데이터 없음 — empty state 정상');
      return;
    }
    await assertPopupSumEqualsCell(
      page,
      'button[data-testid^="sales-staff-cosmetic-therapist-"]',
      'payment',
    );
  });

  // ── 시나리오 2: 엣지 — 0(—) 칸 클릭 무반응(AC4) ──────────────────────────────
  test('엣지: 화장품 매출 0(—) 칸은 클릭 불가(팝업 미노출) (AC4)', async ({ page }) => {
    await openStaffTab(page);
    const state = await settleDeduction(page);
    if (state === 'empty') {
      test.skip(true, '차감 데이터 없음 — 엣지 단언 대상 부재');
      return;
    }
    // '—' 칸은 button 이 아니라 span(data-testid 동일, role=button 아님) → 클릭 트리거 없음.
    const emptyCells = page.locator('span[data-testid^="sales-staff-deduct-cosmetic-"]');
    const emptyCount = await emptyCells.count();
    if (emptyCount === 0) {
      test.skip(true, '화장품 매출 0(—) 치료사 없음 — AC4 단언 대상 부재');
      return;
    }
    const span = emptyCells.first();
    await expect(span).toHaveText('—');
    await span.click({ force: true }).catch(() => {}); // span 클릭 시도
    // 팝업이 뜨지 않아야 함
    await expect(page.getByRole('dialog')).toHaveCount(0);
    console.log('[COSMETIC-POPUP] AC4 OK — 0(—) 칸 클릭 무반응');
  });

  // ── 회귀: T-20260724 화장품 매출 컬럼(집계칸) 구조 유지 ────────────────────────
  test('회귀: 화장품 매출 컬럼 + 합계 셀 유지(집계 컬럼 비파괴)', async ({ page }) => {
    await openStaffTab(page);
    const state = await settleDeduction(page);
    if (state === 'empty') {
      test.skip(true, '차감 데이터 없음 — 회귀 단언 대상 부재');
      return;
    }
    const tbl = page.locator('[data-testid="sales-staff-deduct-tab"]');
    await expect(tbl.getByRole('columnheader', { name: '화장품 매출' })).toBeVisible();
    await expect(page.locator('[data-testid="sales-staff-deduct-total-cosmetic"]')).toBeVisible();
    console.log('[COSMETIC-POPUP] 회귀 OK — 집계 컬럼/합계셀 유지');
  });
});
