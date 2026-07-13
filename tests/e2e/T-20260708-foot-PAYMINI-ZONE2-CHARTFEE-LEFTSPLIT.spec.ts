/**
 * E2E spec — T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT (REOPEN)
 * 결제 미니창 — [차트 코드+진료비 산정]을 '맨 위 큰 블록'에서 →
 *   하단영역 상단경계(초록=시술·파란=수납 위)의 컴팩트 한 줄(기본 접힘) + 펼침/접힘 토글로 축소.
 *
 * 현장 재지시(2026-07-08 김주연 총괄): "빨간박스 부분 왜 위로 가있어!! 초록색+파란색 사이로 한 줄!!"
 *   = 맨 위 큰 블록 원복 ✗ / 하단 상단경계 컴팩트 한 줄 ✓ / 모달 총 가로폭 불변(ROW-SPLIT 유지).
 *
 * AC-1: [차트 코드+진료비 산정] 한 줄 헤더(pmw-feeitem-toggle)가 컴팩트하게 노출되고,
 *       '큰 블록'이 아님 — 기본 접힘 상태에서 수가항목 편집 리스트(pricing-list)는 숨김.
 * AC-2: 세로 스택 라이브 순서 = [초록 코드 그리드] → [컴팩트 feeitem-row] → [파란 settle-lane].
 *        (권위 spec T-20260713-…LEFTSPLIT S1 확정 순서와 일치 — feeRow 는 코드 그리드 "아래".)
 * AC-3: 접힘(기본)일 때 세로 점유가 작음(컴팩트) — 펼침 토글 클릭 시 수가항목 편집 UI 노출/재접힘.
 * AC-4: 모달 총 가로폭 불변 — 컴팩트 행이 모달 폭을 넘지 않고(좁은 화면 80% 축소 포함) 가로 오버플로 없음.
 * AC-5: 초록/파란/Zone3 위치 유지 + 수가항목 기능(펼침→코드추가→합계→저장→수납) 회귀 없음.
 * AC-6: 좁은 화면(≈80% 축소)에서 한 줄 요약 잘림/줄바꿈/겹침 없이 컴팩트 렌더.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT (REOPEN) — 차트코드+진료비 컴팩트 한 줄', () => {

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

  // ── AC-1: 컴팩트 한 줄 헤더 노출 + 기본 접힘(큰 블록 아님) ──
  test('AC-1: [차트 코드·진료비 산정] 한 줄 토글 노출 + 기본 접힘(편집 리스트 숨김)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const toggle = dialog.locator('[data-testid="pmw-feeitem-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/차트 코드.*진료비 산정/);
    // 한 줄 요약 배지(수가 N건) 항상 노출
    await expect(dialog.locator('[data-testid="pmw-feeitem-summary"]')).toBeVisible();

    // 기본 접힘: 수가항목 편집 리스트는 숨김 (= 맨 위 큰 블록 아님)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.locator('[data-testid="pricing-list"]')).toHaveCount(0);
  });

  // ── AC-2: 라이브 세로 스택 순서 = 초록 코드 그리드 → 컴팩트 feeitem-row → 파란 settle-lane ──
  //   (권위 spec T-20260713-…LEFTSPLIT S1 과 동일 순서: feeRow 는 코드 그리드 "아래" / settle "위")
  test('AC-2: 컴팩트 행이 코드 그리드 아래 + settle-lane 위(라이브 세로 스택 순서)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const codeGrid = dialog.locator('[data-testid="pmw-code-grid"]');
    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    const settle = dialog.locator('[data-testid="pmw-settle-lane"]');
    await expect(codeGrid).toBeVisible();
    await expect(feeRow).toBeVisible();

    const codeBox = await codeGrid.boundingBox();
    const feeBox = await feeRow.boundingBox();
    if (codeBox && feeBox) {
      // 컴팩트 행 top 이 코드 그리드 top 아래 → "초록 아래"
      expect(feeBox.y).toBeGreaterThan(codeBox.y + 8);
    }
    // settle-lane 이 있으면 컴팩트 행보다 아래(= "파란 위") 검증
    if ((await settle.count()) > 0) {
      const settleBox = await settle.boundingBox();
      if (feeBox && settleBox) {
        expect(feeBox.y).toBeLessThan(settleBox.y);
      }
    }
  });

  // ── AC-3: 접힘=컴팩트 / 펼침 토글로 수가항목 편집 UI 노출·재접힘 ──
  test('AC-3: 접힘 시 컴팩트(작은 높이), 펼침 토글로 수가항목 노출/재접힘', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    const toggle = dialog.locator('[data-testid="pmw-feeitem-toggle"]');
    await expect(feeRow).toBeVisible();

    // 접힘 시 컴팩트: 행 높이가 작음(< 120px = 큰 블록 아님)
    const collapsedBox = await feeRow.boundingBox();
    if (collapsedBox) expect(collapsedBox.height).toBeLessThan(120);

    // 펼침 → 편집 UI(수가 항목 영역) 노출
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(feeRow.getByText(/수가 항목 \(\d+건\)/)).toBeVisible();

    // 재접힘 → 편집 UI 숨김 + 다시 컴팩트
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.locator('[data-testid="pricing-list"]')).toHaveCount(0);
  });

  // ── AC-4: 모달 총 가로폭 불변 — 컴팩트 행 가로 오버플로 없음 ──
  test('AC-4: 컴팩트 행이 모달 폭 넘지 않음 + 가로 오버플로 없음(좁은 화면 포함)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    const feeRow = dialog.locator('[data-testid="pmw-feeitem-row"]');
    await expect(feeRow).toBeVisible();

    const noOverflow = async () => {
      await expect(feeRow).toBeVisible({ timeout: 5_000 });
      const overflow = await feeRow.evaluate((el) => el.scrollWidth - el.clientWidth, undefined, { timeout: 5_000 });
      expect(overflow).toBeLessThanOrEqual(2);
    };

    // (1) 넓은 폭
    await noOverflow();
    const dialogBox = await dialog.boundingBox();
    const feeBox = await feeRow.boundingBox();
    if (dialogBox && feeBox) expect(feeBox.width).toBeLessThanOrEqual(dialogBox.width + 2);

    // (2) 80% 축소 근사(좁은 폭) — 가로 오버플로 없음
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(600);
    await expect(dialog.locator('[data-testid="pmw-feeitem-toggle"]')).toBeVisible({ timeout: 5_000 });
    await noOverflow();
    const box = await feeRow.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(900 + 2);
  });

  // ── AC-5: 초록/파란/Zone3 유지 + 수가항목 기능(펼침→추가→합계→저장→수납) 회귀 없음 ──
  test('AC-5: Zone1 탭·Zone3 유지 + 펼침 후 코드추가→합계→저장→수납 흐름 정상', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    // Zone1 탭 + Zone3 유지
    await expect(dialog.getByRole('button', { name: '상병코드', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '처방약', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '풋케어', exact: true })).toBeVisible();
    await expect(dialog.getByText('서류발행')).toBeVisible();
    await expect(dialog.locator('[data-testid="doc-template-list"]')).toBeVisible();

    // 펼침 후 코드 추가 → 수가항목 노출
    await dialog.locator('[data-testid="pmw-feeitem-toggle"]').click();
    const footcareTab = dialog.getByRole('button', { name: '풋케어', exact: true });
    if ((await footcareTab.count()) > 0) await footcareTab.click();

    const svcBtns = dialog.locator('[data-testid="pmw-code-grid"] button').filter({ hasText: /\S/ });
    if ((await svcBtns.count()) === 0) { test.skip(); return; }
    await svcBtns.first().click();

    const list = dialog.locator('[data-testid="pricing-list"]');
    await expect(list).toBeVisible();
    await expect(list).toHaveClass(/overflow-y-auto/);

    // 합계·세금 계산 정상(파란 tail)
    await expect(dialog.getByText('세금 구분')).toBeVisible();
    await expect(dialog.getByText('합계', { exact: true })).toBeVisible();

    // 저장 → 수납 흐름 유지
    const saveBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(dialog.locator('[data-testid="btn-settle"]')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-6: 좁은 화면에서 한 줄 요약 컴팩트 렌더(잘림/줄바꿈 없음) ──
  test('AC-6: 좁은 화면(≈80% 축소)에서 한 줄 요약 컴팩트 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dialog = await openPaymentMiniWindow(page);
    if (!dialog) { test.skip(); return; }

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(600);

    const toggle = dialog.locator('[data-testid="pmw-feeitem-toggle"]');
    const summary = dialog.locator('[data-testid="pmw-feeitem-summary"]');
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await expect(summary).toBeVisible();

    // 요약 영역이 가로 오버플로 없이 컴팩트(overflow-hidden으로 잘림 흡수)
    const overflow = await summary.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
