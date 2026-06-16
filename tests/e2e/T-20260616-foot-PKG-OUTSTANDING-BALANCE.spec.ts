/**
 * E2E spec — T-20260616-foot-PKG-OUTSTANDING-BALANCE
 * 패키지 미수금(잔금) 표기 (옵션 A 확정: 화면 표기만, auto-SMS 아님)
 *
 * 본 spec 범위 = Stage A (기존 스키마 기반, consultation_fee 마이그 비의존):
 *   AC-1: 패키지 목록에 '잔금' 컬럼이 노출된다(전체−납부, 0이면 '—').
 *   AC-2: 패키지 상세 시트에 '미수금 (패키지 잔금)' 박스 + 상태 뱃지(미수/완납/과수)가 노출된다.
 *   AC-3: 잔금은 합산 단일 '총금액'이 아니라 패키지 금액과 별도 파생값으로 표기된다(§4-A).
 *
 * Deferred (별도 stage, 마이그 적용+필드테스트 후): 진료비 금액 분리 생성폼,
 *   대기열/예약 잔금 뱃지, 체크인 미납 팝업, 결제 다이얼로그 잔금 프리필.
 *
 * 데이터 의존 단언은 활성 패키지가 있을 때만 수행하고, 없으면 skip(현장 데이터 비의존 CI 안전).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260616 PKG-OUTSTANDING-BALANCE — 패키지 미수금(잔금) 표기', () => {
  async function gotoPackages(page: import('@playwright/test').Page): Promise<boolean> {
    const loaded = await loginAndWaitForDashboard(page);
    if (!loaded) return false;
    const link = page.getByRole('link', { name: '패키지' }).first();
    if (!(await link.isVisible().catch(() => false))) return false;
    await link.click();
    await page.waitForURL('**/admin/packages', { timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '활성' })).toBeVisible({ timeout: 5_000 });
    return true;
  }

  test('AC-1: 패키지 목록에 잔금 컬럼 헤더가 노출된다', async ({ page }) => {
    if (!(await gotoPackages(page))) { test.skip(true, '패키지 페이지 접근 불가(권한/로딩)'); return; }
    // 컬럼 헤더: 금액 + 잔금 모두 존재 (잔금은 신규 컬럼)
    await expect(page.getByRole('columnheader', { name: '잔금' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('columnheader', { name: '금액' })).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/pkg-outstanding-list.png', fullPage: true });
  });

  test('AC-2/3: 상세 시트에 미수금 박스 + 상태 뱃지가 노출되고 합산 총금액이 아니다', async ({ page }) => {
    if (!(await gotoPackages(page))) { test.skip(true, '패키지 페이지 접근 불가(권한/로딩)'); return; }

    // 전체 탭으로 — 데이터가 있을 가능성 최대화
    await page.getByRole('tab', { name: '전체' }).click();
    const firstRow = page.locator('tbody tr').first();
    if ((await firstRow.count()) === 0) { test.skip(true, '패키지 데이터 없음(CI 시드 미존재)'); return; }

    await firstRow.click();
    // 상세 시트(미수금 박스) 확인
    await expect(page.getByText('미수금 (패키지 잔금)')).toBeVisible({ timeout: 5_000 });
    // 상태 뱃지 중 하나는 반드시 노출 (미수/완납/과수)
    const statusBadge = page.getByText(/^(미수|완납|과수)$/);
    await expect(statusBadge.first()).toBeVisible();
    // 패키지 금액과 별도 라벨 — '총 계약금'(패키지 금액)과 '미수금'이 동시에 별도 표기됨(합산 단일표기 아님)
    await expect(page.getByText('총 계약금')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/pkg-outstanding-detail.png', fullPage: true });
  });
});
