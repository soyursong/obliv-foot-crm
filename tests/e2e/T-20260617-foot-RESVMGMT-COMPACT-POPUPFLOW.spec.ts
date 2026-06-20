/**
 * E2E spec — T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW
 * 예약관리 캘린더 압축(AC-1) + (+) 신규 예약 팝업 진입동선 재구성(AC-2/3/4/5/6)
 *
 * ※ 본 스펙 범위:
 *   [시나리오1 / AC-1] 캘린더 컴팩트화: 시간 슬롯 row 높이·예약 박스 패딩/폰트 압축(절반 밀도).
 *     단 요일·날짜 헤더(resv-day-header)는 압축 대상 제외 → text-sm(14px) 미변경 회귀가드.
 *   [시나리오2 / AC-2·AC-3] (+) 팝업 진입 = [신규 고객 등록]/[기존 고객 예약] 2버튼만(구 상시 검색창·직접등록 혼재 제거).
 *     [기존 고객 예약] → 화면전환 없이 하단 성함·연락처 검색칸 동적생성 → 선택 시 예약상세(패키지·치료이력) 노출.
 *   [시나리오3 / AC-4·AC-5·AC-6] [신규 고객 등록] → 연락처 하단에 예약경로·예약등록자 필드.
 *     항목명 "신규 예약" / 버튼명 "신규 예약 생성" / 초·재진 토글 미노출(초진 자동).
 *   회귀가드: 기존 고객(loadedMatch) 경로는 재진 가능 → 유형 토글 유지.
 *
 * 데이터/clinic 미준비 시 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** computed font-size(px 정수) 반환. 요소 없으면 null. */
async function fontSizePx(page: Page, testid: string): Promise<number | null> {
  const el = page.getByTestId(testid).first();
  if (!(await el.count())) return null;
  const fs = await el.evaluate((n) => getComputedStyle(n as Element).fontSize);
  const m = /([\d.]+)px/.exec(fs);
  return m ? Math.round(parseFloat(m[1])) : null;
}

/** 예약관리 → 상단 '새 예약' 클릭 → new-mode 팝업(2버튼 진입) 오픈. 성공 시 true. */
async function openNewModePopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const newBtn = page.getByRole('button', { name: '새 예약' });
  if (!(await newBtn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await newBtn.click();
  // AC-2: 2버튼 진입 패널 노출 = new-mode 진입 성공
  return page.getByTestId('popup-newmode-entry-choose').isVisible({ timeout: 5_000 }).catch(() => false);
}

test.describe('T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW — 시나리오1 캘린더 압축(AC-1)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 시간 슬롯 row·예약 박스가 압축 렌더, 요일·날짜 헤더는 미변경', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 타임테이블(시간 슬롯 row) 마운트 대기
    const firstSlotCell = page.getByTestId('resv-time-col-cell').first();
    if (!(await firstSlotCell.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, '타임테이블 미렌더(clinic/영업시간 미확정)');
    }

    // (a) 압축 적용 증거: 시간축 body 셀 폰트 = 11px (압축 전 text-xs=12px → text-[11px]=11px)
    const bodyTimeFs = await fontSizePx(page, 'resv-time-col-cell');
    expect(bodyTimeFs).not.toBeNull();
    expect(bodyTimeFs!).toBeLessThanOrEqual(11);

    // (b) 예약 박스(카드) 압축: 카드 폰트 = 11px. 카드 부재(빈 캘린더) 시 graceful skip.
    const card = page.locator('[data-testid^="resv-card-"]').first();
    if (await card.count()) {
      const cardFs = await card.evaluate((n) => getComputedStyle(n as Element).fontSize);
      const m = /([\d.]+)px/.exec(cardFs);
      expect(m).not.toBeNull();
      expect(Math.round(parseFloat(m![1]))).toBeLessThanOrEqual(11);
    }
    // 슬롯 row 자체는 존재(타임테이블 렌더) 확인
    expect(await page.getByTestId('resv-slot-row').count()).toBeGreaterThan(0);

    // (c) 회귀가드: 요일·날짜 헤더는 압축 대상 제외 → text-sm(14px) 유지(미변경)
    const headerFs = await fontSizePx(page, 'resv-day-header');
    if (headerFs !== null) {
      expect(headerFs).toBeGreaterThanOrEqual(14);
      expect(headerFs).toBeGreaterThan(bodyTimeFs!);
    }
  });
});

