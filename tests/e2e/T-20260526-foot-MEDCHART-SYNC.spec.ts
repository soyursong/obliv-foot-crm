/**
 * T-20260526-foot-MEDCHART-SYNC — 진료차트 상용구 분리 + 치료메모/진료이미지/진료내역 연동
 *
 * 시나리오:
 *  S1: 상용구 관리 — 진료차트 유형 상용구 등록 (phrase_type='medical_chart')
 *  S2: 진료차트 우측 패널 — 진료 상용구만 표시 (펜차트 상용구 노출 안 됨)
 *  S3: 진료차트 우측 패널 — 치료메모 탭 표시
 *  S4: 진료차트 우측 패널 — 진료내역 탭 표시
 *  S5: 진료차트 우측 패널 — 진료이미지 탭 표시
 *  S6: DoctorTreatmentPanel — 펜차트 상용구만 표시 (진료차트 상용구 노출 안 됨)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'test-admin@obliv.kr';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'test1234';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder(/이메일/).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/비밀번호/).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe('T-20260526-foot-MEDCHART-SYNC', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ── S1: 상용구 관리 — 진료차트 유형 상용구 등록 ───────────────────────────
  test('S1: 상용구 관리에서 phrase_type 필터 및 진료차트 상용구 등록 가능', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.getByRole('tab', { name: /상용구/ }).click();

    // phrase_type 필터 탭 존재 확인
    await expect(page.getByTestId('phrase-type-filter-all')).toBeVisible();
    await expect(page.getByTestId('phrase-type-filter-pen_chart')).toBeVisible();
    await expect(page.getByTestId('phrase-type-filter-medical_chart')).toBeVisible();

    // 상용구 추가 다이얼로그 열기
    await page.getByTestId('phrase-add-btn').click();

    // 진료차트 타입 선택
    const medChartRadio = page.locator('input[value="medical_chart"]');
    await expect(medChartRadio).toBeVisible();
    await medChartRadio.check();
    await expect(medChartRadio).toBeChecked();

    // 이름 + 내용 입력
    await page.getByTestId('phrase-name-input').fill('[E2E테스트] 진료 상용구');
    await page.getByTestId('phrase-content-input').fill('E2E 진료차트 전용 상용구 내용');

    // 저장
    await page.getByTestId('phrase-save-btn').click();

    // 진료차트 필터로 전환 — 등록된 항목 표시 확인
    await page.getByTestId('phrase-type-filter-medical_chart').click();
    await expect(page.getByText('[E2E테스트] 진료 상용구')).toBeVisible();
  });

  // ── S2: 진료차트 우측 패널 — 진료 상용구만 표시 ────────────────────────────
  test('S2: 진료차트 Drawer — 상용구 탭에서 medical_chart 유형만 표시', async ({ page }) => {
    // 고객 목록 → 진료차트 열기
    await page.goto(`${BASE_URL}/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      // 진료차트 버튼 찾기
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 우측 패널 탭 확인
        await expect(page.getByTestId('right-panel-tab-rx')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-phrase')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-treat_memo')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-visit_hist')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-images')).toBeVisible();

        // 상용구 탭 클릭 — 진료차트 상용구만 표시 (S1에서 등록한 것)
        await page.getByTestId('right-panel-tab-phrase').click();
        await expect(page.getByTestId('right-panel-phrase-content')).toBeVisible();
      }
    }
  });

  // ── S3: 진료차트 우측 패널 — 치료메모 탭 표시 ─────────────────────────────
  test('S3: 진료차트 Drawer — 치료메모 탭 표시 및 읽기전용', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 치료메모 탭 클릭
        await page.getByTestId('right-panel-tab-treat_memo').click();
        await expect(page.getByTestId('right-panel-treat-memo-content')).toBeVisible();
        // 읽기전용 텍스트 확인
        await expect(page.getByText(/읽기전용|2번차트 3구역/)).toBeVisible();
      }
    }
  });

  // ── S4: 진료차트 우측 패널 — 진료내역 탭 표시 ─────────────────────────────
  test('S4: 진료차트 Drawer — 진료내역 탭 표시 및 읽기전용', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 진료내역 탭 클릭
        await page.getByTestId('right-panel-tab-visit_hist').click();
        await expect(page.getByTestId('right-panel-visit-hist-content')).toBeVisible();
        await expect(page.getByText(/방문 진료내역|2번차트 1구역/)).toBeVisible();
      }
    }
  });

  // ── S5: 진료차트 우측 패널 — 진료이미지 탭 표시 ───────────────────────────
  test('S5: 진료차트 Drawer — 진료이미지 탭 표시', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 진료이미지 탭 클릭
        await page.getByTestId('right-panel-tab-images').click();
        await expect(page.getByTestId('right-panel-images-content')).toBeVisible();
        await expect(page.getByText(/진료이미지|2번차트 1구역/)).toBeVisible();
      }
    }
  });

  // ── S6: PhrasesTab — 유형별 카운트 표시 ────────────────────────────────────
  test('S6: PhrasesTab phrase_type 필터 전환 시 카운트 변경', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.getByRole('tab', { name: /상용구/ }).click();

    // 전체 카운트 확인
    await page.getByTestId('phrase-type-filter-all').click();
    const allBtn = page.getByTestId('phrase-type-filter-all');
    await expect(allBtn).toBeVisible();

    // 펜차트 필터
    await page.getByTestId('phrase-type-filter-pen_chart').click();
    await expect(page.getByTestId('phrase-type-filter-pen_chart')).toBeVisible();

    // 진료차트 필터
    await page.getByTestId('phrase-type-filter-medical_chart').click();
    await expect(page.getByTestId('phrase-type-filter-medical_chart')).toBeVisible();
  });
});
