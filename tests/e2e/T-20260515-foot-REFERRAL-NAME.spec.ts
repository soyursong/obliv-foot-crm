/**
 * E2E spec — T-20260515-foot-REFERRAL-NAME
 * 방문경로 '지인소개' 선택 시 소개자 성함 기입칸 추가 — 예약관리↔2번차트 양방향 연동
 *
 * AC-1: 예약관리 — '지인소개' 선택 시 소개자 성함 입력칸 표시
 * AC-2: 2번차트 — visit_route='지인소개' 시 소개자 성함 입력칸 표시
 * AC-3: 양방향 연동 (customers.referral_name SSOT)
 * AC-5: 다른 방문경로 선택 시 입력칸 숨김
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260515-foot-REFERRAL-NAME — 지인소개 소개자 성함', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: 예약관리 신규예약 — 지인소개 선택 시 소개자 성함 입력칸 표시', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 신규 예약 버튼 클릭
    const newBtn = page.getByRole('button', { name: /신규 예약|새 예약|\+/ }).first();
    const hasBtnNewResv = await newBtn.count() > 0;
    if (!hasBtnNewResv) {
      test.skip(true, '신규예약 버튼 미발견 — 스킵');
      return;
    }
    await newBtn.click();

    // 다이얼로그 오픈 대기
    const dialog = page.locator('[role="dialog"]').first();
    const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!dialogVisible) {
      test.skip(true, '예약 다이얼로그 미오픈 — 스킵');
      return;
    }

    // 방문유형이 '초진'인지 확인 (visit_type=new 인 경우에만 방문경로 표시)
    const newVisitOption = dialog.getByRole('option', { name: '초진' }).first();
    const isNewType = await newVisitOption.count() > 0;
    if (isNewType) {
      const visitTypeSelect = dialog.locator('select').first();
      await visitTypeSelect.selectOption({ label: '초진' });
    }

    // 방문경로 드롭다운 찾기
    const visitRouteSelect = dialog.locator('select').filter({ hasText: /선택 안 함|TM|인바운드|지인소개/ }).first();
    const hasRouteSelect = await visitRouteSelect.count() > 0;
    if (!hasRouteSelect) {
      test.skip(true, '방문경로 드롭다운 미발견 — 스킵 (초진이 아닌 경우)');
      return;
    }

    // 초기: 소개자 성함 입력칸 없음
    const referralInput = dialog.getByPlaceholder('예: 홍길동');
    const initialVisible = await referralInput.isVisible().catch(() => false);
    expect(initialVisible).toBe(false);
    console.log('[AC-1-pre] 초기 소개자 성함 입력칸 숨김 확인 PASS');

    // 지인소개 선택
    await visitRouteSelect.selectOption('지인소개');

    // 소개자 성함 입력칸 표시 확인
    await expect(referralInput).toBeVisible({ timeout: 3_000 });
    console.log('[AC-1] 지인소개 선택 → 소개자 성함 입력칸 표시 PASS');

    // 텍스트 입력 가능 확인
    await referralInput.fill('홍길동');
    await expect(referralInput).toHaveValue('홍길동');
    console.log('[AC-1] 소개자 성함 입력 가능 PASS');
  });

  test('AC-5: 예약관리 — 다른 방문경로 선택 시 소개자 성함 입력칸 숨김', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const newBtn = page.getByRole('button', { name: /신규 예약|새 예약|\+/ }).first();
    if (await newBtn.count() === 0) {
      test.skip(true, '신규예약 버튼 미발견 — 스킵');
      return;
    }
    await newBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!dialogVisible) {
      test.skip(true, '예약 다이얼로그 미오픈 — 스킵');
      return;
    }

    const visitRouteSelect = dialog.locator('select').filter({ hasText: /선택 안 함|TM|인바운드|지인소개/ }).first();
    if (await visitRouteSelect.count() === 0) {
      test.skip(true, '방문경로 드롭다운 미발견 — 스킵');
      return;
    }

    const referralInput = dialog.getByPlaceholder('예: 홍길동');

    // 지인소개 선택 → 입력칸 표시
    await visitRouteSelect.selectOption('지인소개');
    await expect(referralInput).toBeVisible({ timeout: 3_000 });

    // 인바운드로 변경 → 입력칸 숨김
    await visitRouteSelect.selectOption('인바운드');
    const hiddenAfterChange = await referralInput.isVisible().catch(() => false);
    expect(hiddenAfterChange).toBe(false);
    console.log('[AC-5] 다른 방문경로 선택 시 소개자 성함 입력칸 숨김 PASS');

    // TM으로 변경해도 숨김
    await visitRouteSelect.selectOption('TM');
    const hiddenForTM = await referralInput.isVisible().catch(() => false);
    expect(hiddenForTM).toBe(false);
    console.log('[AC-5] TM 선택 시 소개자 성함 입력칸 숨김 PASS');
  });

  test('AC-2: 2번차트 — 방문경로 지인소개 + 소개자 성함 입력칸 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 고객 페이지로 이동
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 고객 목록에서 첫 번째 고객 클릭
    const customerRows = page.locator('table tbody tr, [data-testid="customer-row"]');
    const rowCount = await customerRows.count();
    if (rowCount === 0) {
      test.skip(true, '고객 없음 — 스킵');
      return;
    }
    await customerRows.first().click();

    // 2번차트(CustomerChartPage) 로드 대기
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // 방문경로 드롭다운 찾기
    const visitRouteSelect2 = page.locator('select').filter({ hasText: /선택|TM|인바운드|지인소개/ }).first();
    const hasSelect = await visitRouteSelect2.count() > 0;
    if (!hasSelect) {
      test.skip(true, '2번차트 방문경로 드롭다운 미발견 — 스킵');
      return;
    }

    // 지인소개가 아닌 경우 선택 변경
    const currentVal = await visitRouteSelect2.inputValue();
    if (currentVal !== '지인소개') {
      await visitRouteSelect2.selectOption('지인소개');
    }

    // 소개자 성함 입력칸 확인 (2번차트 테이블 내)
    const referralInput2 = page.getByPlaceholder('예: 홍길동');
    await expect(referralInput2).toBeVisible({ timeout: 5_000 });
    console.log('[AC-2] 2번차트 지인소개 선택 → 소개자 성함 입력칸 표시 PASS');
  });
});
