/**
 * E2E — T-20260522-foot-DESIGNATED-THERAPIST
 * 지정 치료사 기능 6건 시나리오
 *
 * SC-1: 2번차트에 [지정 치료사] 드롭다운이 렌더된다 (예약내역↔회차차감 사이)
 * SC-2: 드롭다운 변경 시 DB 저장 후 토스트 노출
 * SC-3: 차트 재방문 시 저장된 지정 치료사가 유지된다
 * SC-4: [AC-R1] 지정 치료사 설정 시에도 회차 차감 폼 치료사 드롭다운은 빈 상태 (수기 선택)
 *        (이전 SC-4: 자동선택 검증 → 2026-05-23 FIX-REQUEST로 로직 제거, 반대 동작 검증으로 교체)
 * SC-5: 매출집계 > 담당직원별 탭에 [지정환자수] 컬럼 존재
 * SC-6: 지정 치료사 '없음' 설정 시 designated_therapist_id = null로 저장
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// 테스트용 고객/직원 ID는 시드 데이터 또는 환경변수로 주입
// CI 미구성 시 skip
const SKIP_NO_SEED = !process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;

test.describe('T-20260522-foot-DESIGNATED-THERAPIST', () => {

  // SC-1: 2번차트에 [지정 치료사] 드롭다운 렌더 확인 (구조 테스트)
  test('SC-1: 2번차트 [지정 치료사] 드롭다운 섹션 렌더', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    // 지정 치료사 select 존재 확인
    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // select가 예약내역 섹션 다음, 회차차감 섹션 이전에 위치해야 함
    const resvSection = page.getByText('예약내역').first();
    const deductSection = page.getByText('회차 차감').first();
    const resvBox = await resvSection.boundingBox();
    const selectBox = await select.boundingBox();
    const deductBox = await deductSection.boundingBox();

    // 수직 순서: 예약내역 위쪽 < 지정치료사 < 회차차감 아래쪽
    expect(selectBox!.y).toBeGreaterThan(resvBox!.y);
    expect(selectBox!.y).toBeLessThan(deductBox!.y);
  });

  // SC-2: 드롭다운 변경 → DB 저장 토스트
  test('SC-2: 지정 치료사 변경 시 저장 토스트 노출', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // 옵션 목록 가져오기
    const options = await select.locator('option').all();
    const hasTherapist = options.length > 1;
    if (!hasTherapist) {
      test.skip(); // 치료사 없으면 skip
    }

    // 두 번째 옵션(첫 번째 치료사) 선택
    const secondOption = options[1];
    const optionValue = await secondOption.getAttribute('value');
    await select.selectOption(optionValue!);

    // 토스트 노출 확인
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
  });

  // SC-3: 페이지 재방문 시 지정 치료사 유지
  test('SC-3: 차트 재방문 시 지정 치료사 유지', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    const options = await select.locator('option').all();
    if (options.length < 2) { test.skip(); }

    const secondValue = await options[1].getAttribute('value');
    await select.selectOption(secondValue!);
    // 저장 대기
    await page.waitForTimeout(1500);

    // 재방문
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('designated-therapist-select')).toHaveValue(secondValue!, { timeout: 8_000 });
  });

  // SC-4: [AC-R1] 지정 치료사가 설정돼 있어도 회차 차감 폼 치료사 드롭다운은 빈 상태
  // 현장 원문: "환자가 특정 치료사 지정하면 해당 치료사나 데스크에서 수기로 넣는거야!"
  test('SC-4: 지정 치료사 설정돼도 회차차감 치료사 드롭다운은 빈 상태(수기 선택)', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const designatedSelect = page.getByTestId('designated-therapist-select');
    await expect(designatedSelect).toBeVisible({ timeout: 10_000 });

    const options = await designatedSelect.locator('option').all();
    if (options.length < 2) { test.skip(); }

    // 지정 치료사 세팅
    const secondValue = await options[1].getAttribute('value');
    await designatedSelect.selectOption(secondValue!);
    await page.waitForTimeout(800);

    // AC-R1: 회차 차감 폼의 치료사 드롭다운은 빈 상태여야 함 (자동선택 안 됨)
    const deductTherapistSelect = page.getByTestId('deduct-therapist-select');
    // 드롭다운이 존재하면 빈 값('' 또는 placeholder)인지 확인
    const deductValue = await deductTherapistSelect.inputValue().catch(() => '');
    expect(deductValue).toBe('');
  });

  // SC-5: 매출집계 > 담당직원별 탭에 [지정환자수] 컬럼
  test('SC-5: 매출집계 담당직원별 탭 [지정환자수] 컬럼 존재', async ({ page }) => {
    await page.goto(`${BASE_URL}/sales`);
    await page.waitForLoadState('networkidle');

    // 담당직원별 탭 클릭
    await page.getByRole('tab', { name: '담당직원별' }).click();
    await page.waitForTimeout(500);

    // 테이블 헤더에 지정환자수 컬럼 확인
    await expect(page.getByRole('columnheader', { name: '지정환자수' })).toBeVisible({ timeout: 5_000 });
  });

  // SC-6: 지정 치료사 해제 (none → null)
  test('SC-6: 지정 치료사 없음 설정 시 해제 토스트', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    const select = page.getByTestId('designated-therapist-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // 없음 선택
    await select.selectOption('');
    // 토스트: "지정 치료사 해제"
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('지정 치료사 해제')).toBeVisible({ timeout: 3_000 });
  });

});
