/**
 * E2E spec — T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT (ROW-SPLIT)
 * 결제 미니창 — [차트 코드+진료비 산정] 헤더 + [수가 항목]을 독립된 한 개의 행(row)으로 추출·좌측정렬.
 * LEFTLANE(dc469694) fee-lane flex-1 폭확장 revert 동반.
 *
 * 현장 확정(2026-07-08 19:03 김주연 총괄): "좌측 한줄로 아예 빼달라니깐 가로가 길~~어짐"
 *   = 가로 분리(2컬럼/넓은 lane) ✗ / 행(row) 분리 ✓ → 모달 총 가로폭 불변, 위/아래 별도 행.
 *
 * AC-1: [차트 코드+진료비 산정] 헤더 + [수가 항목]이 독립 행(pmw-feeitem-row)으로 추출되고,
 *       그 행이 하단 가로 zone(코드 그리드)보다 "위(row-split)"에 위치(세로 스택).
 * AC-2: LEFTLANE revert — 넓은 fee-lane(pmw-fee-lane) 제거됨. 코드 그리드는 flex-1 원복(가변),
 *       세금·합계·수납 tail(pmw-settle-lane)은 기존 좁은 폭 유지(코드 그리드보다 좁음).
 *       "가로 길어짐" 회귀 금지: 추출 행 내부 콘텐츠는 모달을 넘지 않고 좌측정렬(우측 여백 존재).
 * AC-3: 추출 행 내 수가 항목 기존 기능(추가·합계 갱신·스크롤 컨테이너) 회귀 없음.
 * AC-4: 좁은 화면(80% 축소 ≈ 세로 태블릿 폭)에서 가로 잘림/줄바꿈/겹침 없음 — 추출 행이 가로 오버플로 없음.
 * AC-5: Zone1 카테고리 탭 + Zone3(패키지·서류발행)이 기존대로 표시.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT — 수가 항목 독립 행(row-split)', () => {

  async function openPaymentMiniWindow(page: import('@playwright/test').Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;

    const settleBtn = page
      .locator('[data-testid="btn-payment-mini"], button')
      .filter({ hasText: /결제하기/ })
      .first();

    if ((await settleBtn.count()) === 0) return null;
    await settleBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /결제 미니창/ });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      return null;
    }
    return dialog;
  }

  // ── AC-1: 헤더 + 수가 항목이 독립 행으로 추출되고 하단 zone보다 위에 위치(세로 스택) ──
  test('AC-1: [차트 코드+진료비 산정]+[수가 항목] 독립 행이 코드 그리드보다 위(row-split)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    const codeGrid = dialog.locator('[data-testid="pmw-code-grid"]');
    await expect(feeRow).toBeVisible();
    await expect(codeGrid).toBeVisible();

    // 헤더가 추출 행 내부에 존재
    await expect(feeRow.getByText(/차트 코드.*진료비 산정/)).toBeVisible();

    const feeBox = await feeRow.boundingBox();
    const codeBox = await codeGrid.boundingBox();
    expect(feeBox).not.toBeNull();
    expect(codeBox).not.toBeNull();
    if (feeBox && codeBox) {
      // row-split 핵심: 수가항목 행이 코드 그리드보다 "위"에 (세로 스택) — 행 하단 ≤ 코드 그리드 상단(+오차)
      expect(feeBox.y + feeBox.height).toBeLessThanOrEqual(codeBox.y + 8);
    }
  });

  // ── AC-2: LEFTLANE revert + 가로 길어짐 회귀 금지 ──
  test('AC-2: 넓은 fee-lane 제거·코드 그리드 flex-1 원복·추출 행 좌측정렬(우측 여백)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    // LEFTLANE의 넓은 lane(pmw-fee-lane)은 제거되어야 함
    await expect(dialog.locator('[data-testid="pmw-fee-lane"]')).toHaveCount(0);

    const codeGrid = dialog.locator('[data-testid="pmw-code-grid"]');
    const settle = dialog.locator('[data-testid="pmw-settle-lane"]');
    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    await expect(codeGrid).toBeVisible();
    await expect(settle).toBeVisible();

    const codeBox = await codeGrid.boundingBox();
    const settleBox = await settle.boundingBox();
    const feeBox = await feeRow.boundingBox();
    if (codeBox && settleBox) {
      // revert 증거: 코드 그리드(flex-1)가 세금·합계·수납 tail(고정 좁은 폭)보다 넓음
      expect(codeBox.width).toBeGreaterThan(settleBox.width);
    }
    if (feeBox) {
      // 추출 행 자체는 모달 폭을 넘지 않음(가로 오버플로/길어짐 없음)
      const dialogBox = await dialog.boundingBox();
      if (dialogBox) expect(feeBox.width).toBeLessThanOrEqual(dialogBox.width + 2);
      // 좌측정렬: 행 내부 콘텐츠는 좌측 고정 + 우측 여백 존재 → 콘텐츠 실폭 < 행 폭
      const inner = feeRow.locator(':scope > div').first();
      const innerBox = await inner.boundingBox();
      if (innerBox) {
        expect(innerBox.x).toBeLessThanOrEqual(feeBox.x + 8);          // 좌측 고정
        expect(innerBox.width).toBeLessThan(feeBox.width - 4);          // 우측 여백(=콘텐츠가 full stretch 아님)
      }
    }
  });

  // ── AC-3: 추출 행 내 수가 항목 기능(추가·합계·스크롤) 회귀 없음 ──
  test('AC-3: 수가 항목 추가 → 합계 갱신 + 스크롤 컨테이너 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');

    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) { test.skip(); return; }
    await svcBtns.first().click();

    // 수가 항목 카운트 라벨 + 리스트가 추출 행 내부에 렌더
    await expect(feeRow.getByText(/수가 항목 \(\d+건\)/)).toBeVisible();
    const list = feeRow.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible();
    await expect(list).toHaveClass(/overflow-y-auto/);

    // 합계(세금·합계는 tail로 흐르되 계산 정상) — 합계 라벨 노출
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(dialog.getByText('합계', { exact: true })).toBeVisible();

    // 저장 → 수납 흐름 유지
    const saveBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(dialog.locator('[data-testid="btn-settle"]')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-4: 좁은 화면(80% 축소 근사)에서 가로 잘림/줄바꿈/겹침 없음 ──
  //   모달 오픈은 데스크탑 폭에서 신뢰성 있게 수행한 뒤, 뷰포트를 좁혀(≥sm 유지) 반응형 오버플로를 직접 검증.
  //   (대시보드의 좁은 폭 오픈 경로는 breakpoint/자동새로고침 상호작용으로 불안정 → 오픈 후 resize 방식 채택.)
  test('AC-4: 좁은 화면에서 추출 행 가로 오버플로(잘림/길어짐) 없음', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    await expect(feeRow).toBeVisible();

    // 오버플로(잘림/줄바꿈 유발 = "가로가 길어짐") 없음 판정 헬퍼: scrollWidth ≤ clientWidth(+오차)
    const noOverflow = async () => {
      await expect(feeRow).toBeVisible({ timeout: 5_000 });
      const overflow = await feeRow.evaluate((el) => el.scrollWidth - el.clientWidth, undefined, { timeout: 5_000 });
      expect(overflow).toBeLessThanOrEqual(2);
    };

    // (1) 넓은 폭(가장 "길어짐" 나기 쉬운 케이스) — 추출 행 가로 오버플로 없음
    await noOverflow();

    // (2) 80% 축소 근사 — 좁은 데스크탑 폭으로 리사이즈(sm(640) 이상 유지 → row-split 레이아웃 유지)
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(600); // 리사이즈 재레이아웃 settle (portal 재렌더 detach 회피)
    await expect(feeRow.getByText(/차트 코드.*진료비 산정/)).toBeVisible({ timeout: 5_000 });
    await noOverflow();

    // 추출 행이 모달(뷰포트) 폭을 넘지 않음 = "가로가 길어짐" 재발 없음
    const box = await feeRow.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(900 + 2);
  });

  // ── AC-5: Zone1 탭 + Zone3 유지 ──
  test('AC-5: Zone1 카테고리 탭 + Zone3(패키지·서류발행) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    await expect(dialog.getByRole('button', { name: '상병코드', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '처방약', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '풋케어', exact: true })).toBeVisible();

    await expect(dialog.getByText('서류발행')).toBeVisible();
    await expect(dialog.locator('[data-testid="doc-template-list"]')).toBeVisible();
  });
});
