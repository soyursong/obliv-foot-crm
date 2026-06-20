/**
 * E2E spec — T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW
 * 예약관리 캘린더 압축(AC-1, 시나리오1) + (+) 신규 예약 팝업 2-f/2-e
 *
 * ※ 본 스펙 범위:
 *   - [시나리오1 / AC-1] 캘린더 컴팩트화: 시간 슬롯 row 높이·예약 박스 패딩/폰트 압축(절반 밀도).
 *     단 요일·날짜 헤더(resv-day-header)는 압축 대상 제외 → text-sm(14px) 미변경 회귀가드.
 *   - 2-f: 신규 고객 직접 등록(manualNew) 경로는 무조건 초진 → 초/재진 유형 토글 미노출, visit_type='new' 고정.
 *   - 2-e: 신규 고객 항목명 "신규 예약" / 버튼명 "신규 예약 생성".
 *   - 기존 고객(loadedMatch) 검색 경로는 재진 가능 → 유형 토글 유지(회귀가드).
 *   AC-2/3/4(2버튼 진입·필드 이동)는 후속 시퀀싱 → 본 스펙 비대상.
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

    // (b) 예약 박스(카드) 압축: 카드 폰트 = 11px(text-xs=12px → text-[11px]=11px). row 높이는
    //     카드 수에 종속(시드 데이터 밀집)이라 비결정적 → 카드 computed 폰트로 박스 압축을 결정론적 검증.
    //     카드 부재(빈 캘린더) 시 graceful skip(데이터 의존).
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
      // 헤더가 body 슬롯 셀보다 큼(압축 비대상 확인)
      expect(headerFs).toBeGreaterThan(bodyTimeFs!);
    }
  });
});

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
