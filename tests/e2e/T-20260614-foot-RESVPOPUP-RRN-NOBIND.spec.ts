/**
 * E2E spec — T-20260614-foot-RESVPOPUP-RRN-NOBIND
 * [예약관리] 예약상세 팝업 1번구역 '주민번호' 연동 누락 보정 (마스킹 표시 미바인딩 버그)
 *
 * 배경: 1번구역(환자 정보) 주민번호가 비어있기 쉬운 customers.birth_date 컬럼에만 바인딩 →
 *       '칸은 있는데 비어있음'. 보정: 기존 fn_customer_birthdates RPC(서버 rrn 복호 → 생년월일만)
 *       재사용 + 성별로 마스킹 표기(YYMMDD-G******) 구성. 평문 rrn 미수신.
 *
 * AC-1: 주민번호 라벨 옆에 마스킹 값(예 880101-1******) 또는 placeholder('—') 표시. 깨짐 없음.
 * AC-2: 미보유 고객은 '—' placeholder, 에러/크래시 없음.
 * AC-3(PHI): 평문 주민번호(YYMMDD-뒷자리7) 화면 미노출 — 뒷자리 6은 항상 마스킹.
 *
 * 팝업은 기존 예약 클릭으로만 열림(데이터 의존) → 예약 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openFirstReservationPopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const popupZone1 = page.getByTestId('popup-zone1-customer');
  const candidates = page.locator('[data-testid^="resv-card"], [data-resv-id]');
  const count = await candidates.count().catch(() => 0);
  if (count === 0) return false;
  for (let i = 0; i < Math.min(count, 5); i++) {
    await candidates.nth(i).click().catch(() => {});
    if (await popupZone1.isVisible().catch(() => false)) return true;
  }
  return popupZone1.isVisible().catch(() => false);
}

test.describe('T-20260614-foot-RESVPOPUP-RRN-NOBIND — 예약상세 주민번호 마스킹 표시', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC-1 / AC-2: 주민번호 라벨 + 값(마스킹 or placeholder), 깨짐 없음
  test('AC-1: 1번구역 주민번호 라벨 + 마스킹/placeholder 값 표시', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const zone1 = page.getByTestId('popup-zone1-customer');
    await expect(zone1.getByText('주민번호', { exact: true })).toBeVisible({ timeout: 5_000 });

    const zoneText = (await zone1.textContent()) ?? '';
    // 마스킹 표기(YYMMDD-G****** : 성별자리 숫자/별표 + 별표6) 또는 placeholder('—') 중 하나
    const masked = /\d{6}-[0-9*]\*{6}/;
    const hasMaskedOrPlaceholder = masked.test(zoneText) || zoneText.includes('—');
    expect(hasMaskedOrPlaceholder).toBeTruthy();
    console.log('[AC-1] 주민번호 라벨 + 마스킹/placeholder 표시 OK');
  });

  // AC-3 (PHI): 평문 주민번호 뒷자리 전체(7자리)가 화면에 노출되지 않음
  test('AC-3(PHI): 평문 주민번호 뒷자리 미노출 — 마스킹 강제', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const dialogText = (await page.getByRole('dialog').first().textContent()) ?? '';
    // YYMMDD-1234567 형태(하이픈 뒤 7자리 전부 숫자) = 평문 RRN → 절대 금지
    const plainRrn = /\d{6}-\d{7}/;
    expect(dialogText).not.toMatch(plainRrn);
    // 13자리 연속 숫자(하이픈 없는 평문 RRN)도 금지
    expect(dialogText).not.toMatch(/(?<!\d)\d{13}(?!\d)/);
    console.log('[AC-3] 평문 주민번호 뒷자리 미노출 OK');
  });
});
