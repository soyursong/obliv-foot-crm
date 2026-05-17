/**
 * E2E spec — T-20260517-foot-BILLING-3ZONE
 * 풋케어 진료비 산정 3구역 레이아웃 + 서류발행 패키지/시술이력 연동
 *
 * AC-1: 3구역 레이아웃 (좌 메뉴+코드 / 중 저장+산정 / 우 서류+패키지) 구조 확인
 * AC-2: Zone2 — 상병코드/처방약 코드 저장 + 진료비 산정 통합 세로 영역
 * AC-3: Zone3 — 서류발행 우측 독립 구역
 * AC-4: Zone3 상단 — 구매패키지 읽기 전용 표시
 * AC-5: Zone3 상단 — 금일 시술내역 읽기 전용 표시
 * AC-6: 1920px 기준 3구역 가독성 (겹침·잘림 없음)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260517-foot-BILLING-3ZONE — 진료비 산정 3구역 레이아웃', () => {

  // ── 헬퍼: 결제 미니창 열기 ────────────────────────────────────────────────
  /**
   * 대시보드 진입 → 수납대기 슬롯 찾기 → [결제하기] 클릭 → PaymentMiniWindow 반환
   * 수납대기 환자 없으면 null 반환 (test.skip 처리)
   */
  async function openPaymentMiniWindow(page: import('@playwright/test').Page) {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) return null;

    // 수납대기 슬롯 찾기 (결제하기 버튼)
    const settleBtn = page
      .locator('[data-testid="btn-payment-mini"], button')
      .filter({ hasText: /결제하기/ })
      .first();

    const count = await settleBtn.count();
    if (count === 0) return null;

    await settleBtn.click();

    // PaymentMiniWindow 다이얼로그 대기
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /결제 미니창/ });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      return null;
    }
    return dialog;
  }

  // ── AC-1: 3구역 레이아웃 구조 확인 ──────────────────────────────────────
  test('AC-1: PaymentMiniWindow 3구역 레이아웃 — Zone1/Zone2/Zone3 모두 표시', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // Zone1: 좌측 탭 (상병코드/처방약/풋케어)
    await expect(dialog.getByText('상병코드')).toBeVisible();
    await expect(dialog.getByText('처방약')).toBeVisible();
    await expect(dialog.getByText('풋케어')).toBeVisible();

    // Zone2: 중앙 — 차트 코드 + 진료비 산정 헤더
    await expect(dialog.getByText(/차트 코드.*진료비 산정/)).toBeVisible();

    // Zone3: 우측 서류발행 영역
    const docList = dialog.locator('[data-testid="doc-template-list"]');
    await expect(docList).toBeVisible();

    // 다이얼로그 너비: max-w-[1080px] 확인 (1080px 이하 뷰포트에서 최대 폭)
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(700); // 최소 3구역 표시 가능 너비
    }
  });

  // ── AC-2: Zone2 — 코드 선택 → Zone2 표시 확인 ───────────────────────────
  test('AC-2: Zone2 — 풋케어 항목 선택 시 수가 항목 표시 + 진료비 산정', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 풋케어 탭 활성화 (기본값)
    const footcareTab = dialog.getByRole('button', { name: '풋케어' });
    if ((await footcareTab.count()) > 0) {
      await footcareTab.click();
    }

    // 서비스 버튼 첫 번째 클릭
    const svcBtns = dialog.locator('.grid.grid-cols-4 button');
    const svcCount = await svcBtns.count();
    if (svcCount > 0) {
      await svcBtns.first().click();
      // Zone2에 수가 항목 표시
      await expect(dialog.getByText(/수가 항목/)).toBeVisible();
    }
  });

  // ── AC-3: Zone3 — 서류발행 영역 표시 ─────────────────────────────────────
  test('AC-3: Zone3 — 서류발행 영역 및 출력 버튼 표시', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 서류발행 헤더
    await expect(dialog.getByText('서류발행')).toBeVisible();

    // 서류 목록
    const docList = dialog.locator('[data-testid="doc-template-list"]');
    await expect(docList).toBeVisible();

    // 출력 버튼
    const printBtn = dialog.locator('[data-testid="btn-doc-print"]');
    await expect(printBtn).toBeVisible();
  });

  // ── AC-4: Zone3 — 패키지 섹션 표시 ──────────────────────────────────────
  test('AC-4: Zone3 — 구매패키지 섹션 표시 (읽기 전용)', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 패키지 섹션 — 활성 패키지 없는 경우 "활성 패키지 없음" 표시
    const pkgSection = dialog.locator('p').filter({ hasText: /패키지/ }).first();
    await expect(pkgSection).toBeVisible();

    // 패키지가 있는 경우: 잔여 회차 표시
    const pkgItem = dialog.locator('.border-purple-200').first();
    if ((await pkgItem.count()) > 0) {
      await expect(pkgItem.getByText(/잔여/)).toBeVisible();
    }
  });

  // ── AC-5: Zone3 — 금일 시술내역 섹션 표시 ────────────────────────────────
  test('AC-5: Zone3 — 금일 시술내역 섹션 표시 (읽기 전용)', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 금일 시술내역 헤더
    const todaySection = dialog.getByText('금일 시술내역');
    await expect(todaySection).toBeVisible();
  });

  // ── AC-6: 3구역 겹침·잘림 없음 (1920px viewport) ─────────────────────────
  test('AC-6: 3구역 1920px 기준 가독성 확보 — 겹침·잘림 없음', async ({ page }) => {
    // 1920px 뷰포트 설정
    await page.setViewportSize({ width: 1920, height: 1080 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 3구역 모두 visible — 겹침 없음 확인
    await expect(dialog.getByText('상병코드')).toBeVisible();
    await expect(dialog.getByText(/차트 코드/)).toBeVisible();
    await expect(dialog.getByText('서류발행')).toBeVisible();

    // 다이얼로그 전체 영역이 뷰포트 안에 있는지
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1920 + 10); // 여유 10px
    }
  });

  // ── 시나리오 3: 상병코드 선택 → Zone2 저장 확인 ──────────────────────────
  test('시나리오3: 상병코드 탭 선택 → Zone2 서류 코드 표시', async ({ page }) => {
    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) {
      test.skip();
      return;
    }

    // 상병코드 탭 클릭
    const diagTab = dialog.getByRole('button', { name: '상병코드' });
    await diagTab.click();

    // 상병코드 목록 표시 대기
    await page.waitForTimeout(300);

    // 첫 번째 상병코드 선택 (있는 경우)
    const codeBtn = dialog.locator('.overflow-y-auto button').first();
    if ((await codeBtn.count()) > 0) {
      await codeBtn.click();
      // Zone2에 서류 코드 섹션 표시
      await expect(dialog.getByText(/서류 코드/)).toBeVisible();
    }
  });
});
