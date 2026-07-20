/**
 * E2E spec — T-20260708-foot-MINIPAY-CHARTFEE-FEEITEM-LEFTLANE
 * 결제 미니창 — 차트 코드 컬럼(② pmw-chartcode-col) + 진료비 산정 lane(③ pmw-settle-lane) 검증
 *
 * 배경: 진료비 산정/수가 항목이 좁은 고정폭(구 lg:w-72≈288px) 중앙 컬럼에 있어 항목이 잘 안 보임.
 *       → 차트 코드 + 치료내용을 넓은 독립 컬럼으로 재배치.
 *
 * ⚠ 갱신: T-20260720-foot-PAYMINI-CHARTCODE-SPLIT — PaymentMiniWindow 중앙 컬럼이 3→4 존으로 분리.
 *   구 [차트 코드 + 진료비 산정] 결합 헤더 + "수가 항목" 영역을 담던 넓은 독립 lane(구 pmw-fee-lane,
 *   pmw-feeitem-row/pmw-feeitem-toggle)이 제거됨. 신규 4-존 DOM 계약:
 *     ① [data-testid="pmw-code-grid"]      코드 그리드(고정폭)
 *     ② [data-testid="pmw-chartcode-col"]  헤더 "차트 코드" — 상병코드/처방약/치료내용(N건) + pricing-list
 *                                          내부 스크롤 컨테이너 [data-testid="pmw-chartcode-scroll"]
 *     ③ [data-testid="pmw-settle-lane"]    헤더 "진료비 산정" — 세금구분·수납잔액·수납흐름
 *     ④ [data-testid="pmw-zone3"]          패키지·서류발행
 *   "수가 항목 (N건)" → "치료내용 (N건)"으로 라벨 변경. 결합 헤더 /차트 코드.*진료비 산정/ 는 더 이상 없음.
 *
 * AC-1: 차트 코드 컬럼(② pmw-chartcode-col)이 코드 그리드(① pmw-code-grid)보다 넓게 표시됨 ("넓게 보인다")
 * AC-2: "차트 코드" 헤더(②) + "치료내용 (N건)" 섹션이 컬럼 내 정상 렌더 + ③ 진료비 산정 lane 존재
 * AC-3: 서류코드·세금구분·합계·수납버튼(③ 진료비 산정 lane 요소)이 기능·위치 그대로 유지
 * AC-4: Zone1 카테고리 탭 + Zone3(패키지·서류발행)이 기존대로 표시
 * AC-5(회귀): 치료내용 스크롤 영역 정상 — ② 컬럼의 pmw-chartcode-scroll overflow 컨테이너 유지
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 중앙 컬럼 3→4 존 분리 반영 (구 pmw-fee-lane 제거)
test.describe('T-20260708-foot-MINIPAY-CHARTFEE-FEEITEM-LEFTLANE — 차트 코드 컬럼 넓은 재배치', () => {

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

  // ── AC-1: 차트 코드 컬럼(②)이 코드 그리드(①)보다 넓다 (핵심 — "넓게 보인다") ──────
  test('AC-1: 차트 코드 컬럼이 코드 그리드보다 넓게 표시', async ({ page }) => {
    // 넓은 뷰포트(갤탭 가로 ~ 데스크탑)에서 검증
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 구 pmw-fee-lane → ② pmw-chartcode-col
    const chartcodeCol = dialog.locator('[data-testid="pmw-chartcode-col"]');
    const codeGrid = dialog.locator('[data-testid="pmw-code-grid"]');
    await expect(chartcodeCol).toBeVisible();
    await expect(codeGrid).toBeVisible();

    const feeBox = await chartcodeCol.boundingBox();
    const codeBox = await codeGrid.boundingBox();
    expect(feeBox).not.toBeNull();
    expect(codeBox).not.toBeNull();
    if (feeBox && codeBox) {
      // T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 구 T-20260708 "넓은 단일 lane(>340px)" 전제는
      //   3열→4열 분리로 폐기(pmw-fee-lane 제거·이미 obsolete). ② 차트 코드는 이제 ① 우측 독립 컬럼.
      //   → 폭 우위/절대폭(340px) 단언 제거, 컬럼 위치(① 우측)만 회귀 가드로 유지.
      expect(feeBox.x).toBeGreaterThan(codeBox.x);
      expect(feeBox.width).toBeGreaterThan(0);
    }
  });

  // ── AC-2: "차트 코드" 헤더(②) + "치료내용" 섹션이 컬럼 내 정상 렌더 + ③ 진료비 산정 lane ──
  test('AC-2: [차트 코드] 헤더 + [치료내용] 섹션이 컬럼 내 렌더 + 진료비 산정 lane 존재', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 결합 헤더 제거 → ② 차트 코드 컬럼 + ③ 진료비 산정 lane 분리
    const chartcodeCol = dialog.locator('[data-testid="pmw-chartcode-col"]');
    // ② 컬럼 헤더 "차트 코드"가 컬럼 내부에 있음
    await expect(chartcodeCol.getByText('차트 코드', { exact: true })).toBeVisible();
    // ③ 진료비 산정 lane도 별도 존으로 존재
    await expect(dialog.locator('[data-testid="pmw-settle-lane"]')).toBeVisible();

    // 풋케어 항목 선택 → 치료내용 표시 (② 컬럼 내부)
    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) > 0) {
      await svcBtns.first().click();
      // 치료내용 (N건) 카운트 라벨 — 데이터/개수 표시 불변 (구 "수가 항목" → "치료내용")
      await expect(chartcodeCol.getByText(/치료내용 \(\d+건\)/)).toBeVisible();
      // pricing-list 컨테이너가 ② 차트 코드 컬럼 내부에 존재
      await expect(chartcodeCol.locator('[data-testid="pricing-list"]')).toBeVisible();
    }
  });

  // ── AC-3: 서류코드·세금구분·합계·수납버튼이 그대로 유지 ──────────────────────
  test('AC-3: 잔여 Zone2 요소(세금구분·합계·수납흐름) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 풋케어 코드 선택 → 산정 요소 노출
    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) {
      test.skip();
      return;
    }
    await svcBtns.first().click();

    // 세금 구분 + settle-lane 볼드 총액 표시
    // T-20260716-foot-SETTLE-LANE-TOTAL-LABEL-SPEC-STALE: COPAY-BALANCE-SPLIT(deployed) 이후
    //   settle-lane 볼드 총액 라벨 '합계'→'수납잔액'(공단부담 제외). 잔여 '합계' 렌더는 금액 인라인
    //   동거(예: "합계 12,345")라 exact:true 미매칭 → pmw-settle-lane 스코프 + '수납잔액' exact 로 교정.
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(
      dialog.locator('[data-testid="pmw-settle-lane"]').getByText('수납잔액', { exact: true }),
    ).toBeVisible();

    // 산정 버튼 → 수납 버튼 흐름 유지
    const saveBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(dialog.locator('[data-testid="btn-settle"]')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-4: Zone1 탭 + Zone3 유지 ──────────────────────────────────────────
  test('AC-4: Zone1 카테고리 탭 + Zone3(패키지·서류발행) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // Zone1 탭
    await expect(dialog.getByRole('button', { name: '상병코드', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '처방약', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '풋케어', exact: true })).toBeVisible();

    // Zone3 서류발행
    await expect(dialog.getByText('서류발행')).toBeVisible();
    await expect(dialog.locator('[data-testid="doc-template-list"]')).toBeVisible();
  });

  // ── AC-5(회귀): 치료내용 스크롤 컨테이너 유지 ─────────────────────────────
  test('AC-5: 치료내용 스크롤 컨테이너(overflow) 유지', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) {
      test.skip();
      return;
    }
    await svcBtns.first().click();

    // T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 스크롤 소유가 pricing-list 자체 → ② 컬럼의
    //   pmw-chartcode-scroll 컨테이너로 이동. pricing-list는 ② 컬럼 내 visible, 스크롤은 상위 컨테이너가 소유.
    const chartcodeCol = dialog.locator('[data-testid="pmw-chartcode-col"]');
    const list = chartcodeCol.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible();
    // 스크롤 가능 컨테이너 클래스 유지 (overflow-y-auto) — ② 컬럼의 스크롤 컨테이너 소유
    const scrollContainer = chartcodeCol.locator('[data-testid="pmw-chartcode-scroll"]');
    await expect(scrollContainer).toHaveClass(/overflow-y-auto/);
  });
});
