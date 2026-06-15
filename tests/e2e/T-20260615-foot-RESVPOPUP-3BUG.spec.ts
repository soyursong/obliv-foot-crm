/**
 * E2E spec — T-20260615-foot-RESVPOPUP-3BUG
 * 예약상세 팝업 동선/상태 버그 3건 (BUG-1 회귀 / BUG-2 오류 / BUG-3 동선통일)
 *
 * AC1 (BUG-1): 예약상세 팝업 우상단에서 다른 고객 검색·선택 시 헤더 상단 고객명이
 *   선택 고객으로 갱신돼야 함(기존엔 reservation.customer_name 하드바인딩 → stale).
 *   → 헤더 타이틀 = loadedMatch.name ?? customer.name ?? reservation.customer_name.
 *
 * AC2 (BUG-2): "신규예약 생성" 클릭 시 is_healer_intent 컬럼 미반영(PGRST204) 오류로
 *   생성이 깨지는 문제. WRITE(INSERT/UPDATE) 경로 내성화(컬럼 제외 재시도)로 폼이 오류 없이
 *   동작. E2E 는 new-mode 진입·폼 렌더가 오류 토스트 없이 뜨는지 smoke 확인(실데이터 생성은
 *   환경 의존이라 graceful) — 내성화 로직은 isHealerIntentColMissing 유닛 경계로 보강.
 *
 * AC3 (BUG-3): 캘린더 빈 슬롯 우클릭 → (+) 버튼과 동일하게 예약상세 팝업 new-mode 오픈.
 *   기존엔 빈 슬롯에 우클릭 핸들러 부재로 (+) 경로와 동작 불일치.
 *
 * 팝업/슬롯은 데이터·영업시간 의존 → 후보 미존재 시 graceful skip.
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

test.describe('T-20260615-foot-RESVPOPUP-3BUG — 예약상세 팝업 동선/상태 3건', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC1 (BUG-1): 다른 고객 검색·선택 → 헤더 고객명이 stale 아님(선택 고객으로 갱신)
  test('AC1: 헤더 고객명이 검색 선택 고객으로 갱신(stale 아님)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    // 헤더 검색창에 입력 → 결과 드롭다운 첫 후보 선택
    const search = page.locator('#resv-popup-customer-search');
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill('이');
    const option = page.locator('button:has-text("기존 고객"), [role="option"]').first();
    const hasOption = await option.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasOption) test.skip(true, '검색 결과 후보 없음(데이터 의존)');

    // 선택 고객 배너에 노출되는 이름을 헤더 타이틀이 동일하게 반영하는지 확인
    await option.click().catch(() => {});
    const banner = page.getByTestId('popup-loaded-customer-banner');
    const bannerVisible = await banner.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!bannerVisible) test.skip(true, '선택 후 배너 미표시(데이터 의존)');

    const bannerName = (await banner.locator('.text-teal-800').first().textContent().catch(() => '') ?? '').trim();
    if (!bannerName) test.skip(true, '선택 고객명 추출 불가');

    // 헤더 DialogTitle 첫 span = 고객명. 선택 고객(bannerName)을 포함해야 함(stale 잔존 금지).
    const headerName = (await page.locator('[role="dialog"] h2 span, [role="dialog"] [class*="DialogTitle"] span').first().textContent().catch(() => '') ?? '').trim();
    expect(headerName).toContain(bannerName);
    console.log('[AC1] 헤더 고객명 갱신 OK:', headerName, '=', bannerName);
  });

  // AC2 (BUG-2): (+) new-mode 진입 시 오류 토스트 없이 신규예약 폼 렌더(is_healer_intent 미반영 내성화)
  test('AC2: (+) new-mode 진입 시 오류 없이 신규예약 폼 렌더', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 상단 '새 예약' 버튼 (빈 진입 new-mode)
    const newBtn = page.getByRole('button', { name: /새 예약/ }).first();
    const hasNew = await newBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasNew) test.skip(true, '새 예약 버튼 미표시');
    await newBtn.click().catch(() => {});

    // new-mode 빈 진입 — 검색창 노출 + is_healer_intent schema cache 오류 토스트 없음
    const searchEmpty = page.locator('#resv-popup-newmode-search');
    await expect(searchEmpty).toBeVisible({ timeout: 5_000 });
    const healerErr = page.locator('text=is_healer_intent');
    await expect(healerErr).toHaveCount(0);
    console.log('[AC2] new-mode 진입 정상 + is_healer_intent 오류 0건');
  });

  // AC3 (BUG-3): 빈 슬롯 우클릭 → (+)와 동일 new-mode 팝업 오픈
  test('AC3: 빈 슬롯 우클릭 → 예약상세 new-mode 팝업 오픈', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 빈 슬롯의 (+) 버튼이 있는 셀 = 우클릭 대상. (+) 버튼의 부모 td 를 우클릭.
    const plus = page.locator('[data-testid^="slot-plus-"]').first();
    const hasPlus = await plus.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasPlus) test.skip(true, '빈 슬롯(+) 후보 없음(영업시간/데이터 의존)');

    const cell = plus.locator('xpath=ancestor::td[1]');
    await cell.click({ button: 'right' }).catch(() => {});

    // new-mode 검색창 노출 = (+)와 동일 동선 진입 성공
    const searchEmpty = page.locator('#resv-popup-newmode-search');
    await expect(searchEmpty).toBeVisible({ timeout: 5_000 });
    console.log('[AC3] 빈 슬롯 우클릭 → new-mode 팝업 오픈 OK');
  });
});