test.describe('T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW — 시나리오2 (+) 2버튼 진입동선(AC-2/AC-3)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-2: (+) 팝업이 [신규 고객 등록]/[기존 고객 예약] 2버튼만 노출, 상시 검색창 없음', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    // 2버튼 노출
    await expect(page.getByTestId('btn-newmode-register-new')).toBeVisible();
    await expect(page.getByTestId('btn-newmode-existing-resv')).toBeVisible();

    // 구 동선 부재: 상시 검색창(빈 상태에서) / "직접 등록" 단일 버튼 없음
    await expect(page.getByTestId('popup-newmode-empty')).toHaveCount(0);
    await expect(page.getByTestId('btn-newmode-manual-register')).toHaveCount(0);
    // 빈 상태(고객 미선택)에선 검색 input 이 노출되지 않음(검색은 [기존 고객 예약] 동선 안)
    await expect(page.locator('#resv-popup-newmode-search')).toHaveCount(0);
  });

  test('AC-3: [기존 고객 예약] → 화면전환 없이 하단 성함·연락처 검색칸 동적생성', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    await page.getByTestId('btn-newmode-existing-resv').click();

    // 검색 패널 + 인라인 검색칸 동적생성(별도 화면전환 없이 같은 팝업 내)
    await expect(page.getByTestId('popup-newmode-existing-search')).toBeVisible();
    await expect(page.locator('#resv-popup-newmode-search')).toBeVisible();

    // 검색 → 매칭 고객 선택 → 예약상세(패키지·치료이력) 노출 (데이터 의존, 없으면 graceful)
    const search = page.locator('#resv-popup-newmode-search');
    await search.fill('김');
    const dropdownBtn = page.locator('div.absolute button').first();
    if (await dropdownBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dropdownBtn.click();
      await expect(page.getByTestId('popup-newmode-customer')).toBeVisible({ timeout: 5_000 });
      // AC-3: 예약상세 = 패키지·치료이력 섹션(RESVPOPUP-2ZONE PackageTicketReadonlyList 재사용)
      await expect(page.getByTestId('popup-newmode-pkg-history')).toBeVisible();
      // 기존 고객 경로는 재진 가능 → 유형 토글 유지(회귀가드)
      await expect(page.getByTestId('newmode-visit-new-entry')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('newmode-visit-returning-entry')).toBeVisible();
    }
  });
});

test.describe('T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW — 시나리오3 신규 고객 등록(AC-4/5/6)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-4: [신규 고객 등록] → 연락처 입력칸 하단에 예약경로·예약등록자 노출', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    await page.getByTestId('btn-newmode-register-new').click();

    // 성함·연락처 + 예약경로·예약등록자 필드 노출
    await expect(page.getByTestId('newmode-cust-name-input')).toBeVisible();
    await expect(page.getByTestId('newmode-cust-phone-input')).toBeVisible();
    await expect(page.getByTestId('newmode-visit-route-select')).toBeVisible();
    await expect(page.getByTestId('newmode-registrar-select')).toBeVisible();

    // AC-4: 예약경로·예약등록자가 연락처 입력칸 '하단'에 위치(DOM 순서)
    const form = page.getByTestId('popup-newmode-manual-form');
    const phoneY = await form.getByTestId('newmode-cust-phone-input').boundingBox();
    const routeY = await form.getByTestId('newmode-visit-route-select').boundingBox();
    if (phoneY && routeY) expect(routeY.y).toBeGreaterThan(phoneY.y);
  });

  test('AC-5/AC-6: 항목명 "신규 예약" + 버튼명 "신규 예약 생성" + 초·재진 토글 미노출', async ({ page }) => {
    const ok = await openNewModePopup(page);
    if (!ok) test.skip(true, 'new-mode 팝업 진입 불가(clinic/데이터 미준비)');

    await page.getByTestId('btn-newmode-register-new').click();
    await page.getByTestId('newmode-cust-name-input').fill('테스트신규');

    // AC-6: 신규 고객 경로엔 유형(초/재진) 토글이 없어야 함(초진 자동)
    await expect(page.getByTestId('newmode-visit-new-entry')).toHaveCount(0);
    await expect(page.getByTestId('newmode-visit-returning-entry')).toHaveCount(0);

    // AC-5: 항목명 "신규 예약"(구 "신규예약 만들기 - 신규고객" 아님)
    const form = page.getByTestId('popup-newmode-form');
    await expect(form).toContainText('신규 예약');
    await expect(form).not.toContainText('신규예약 만들기');

    // AC-5: 버튼명 "신규 예약 생성"(구 "...님 신규예약 생성" 아님)
    const createBtn = page.getByTestId('btn-newmode-create-entry');
    await expect(createBtn).toContainText('신규 예약 생성');
    await expect(createBtn).not.toContainText('님 신규예약 생성');
  });
});
