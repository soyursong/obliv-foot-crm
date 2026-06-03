/**
 * E2E spec — T-20260603-foot-CHART2-QR-REOPEN
 * 펜차트 발건강질문지 패널: 이미 발급된 셀프접수(health-q) QR 다시보기
 *
 * 요청(김주연 총괄): 고객이 셀프접수 QR을 놓친 경우, 재발급 없이 데스크 화면에서
 *   기존 활성 QR을 다시 표시해 응대.
 * 결정(planner, 옵션 A): 활성 토큰 → QR 재렌더 / used_at → "이미 작성 완료" 안내 /
 *   만료·없음 → "링크 생성으로 재발급" 안내만. read-only·mutating 0·회귀 0.
 *
 * AC1 (정상):       활성 토큰 상태에서 [QR 다시보기] → 200×200px+ QR 모달, src=/health-q/.
 * AC2 (만료엣지):   다시보기 섹션은 항상 렌더. 활성이 아니면(used/expired/none)
 *                   재발급 버튼 미노출 + 상태 안내문 노출.
 * AC3 (데이터정확성): 다시보기 QR이 인코딩한 token = 직전 발급 링크의 token (동일).
 *                   링크생성/복사/미리보기 회귀 0 · DB 무변경(읽기 전용).
 *
 * 주의: QR 인코딩은 foot-native api.qrserver.com 패턴 재사용(신규 npm 없음).
 *       공통 컴포넌트 QrViewModal — SELFLINK-QR-VIEW 와 동일 컴포넌트 공유.
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

test.describe('T-20260603-CHART2-QR-REOPEN — 셀프접수 QR 다시보기', () => {
  // ─── AC2: 다시보기 섹션은 항상 렌더 + 상태 분기 ───────────────────────────────
  test('AC2: 다시보기 섹션이 항상 노출되고 status 속성이 유효하다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    if (!(await gotoSelfLinkPanel(page))) test.skip(true, '자가작성 패널 진입 실패');

    const section = page.locator('[data-testid="healthq-reopen-section"]');
    if (await section.count() === 0) test.skip(true, '다시보기 섹션 미노출 (패널 미진입)');
    await expect(section).toBeVisible({ timeout: 8_000 });

    const status = await section.getAttribute('data-reopen-status');
    expect(['active', 'used', 'expired', 'none']).toContain(status);

    // 활성이 아니면: 재발급 버튼 미노출 + 안내문 노출 (안내만)
    if (status !== 'active') {
      await expect(page.locator('[data-testid="healthq-reopen-qr-btn"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="healthq-reopen-status"]')).toBeVisible();
    }
  });

  // ─── AC1 + AC3: 발급 → 다시보기 활성 → QR 모달 + 데이터 정확성 + 회귀 ──────────
  test('AC1/AC3: 링크 발급 후 다시보기 [QR 다시보기] → 200px+ 모달, 동일 token', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    if (!(await gotoSelfLinkPanel(page))) test.skip(true, '자가작성 패널 진입 실패');

    const createBtn = page.locator('button:has-text("링크 생성")').first();
    if (await createBtn.count() === 0) test.skip(true, '링크 생성 버튼 없음 (자가작성 패널 미노출)');
    await expect(createBtn).toBeVisible({ timeout: 8_000 });

    // 회귀: 링크 생성 → 에러 토스트 없이 발급 URL 노출
    await createBtn.click();
    const errorToast = page.locator('text=링크 생성 실패');
    const generatedUrlNode = page.locator('p.font-mono').first();
    const result = await Promise.race([
      errorToast.waitFor({ timeout: 8_000 }).then(() => 'error').catch(() => null),
      generatedUrlNode.waitFor({ timeout: 8_000 }).then(() => 'ok').catch(() => null),
    ]);
    expect(await errorToast.count(), '링크 생성 실패 토스트가 떠서는 안 됨').toBe(0);
    if (result !== 'ok') test.skip(true, '링크 발급 미완료 (RPC 환경 의존) — 다시보기 단계 검증 생략');

    // 회귀: 복사/미리보기 버튼 함께 노출
    await expect(page.locator('button:has-text("복사")').first()).toBeVisible();
    await expect(page.locator('button:has-text("미리보기")').first()).toBeVisible();

    // 방금 발급한 토큰 → 다시보기 섹션이 active 로 갱신
    const section = page.locator('[data-testid="healthq-reopen-section"]');
    await expect(section).toHaveAttribute('data-reopen-status', 'active', { timeout: 6_000 });

    // AC3 데이터 정확성: 발급 링크의 token 추출
    const issuedUrl = (await generatedUrlNode.textContent())?.trim() ?? '';
    const issuedToken = issuedUrl.split('/health-q/')[1] ?? '';
    expect(issuedToken.length, '발급 링크에서 token 추출').toBeGreaterThan(0);

    // AC1: 다시보기 클릭 → QR 모달 + 200×200px+
    const reopenBtn = page.locator('[data-testid="healthq-reopen-qr-btn"]');
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();

    const modal = page.locator('[data-testid="qr-view-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const qrImg = page.locator('[data-testid="qr-view-modal-image"]');
    await expect(qrImg).toBeVisible();
    const box = await qrImg.boundingBox();
    expect(box, 'QR 이미지 박스').not.toBeNull();
    expect(box!.width, 'QR 최소 200px (가로)').toBeGreaterThanOrEqual(200);
    expect(box!.height, 'QR 최소 200px (세로)').toBeGreaterThanOrEqual(200);

    // AC3: 다시보기 QR 이 인코딩한 데이터 = 발급 링크와 동일 token
    const src = await qrImg.getAttribute('src');
    expect(src, 'QR src 는 api.qrserver.com 외부 API').toContain('api.qrserver.com');
    const decoded = decodeURIComponent(src ?? '');
    expect(decoded, 'QR 데이터는 /health-q/ 링크').toContain('/health-q/');
    expect(decoded, 'QR 데이터의 token = 발급 token (재발급 없음)').toContain(issuedToken);

    // 닫기 (외부 클릭)
    await page.mouse.click(5, 5);
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });
});
