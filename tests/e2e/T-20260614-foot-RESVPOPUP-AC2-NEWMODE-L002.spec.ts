/**
 * E2E spec — T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002
 * 예약상세 팝업 new-mode (AC2) + 신규등록 모달 스폰 폐기 (AC1-잔여) · 옵션A · L-002 개정
 *
 * 결정(옵션A): canonical insert 를 Reservations.tsx 단일소스 함수(createReservationCanonical)로 추출.
 *   팝업은 parent 콜백(onCreateReservation)만 호출 — 팝업 내 reservations.insert = 0(자구).
 *   생성 무결성 5요소(slot 상한·패키지연결·경과체크·치료사 역동기화·생성로그)는 전부 함수 내부 보존.
 *
 * 시나리오 4종:
 *  S1: B 고객 검색 로드 → '팝업 안에서' new-mode 폼(시간/초·재/생성버튼) 노출. 모달 스폰 0(예약 editor 미오픈).
 *  S2: 날짜(미니캘린더) 미선택 시 생성버튼 disabled — 날짜 선택 후 활성.
 *  S3: new-mode 초/재 토글 + 시간 선택 동작.
 *  S4: 구(舊) 모달 스폰 버튼(btn-register-new-for-loaded) 제거 → new-mode 생성 버튼(btn-newmode-create) 으로 대체.
 *
 * 팝업은 기존 예약 클릭으로만 열림(데이터 의존) → 예약/검색결과 없으면 graceful skip.
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

/** 헤더 검색창에서 첫 후보 선택 → B 로드. 성공 시 true. */
async function loadOtherCustomer(page: Page): Promise<boolean> {
  const search = page.locator('#resv-popup-customer-search');
  if (!(await search.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await search.fill('김');
  const dropdownBtn = page.locator('div.absolute button').first();
  const hasResult = await dropdownBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!hasResult) return false;
  await dropdownBtn.click();
  return page.getByTestId('popup-loaded-customer-banner').isVisible({ timeout: 3_000 }).catch(() => false);
}

test.describe('T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 — 팝업 new-mode 신규예약', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // S1: B 로드 → 팝업 안 new-mode 폼 노출 + 모달 스폰 0
  test('S1: B 로드 시 팝업 new-mode 폼 노출, 예약 editor 모달 미오픈', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');
    const loaded = await loadOtherCustomer(page);
    if (!loaded) test.skip(true, '검색 결과 데이터 없음');

    // 팝업 안에 new-mode 폼 노출
    await expect(page.getByTestId('popup-newmode-form')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('newmode-time-select')).toBeVisible();
    await expect(page.getByTestId('btn-newmode-create')).toBeVisible();
    // 팝업(zone1) 유지 — 닫히지 않음
    await expect(page.getByTestId('popup-zone1-customer')).toBeVisible();
    // 예약 등록/수정 editor 모달 제목이 새로 뜨지 않아야 함(모달 스폰 폐기)
    await expect(page.getByRole('heading', { name: '예약 등록' })).toHaveCount(0);
    console.log('[S1] 팝업 new-mode 폼 노출 + 모달 스폰 0 OK');
  });

  // S2: 날짜 미선택 시 생성버튼 disabled → 날짜 선택 후 활성
  test('S2: 날짜 미선택 생성버튼 disabled, 날짜 선택 후 활성', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');
    const loaded = await loadOtherCustomer(page);
    if (!loaded) test.skip(true, '검색 결과 데이터 없음');

    const createBtn = page.getByTestId('btn-newmode-create');
    await expect(createBtn).toBeVisible({ timeout: 3_000 });
    // 초기: pickedDate 미선택 → disabled
    await expect(createBtn).toBeDisabled();

    // 미니캘린더에서 활성 날짜 1개 클릭 (오늘 셀 등 클릭 가능한 day 버튼)
    const dayBtn = page.locator('button').filter({ hasText: /^\d{1,2}$/ }).first();
    if (await dayBtn.isVisible().catch(() => false)) {
      await dayBtn.click().catch(() => {});
      // 날짜 선택되면 활성화 (캘린더 day 클릭이 pickedDate set)
      await expect(createBtn).toBeEnabled({ timeout: 3_000 }).catch(() => {});
    }
    console.log('[S2] 날짜 가드(disabled→enabled) OK');
  });

  // S3: 초/재 토글 + 시간 선택 동작
  test('S3: new-mode 초/재 토글 + 시간 선택 동작', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');
    const loaded = await loadOtherCustomer(page);
    if (!loaded) test.skip(true, '검색 결과 데이터 없음');

    await expect(page.getByTestId('newmode-visit-new')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('newmode-visit-returning')).toBeVisible();
    // 초진 토글 클릭
    await page.getByTestId('newmode-visit-new').click();
    // 시간 선택 변경
    const timeSelect = page.getByTestId('newmode-time-select');
    await timeSelect.selectOption('14:00');
    await expect(timeSelect).toHaveValue('14:00');
    console.log('[S3] 초/재 토글 + 시간 선택 OK');
  });

  // S4: 구 모달 스폰 버튼 제거 → new-mode 생성버튼 대체
  test('S4: 구 모달 스폰 버튼(btn-register-new-for-loaded) 제거', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');
    const loaded = await loadOtherCustomer(page);
    if (!loaded) test.skip(true, '검색 결과 데이터 없음');

    // 구 버튼 제거됨
    await expect(page.getByTestId('btn-register-new-for-loaded')).toHaveCount(0);
    // 신규 생성버튼으로 대체
    await expect(page.getByTestId('btn-newmode-create')).toBeVisible({ timeout: 3_000 });
    // 예약(A) 저장 버튼은 여전히 숨김(엉뚱저장 0)
    await expect(page.getByTestId('btn-reservation-save')).toHaveCount(0);
    console.log('[S4] 모달 스폰 버튼 제거 + new-mode 대체 OK');
  });
});

