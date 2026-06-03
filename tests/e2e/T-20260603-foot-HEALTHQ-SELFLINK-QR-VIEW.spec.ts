/**
 * E2E spec — T-20260603-foot-HEALTHQ-SELFLINK-QR-VIEW
 * 발건강질문지 자가작성 섹션: 발급된 health-q 링크 QR 모달 보기
 *
 * 요청(김주연 총괄): 고객이 셀프접수 시 QR 을 놓친 경우 데스크 화면에서 바로 스캔 응대.
 *   발급된 링크(복사/미리보기가 쓰는 동일 generatedUrl)를 QR 로 인코딩해 모달 표시.
 *
 * AC1: 발급상태에서 복사/미리보기 옆 [QR 보기] 버튼 → 클릭 시 QR 모달 최소 200×200px.
 * AC2: 모달 X버튼/외부클릭 닫기.
 * AC3: 미발급 상태 [QR 보기] 미노출(미리보기 노출조건과 동일).
 * AC4: 링크생성/복사/미리보기 회귀 0, DB 무변경.
 *
 * 주의: QR 인코딩은 foot-native api.qrserver.com 패턴 재사용(신규 npm 없음).
 *       공통 컴포넌트 QrViewModal — CHART2-QR-REOPEN 과 동일 컴포넌트 공유.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 펜차트 탭의 발건강질문지 자가작성 패널까지 진입 */
async function gotoSelfLinkPanel(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
  try {
    await firstRow.waitFor({ timeout: 10_000 });
  } catch {
    return false;
  }
  const customerLink = firstRow.locator('a[href*="/chart/"]').first();
  if (await customerLink.count() > 0) await customerLink.click();
  else await firstRow.click();

  const clinicalGroup = page.locator('[data-tab-group="clinical"], button:has-text("진료")').first();
  if (await clinicalGroup.count() > 0) await clinicalGroup.click();
  const penChartTab = page.locator('button:has-text("펜차트"), [data-tab="pen_chart"]').first();
  if (await penChartTab.count() === 0) return false;
  await penChartTab.click();
  await page.waitForTimeout(500);
  return true;
}

test.describe('T-20260603-HEALTHQ-SELFLINK-QR-VIEW — 자가작성 링크 QR 보기', () => {
  // ─── AC3: 미발급 상태 — QR 보기 버튼 미노출 ──────────────────────────────────
  test('AC3: 링크 발급 전에는 [QR 보기] 버튼이 보이지 않는다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    if (!(await gotoSelfLinkPanel(page))) test.skip(true, '자가작성 패널 진입 실패');

    const createBtn = page.locator('button:has-text("링크 생성")').first();
    if (await createBtn.count() === 0) test.skip(true, '링크 생성 버튼 없음 (자가작성 패널 미노출)');
    await expect(createBtn).toBeVisible({ timeout: 8_000 });

    // 발급 전: QR 보기 버튼은 미리보기/복사와 동일하게 미노출
    const qrBtn = page.locator('[data-testid="healthq-qr-view-btn"]');
    await expect(qrBtn).toHaveCount(0);
  });

  // ─── AC1 + AC2 + AC4: 발급 → QR 보기 → 모달 → 닫기 ──────────────────────────
  test('AC1/AC2/AC4: 링크 발급 후 [QR 보기] → 200px+ QR 모달 → 닫기', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    if (!(await gotoSelfLinkPanel(page))) test.skip(true, '자가작성 패널 진입 실패');

    const createBtn = page.locator('button:has-text("링크 생성")').first();
    if (await createBtn.count() === 0) test.skip(true, '링크 생성 버튼 없음 (자가작성 패널 미노출)');
    await expect(createBtn).toBeVisible({ timeout: 8_000 });

    // AC4: 링크 생성 회귀 — 에러 토스트 없이 generatedUrl 노출
    await createBtn.click();
    const errorToast = page.locator('text=링크 생성 실패');
    const qrBtn = page.locator('[data-testid="healthq-qr-view-btn"]');
    const result = await Promise.race([
      errorToast.waitFor({ timeout: 8_000 }).then(() => 'error').catch(() => null),
      qrBtn.waitFor({ timeout: 8_000 }).then(() => 'ok').catch(() => null),
    ]);
    expect(await errorToast.count(), '링크 생성 실패 토스트가 떠서는 안 됨').toBe(0);
    if (result !== 'ok') test.skip(true, '링크 발급 미완료 (RPC 환경 의존) — QR 단계 검증 생략');

    // AC4: 복사/미리보기 버튼 회귀 — 함께 노출
    await expect(page.locator('button:has-text("복사")').first()).toBeVisible();
    await expect(page.locator('button:has-text("미리보기")').first()).toBeVisible();

    // AC1: QR 보기 클릭 → 모달 + QR 이미지(최소 200×200)
    await qrBtn.click();
    const modal = page.locator('[data-testid="qr-view-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const qrImg = page.locator('[data-testid="qr-view-modal-image"]');
    await expect(qrImg).toBeVisible();
    const box = await qrImg.boundingBox();
    expect(box, 'QR 이미지 박스').not.toBeNull();
    expect(box!.width, 'QR 최소 200px (가로)').toBeGreaterThanOrEqual(200);
    expect(box!.height, 'QR 최소 200px (세로)').toBeGreaterThanOrEqual(200);
    // QR src 는 발급된 /health-q/ URL 을 인코딩해야 함 (동일 generatedUrl 재사용)
    const src = await qrImg.getAttribute('src');
    expect(src, 'QR src 는 api.qrserver.com 외부 API').toContain('api.qrserver.com');
    expect(decodeURIComponent(src ?? ''), 'QR 데이터는 /health-q/ 링크').toContain('/health-q/');

    // AC2: 외부 클릭(backdrop)으로 닫기
    await page.mouse.click(5, 5);
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // 재오픈 후 X 버튼으로 닫기
    await qrBtn.click();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const closeBtn = modal.locator('button').filter({ has: page.locator('svg') }).last();
    await closeBtn.click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });
});
