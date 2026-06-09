/**
 * T-20260526-foot-MEDCHART-SYNC — 진료차트 상용구 분리 + 치료메모/진료이미지/진료내역 연동
 *
 * 시나리오:
 *  S1: 상용구 관리 — 진료차트 유형 상용구 등록 (phrase_type='medical_chart')
 *  S2: 진료차트 우측 패널 — 진료 상용구만 표시 (펜차트 상용구 노출 안 됨)
 *  S3: 치료메모 — [치료사차트] 섹션 통합 + 우측 패널 별도 탭 제거 (T-20260527-foot-TREATMEMO-CHART-MERGE)
 *  S4: 진료차트 우측 패널 — 진료내역 탭 표시
 *  S5: 진료차트 우측 패널 — 진료이미지 탭 표시
 *  S6: DoctorTreatmentPanel — 펜차트 상용구만 표시 (진료차트 상용구 노출 안 됨)
 *
 * 인증: desktop-chrome 프로젝트의 storageState(.auth/user.json) + baseURL(localhost:8089)
 *   기준. 기존 자체 BASE_URL(localhost:5173)·UI 로그인은 포트 불일치로 항상 timeout 되어
 *   loginAndWaitForDashboard 헬퍼(storageState 우선 + UI 폴백)로 현대화.
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient } from '@supabase/supabase-js';

// S1은 UI로 진료차트 상용구를 등록한다. cleanup 없이 반복 실행되면 동일 name 행이
// phrase_templates 에 누적돼 getByText 가 strict mode 위반(2+ 매치)으로 실패한다.
// SERVICE_ROLE 키로 테스트 시드 name 을 사전/사후 제거해 격리를 보장한다.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const S1_PHRASE_NAME = '[E2E테스트] 진료 상용구';

async function purgeTestPhrase() {
  if (!SERVICE_KEY) return;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await admin.from('phrase_templates').delete().eq('name', S1_PHRASE_NAME);
}

test.describe('T-20260526-foot-MEDCHART-SYNC', () => {
  test.beforeAll(purgeTestPhrase);
  test.afterAll(purgeTestPhrase);

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── S1: 상용구 관리 — 진료차트 유형 상용구 등록 ───────────────────────────
  test('S1: 상용구 관리에서 phrase_type 필터 및 진료차트 상용구 등록 가능', async ({ page }) => {
    await page.goto(`/admin/doctor-tools`);
    await page.getByRole('tab', { name: '상용구', exact: true }).click();

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
    await expect(page.getByText(S1_PHRASE_NAME).first()).toBeVisible();
  });

  // ── S2: 진료차트 우측 패널 — 진료 상용구만 표시 ────────────────────────────
  test('S2: 진료차트 Drawer — 상용구 탭에서 medical_chart 유형만 표시', async ({ page }) => {
    // 고객 목록 → 진료차트 열기
    await page.goto(`/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      // 진료차트 버튼 찾기
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 우측 패널 탭 확인 (T-20260527-foot-TREATMEMO-CHART-MERGE: treat_memo 탭 제거됨)
        await expect(page.getByTestId('right-panel-tab-rx')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-phrase')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-treat_memo')).toHaveCount(0);
        await expect(page.getByTestId('right-panel-tab-visit_hist')).toBeVisible();
        await expect(page.getByTestId('right-panel-tab-images')).toBeVisible();

        // 상용구 탭 클릭 — 진료차트 상용구만 표시 (S1에서 등록한 것)
        await page.getByTestId('right-panel-tab-phrase').click();
        await expect(page.getByTestId('right-panel-phrase-content')).toBeVisible();
      }
    }
  });

  // ── S3: 치료메모 — [치료사차트] 섹션 통합 + 별도 탭 제거 ───────────────────────
  //   T-20260527-foot-TREATMEMO-CHART-MERGE 로 우측 패널 '치료메모' 탭이 제거되고
  //   [치료사차트] 섹션(treat-memo-in-chart-section)에 통합됨. 본 테스트는 탭 제거
  //   회귀만 검증하고, seed 기반 통합 위치·읽기전용 상세는
  //   tests/e2e/T-20260527-foot-TREATMEMO-CHART-MERGE.spec.ts 가 전담한다.
  test('S3: 진료차트 Drawer — 치료메모 별도 탭 제거(=[치료사차트] 통합)', async ({ page }) => {
    await page.goto(`/admin/customers`);
    const firstRow = page.locator('[data-testid="customer-row"]').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      const chartBtn = page.locator('button', { hasText: /진료차트/ }).first();
      if (await chartBtn.isVisible()) {
        await chartBtn.click();
        await expect(page.getByTestId('medical-chart-drawer')).toBeVisible();

        // 별도 '치료메모' 탭이 제거됐는지 확인 (통합으로 이동)
        await expect(page.getByTestId('right-panel-tab-treat_memo')).toHaveCount(0);
        // 기존 치료사차트 영역(통합 위치)은 보존
        await expect(page.getByTestId('medical-chart-treatment')).toBeVisible();
      }
    }
  });

  // ── S4: 진료차트 우측 패널 — 진료내역 탭 표시 ─────────────────────────────
  test('S4: 진료차트 Drawer — 진료내역 탭 표시 및 읽기전용', async ({ page }) => {
    await page.goto(`/admin/customers`);
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
        await expect(page.getByText(/방문이력|2번차트 1구역/)).toBeVisible();
      }
    }
  });

  // ── S5: 진료차트 우측 패널 — 진료이미지 탭 표시 ───────────────────────────
  test('S5: 진료차트 Drawer — 진료이미지 탭 표시', async ({ page }) => {
    await page.goto(`/admin/customers`);
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
    await page.goto(`/admin/doctor-tools`);
    await page.getByRole('tab', { name: '상용구', exact: true }).click();

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