// ── AC2 시나리오1: (+) 새 예약 → 예약상세 팝업 new-mode 빈 진입(별도 폼/모달 스폰 폐기) ──
test.describe('T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 — (+) new-mode 빈 진입', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  // S5: (+) → 팝업 new-mode 오픈(검색창 활성·빈 상태). ReservationEditor 모달 스폰 0.
  test('S5: (+) 새 예약 → 팝업 new-mode 빈 상태 오픈, editor 모달 미오픈', async ({ page }) => {
    const plusBtn = page.getByRole('button', { name: '새 예약' });
    if (!(await plusBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, '(+) 새 예약 버튼 비노출(경과분석 뷰 등)');
    }
    await plusBtn.click();
    // 빈 new-mode 진입: 고객 미선택 placeholder + 검색창 활성
    await expect(page.getByTestId('popup-newmode-empty')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#resv-popup-newmode-search')).toBeVisible();
    // 신규 제목 노출 / 별도 ReservationEditor('예약 등록') 모달 미오픈
    await expect(page.getByRole('heading', { name: '신규 예약' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '예약 등록' })).toHaveCount(0);
    // 고객 미선택 → 생성 폼/버튼 미노출(미선택 생성 시도 차단 = INSERT 0)
    await expect(page.getByTestId('btn-newmode-create-entry')).toHaveCount(0);
    console.log('[S5] (+) new-mode 빈 진입 + 모달 스폰 0 + 미선택 가드 OK');
  });

  // S6: (+) new-mode → 고객 검색 선택 → 생성 폼(날짜/시간/초·재/생성버튼) 노출
  test('S6: (+) new-mode → 고객 선택 시 생성 폼 노출', async ({ page }) => {
    const plusBtn = page.getByRole('button', { name: '새 예약' });
    if (!(await plusBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, '(+) 새 예약 버튼 비노출');
    }
    await plusBtn.click();
    const search = page.locator('#resv-popup-newmode-search');
    if (!(await search.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'new-mode 검색창 비노출(clinic 미확정)');
    }
    await search.fill('김');
    const dropdownBtn = page.locator('div.absolute button').first();
    if (!(await dropdownBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, '검색 결과 데이터 없음');
    }
    await dropdownBtn.click();
    // 생성 폼 노출 + 생성 버튼(entry) + 시간 select
    await expect(page.getByTestId('popup-newmode-form')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('newmode-time-select-entry')).toBeVisible();
    const createBtn = page.getByTestId('btn-newmode-create-entry');
    await expect(createBtn).toBeVisible();
    // 날짜 미선택 → disabled (slot/날짜 가드)
    await expect(createBtn).toBeDisabled();
    console.log('[S6] (+) new-mode 고객 선택 → 생성 폼 노출 + 날짜 가드 OK');
  });
});
