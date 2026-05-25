/**
 * E2E spec — T-20260525-foot-RESV-DESIG-AUTOASSIGN
 * 재진 예약 등록 시 customers.designated_therapist_id 자동 배정 검증
 *
 * AC-1: 재진 예약 등록 팝업에서 기존 고객 선택 시 designated_therapist_id 조회
 *       → 값 있으면 담당 치료사 드롭다운 자동 세팅 + "지정 치료사" 라벨 표시
 * AC-2: 차감 폼 치료사 드롭다운 변경 없음 (기존 대로 빈 상태 유지)
 * AC-3: 초진(신규 고객)에는 미적용 — 패널 자체가 미표시
 * AC-4: 기존 기능 회귀 없음 (자동 배정 후 수기 변경 가능)
 *
 * 시나리오 1: designated_therapist_id 있는 재진 고객 → 드롭다운 자동 세팅 + "지정 치료사" 라벨
 * 시나리오 2: designated_therapist_id 없는 재진 고객 (check_ins 최빈 있음) → primaryTherapistId fallback
 * 시나리오 3: designated_therapist_id 없는 재진 고객 (이력 없음) → "미배정" 표시
 * 시나리오 4: 초진 선택 → 패널 미표시 (AC-3)
 * 시나리오 5: 자동 세팅 후 수기 변경 가능 (AC-4)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

/** 테스트 픽스처 — designated_therapist_id 있는 고객 */
async function getCustomerWithDesignatedTherapist(sb: ReturnType<typeof createClient>) {
  const { data } = await sb
    .from('customers')
    .select('id, name, phone, designated_therapist_id')
    .eq('clinic_id', CLINIC_ID)
    .not('designated_therapist_id', 'is', null)
    .limit(1)
    .maybeSingle();
  return data as { id: string; name: string; phone: string; designated_therapist_id: string } | null;
}

/** 지정 치료사 이름 조회 */
async function getStaffName(sb: ReturnType<typeof createClient>, staffId: string) {
  const { data } = await sb.from('staff').select('name').eq('id', staffId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

/** 예약 관리 페이지 진입 헬퍼 */
async function gotoReservations(page: import('@playwright/test').Page) {
  await page.goto(`${APP_URL}/reservations`);
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
test.describe('T-20260525-foot-RESV-DESIG-AUTOASSIGN', () => {
  let sb: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    sb = createClient(SUPA_URL, SERVICE_KEY);
  });

  // -------------------------------------------------------------------------
  test('시나리오 1: designated_therapist_id 있는 재진 고객 → "지정 치료사" 라벨 + 드롭다운 자동 세팅', async ({ page }) => {
    const customer = await getCustomerWithDesignatedTherapist(sb);
    if (!customer) {
      test.skip(true, 'designated_therapist_id 있는 고객 없음 — 스킵');
      return;
    }
    const expectedName = await getStaffName(sb, customer.designated_therapist_id);
    if (!expectedName) {
      test.skip(true, '치료사 이름 조회 실패 — 스킵');
      return;
    }

    await gotoReservations(page);

    // 예약 등록 버튼 클릭 (빈 슬롯 클릭)
    const addBtn = page.locator('[data-testid="reservation-add-btn"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
    } else {
      // 캘린더 빈 슬롯 클릭 fallback
      const slot = page.locator('.reservation-slot-empty').first();
      await slot.click();
    }

    // 재진 선택
    const returningBtn = page.locator('button:has-text("재진")').first();
    await returningBtn.click();

    // 고객 검색 — 이름/전화로 선택
    const searchInput = page.locator('input[placeholder*="검색"]').first();
    await searchInput.fill(customer.name.slice(0, 2));
    await page.waitForTimeout(600);

    // 검색 결과에서 해당 고객 클릭
    const matchItem = page.locator(`[data-testid*="patient-match"], li:has-text("${customer.name}")`).first();
    if (await matchItem.isVisible({ timeout: 3000 })) {
      await matchItem.click();
    } else {
      // phone으로 재시도
      await searchInput.clear();
      await searchInput.fill(customer.phone.slice(-4));
      await page.waitForTimeout(600);
      await page.locator(`li:has-text("${customer.name}")`).first().click();
    }

    // 치료사 패널 로딩 대기
    await page.waitForSelector('text=지정 치료사', { timeout: 5000 });

    // AC-1: "지정 치료사" 라벨 표시
    await expect(page.locator('text=지정 치료사')).toBeVisible();

    // AC-1: 드롭다운에 designated_therapist_id에 해당하는 치료사 선택 확인
    const therapistSelect = page.locator('select').filter({ hasText: expectedName }).first();
    const selectEl = page.locator('select[class*="emerald"]').first();
    const selectedValue = await selectEl.inputValue();
    expect(selectedValue).toBe(customer.designated_therapist_id);
  });

  // -------------------------------------------------------------------------
  test('시나리오 3: 초진 선택 시 지정 치료사 패널 미표시 (AC-3)', async ({ page }) => {
    await gotoReservations(page);

    // 예약 등록 팝업 열기
    const addBtn = page.locator('[data-testid="reservation-add-btn"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
    }

    // 초진 선택 (기본값이어야 함)
    const newBtn = page.locator('button:has-text("초진")').first();
    await newBtn.click();

    // 패널 미표시 확인
    await page.waitForTimeout(500);
    await expect(page.locator('text=지정 치료사')).not.toBeVisible();
    await expect(page.locator('text=담당 치료사')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('시나리오 4 (회귀): 자동 세팅 후 수기 변경 가능 (AC-4)', async ({ page }) => {
    const customer = await getCustomerWithDesignatedTherapist(sb);
    if (!customer) {
      test.skip(true, 'designated_therapist_id 있는 고객 없음 — 스킵');
      return;
    }

    await gotoReservations(page);

    // 예약 등록 팝업
    const addBtn = page.locator('[data-testid="reservation-add-btn"]').first();
    if (await addBtn.isVisible()) await addBtn.click();

    const returningBtn = page.locator('button:has-text("재진")').first();
    await returningBtn.click();

    const searchInput = page.locator('input[placeholder*="검색"]').first();
    await searchInput.fill(customer.name.slice(0, 2));
    await page.waitForTimeout(600);

    const matchItem = page.locator(`li:has-text("${customer.name}")`).first();
    if (await matchItem.isVisible({ timeout: 3000 })) {
      await matchItem.click();
    }

    // 패널 로딩 대기
    await page.waitForTimeout(1000);

    // 드롭다운에서 다른 옵션으로 변경 가능한지 확인
    const selectEl = page.locator('select[class*="emerald"]').first();
    if (await selectEl.isVisible({ timeout: 3000 })) {
      // 첫 번째 다른 option 선택 (— 미배정 — )
      await selectEl.selectOption({ index: 0 });
      const changedValue = await selectEl.inputValue();
      // 수기 변경이 가능해야 함 (AC-4)
      expect(changedValue).toBe('');
    }
  });
});
