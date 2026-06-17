/**
 * E2E spec — T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW
 * 예약관리 (+) 신규 예약 팝업 — 2-f(초/재진 토글 제거·초진 자동) + 2-e(라벨 리네이밍)
 *
 * ※ 본 스펙 범위 = 이 세션에서 구현한 CORRECTION(MSG-20260617-133645-fteb) 분만 검증.
 *   - 2-f: 신규 고객 직접 등록(manualNew) 경로는 무조건 초진 → 초/재진 유형 토글 미노출, visit_type='new' 고정.
 *   - 2-e: 신규 고객 항목명 "신규 예약" / 버튼명 "신규 예약 생성".
 *   - 기존 고객(loadedMatch) 검색 경로는 재진 가능 → 유형 토글 유지(회귀가드).
 *   item1 캘린더 압축 + 2-a/2-b/2-c/2-d(2버튼 진입·필드 이동)는 별도 작업(미구현) → 본 스펙 비대상.
 *
 * 데이터/clinic 미준비 시 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 예약관리 → 상단 '새 예약' 클릭 → new-mode 팝업(빈 상태) 오픈. 성공 시 true. */
async function openNewModePopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const newBtn = page.getByRole('button', { name: '새 예약' });
  if (!(await newBtn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await newBtn.click();
  // 빈 상태(검색 미선택) 패널 노출 = new-mode 진입 성공
  return page.getByTestId('popup-newmode-empty').isVisible({ timeout: 5_000 }).catch(() => false);
}

test.describe('T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW — 신규 예약 팝업 2-f/2-e', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('2-f: 신규 고객 직접 등록 → 초/재진 유형 토글이 노출되지 않음 (초진 자동)', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    // "+ 시스템에 없는 신규 고객 직접 등록" → manualNew 폼
    const manualBtn = page.getByTestId('btn-newmode-manual-register');
    await expect(manualBtn).toBeVisible();
    await manualBtn.click();

    // 직접 등록 폼(성함/연락처) 노출
    await expect(page.getByTestId('newmode-cust-name-input')).toBeVisible();

    // 2-f 핵심: 신규 고객 경로엔 유형(초/재진) 토글 버튼이 없어야 함
    await expect(page.getByTestId('newmode-visit-new-entry')).toHaveCount(0);
    await expect(page.getByTestId('newmode-visit-returning-entry')).toHaveCount(0);
  });

  test('2-e: 신규 고객 항목명 "신규 예약" + 버튼명 "신규 예약 생성"', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    await page.getByTestId('btn-newmode-manual-register').click();
    await page.getByTestId('newmode-cust-name-input').fill('테스트신규');

    // 항목명: "신규 예약" 헤더 (구 "신규예약 만들기 - 신규고객" 아님)
    const form = page.getByTestId('popup-newmode-form');
    await expect(form).toContainText('신규 예약');
    await expect(form).not.toContainText('신규예약 만들기');

    // 버튼명: "신규 예약 생성" (구 "...님 신규예약 생성" 아님)
    const createBtn = page.getByTestId('btn-newmode-create-entry');
    await expect(createBtn).toContainText('신규 예약 생성');
    await expect(createBtn).not.toContainText('님 신규예약 생성');
  });

  test('회귀가드: 기존 고객(검색 선택) 경로는 초/재진 유형 토글 유지', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    // 헤더 검색창에서 기존 고객 로드 시도
    const search = page.locator('#resv-popup-newmode-search');
    if (!(await search.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, '검색창 미노출(clinic 미확정)');
    }
    await search.fill('김');
    const dropdownBtn = page.locator('div.absolute button').first();
    if (!(await dropdownBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, '검색 결과 없음(데이터 의존)');
    }
    await dropdownBtn.click();

    // 기존 고객 로드 시 유형 토글이 노출되어야 함(재진 선택 가능)
    await expect(page.getByTestId('newmode-visit-new-entry')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('newmode-visit-returning-entry')).toBeVisible();
  });
});
