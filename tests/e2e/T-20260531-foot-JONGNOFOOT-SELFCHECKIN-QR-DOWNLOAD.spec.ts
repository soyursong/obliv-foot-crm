/**
 * E2E spec — T-20260531-foot-JONGNOFOOT-SELFCHECKIN-QR-DOWNLOAD
 * 풋 admin 셀프접수 QR 다운로드 섹션 (⑦) — NORMAL-SETUP RV-4 잔여 갭
 *
 * AC-1: foot admin(AdminSettings)에 "셀프접수 QR 다운로드" 섹션 노출(admin/manager 한정)
 * AC-2: 섹션에서 종로 풋 셀프접수 URL을 가리키는 QR 발급 + 다운로드(이미지/포스터) 동작
 * AC-3: 다운로드된 QR 스캔 시 foot 셀프접수 화면(obliv-foot-crm 도메인)으로 진입(HFQ URL 아님)
 * AC-4: 런타임 HFQ 코드/DB 참조 0 — footCrmClient 미신설 (정적 검증은 supervisor 코드리뷰)
 *
 * foot-native: clinic.slug(jongno-foot) + 기존 api.qrserver.com QR 패턴 재사용. 신규 npm 0.
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ---------------------------------------------------------------------------
// AC-1: ⑦ 셀프접수 QR 다운로드 섹션 노출
// ---------------------------------------------------------------------------
test('AC-1: admin이 ⑦ 셀프접수 QR 다운로드 섹션에 진입 가능', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto('/admin/settings');
  await page.waitForTimeout(500);

  // 좌측 네비에서 ⑦ 섹션 버튼 클릭
  const qrNavBtn = page
    .locator('button:has-text("셀프접수 QR 다운로드"), button:has-text("⑦")')
    .first();
  await expect(qrNavBtn).toBeVisible({ timeout: 8_000 });
  await qrNavBtn.click();

  // 섹션 콘텐츠 렌더 확인
  await expect(page.locator('[data-testid="selfcheckin-qr-section"]'))
    .toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// AC-2 / AC-3: QR 발급 + 다운로드 버튼 노출 + URL이 foot 셀프접수 도메인
// ---------------------------------------------------------------------------
test('AC-2/AC-3: QR 프리뷰 + 다운로드 버튼 + foot 셀프접수 URL 렌더', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto('/admin/settings');
  await page.waitForTimeout(500);

  const qrNavBtn = page
    .locator('button:has-text("셀프접수 QR 다운로드"), button:has-text("⑦")')
    .first();
  await qrNavBtn.click();
  await expect(page.locator('[data-testid="selfcheckin-qr-section"]'))
    .toBeVisible({ timeout: 8_000 });

  // QR 프리뷰 이미지 노출
  await expect(page.locator('[data-testid="selfcheckin-qr-preview"]'))
    .toBeVisible({ timeout: 8_000 });

  // 다운로드 버튼 2종 노출
  await expect(page.locator('[data-testid="selfcheckin-qr-download-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="selfcheckin-poster-download-btn"]')).toBeVisible();

  // AC-3: 표시된 URL이 foot 셀프접수(/checkin/) 도메인이며 HFQ 도메인이 아님
  const urlText = await page.locator('[data-testid="selfcheckin-qr-url"]').innerText();
  expect(urlText).toContain('/checkin/');
  // happy-flow-queue(HFQ) 도메인 문자열이 포함되면 안 됨
  expect(urlText.toLowerCase()).not.toContain('happy-flow-queue');
});

// ---------------------------------------------------------------------------
// AC-2: QR PNG 다운로드 트리거 동작 (download 이벤트 수신)
// ---------------------------------------------------------------------------
test('AC-2: [QR 이미지 다운로드] 클릭 시 파일 다운로드 발생', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto('/admin/settings');
  await page.waitForTimeout(500);

  const qrNavBtn = page
    .locator('button:has-text("셀프접수 QR 다운로드"), button:has-text("⑦")')
    .first();
  await qrNavBtn.click();
  await expect(page.locator('[data-testid="selfcheckin-qr-section"]'))
    .toBeVisible({ timeout: 8_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.locator('[data-testid="selfcheckin-qr-download-btn"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/셀프접수QR.*\.png/);
});
