/**
 * E2E — T-20260523-foot-PKG-DEDUCT-THERAPIST
 * 2번차트 패키지 회차 차감 치료사 드롭다운 비어있음 — display_name 컬럼 미존재 버그
 *
 * 원인: T-20260522-foot-STAFF-NAME-UNIFY 가 staff 쿼리에 display_name 추가 →
 *        컬럼 미존재(42703) → 400 에러 → staffAllRes.data=null → therapistList=[]
 *
 * SC-1: 2번차트 패키지 회차 차감 영역 > 치료사 드롭다운 렌더 확인
 * SC-2: 치료사 드롭다운에 options >= 2 (치료사 1명 이상 로드 성공)
 * SC-3: staff 쿼리 400 에러 없이 응답 — display_name 미포함 select 검증
 * SC-4: 치료사 없는 케이스 — 빈 목록 or 안내 렌더 (에러 없음)
 * SC-5: Closing.tsx staff 쿼리도 동일 버그 수정 확인 — 일마감 페이지 직원 드롭다운 로드
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// 시드 데이터 없으면 연결 테스트 스킵
const SKIP_NO_SEED = !process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;

test.describe('T-20260523-foot-PKG-DEDUCT-THERAPIST — 치료사 드롭다운 버그 픽스', () => {

  // SC-1: 2번차트 > 패키지 회차 차감 > 치료사 드롭다운 렌더 확인
  test('SC-1: 2번차트 회차 차감 치료사 드롭다운 렌더됨', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    // 2번차트 탭 진입 (chart2 탭)
    const chart2Tab = page.getByRole('tab', { name: /2번차트|2번/ }).first();
    if (await chart2Tab.isVisible()) {
      await chart2Tab.click();
    }

    // 치료사 드롭다운 존재 확인
    const deductTherapistSelect = page.getByTestId('deduct-therapist-select');
    await expect(deductTherapistSelect).toBeVisible({ timeout: 10_000 });
  });

  // SC-2: 치료사 드롭다운에 1명 이상 치료사 로드 성공 (핵심 AC-1)
  test('SC-2: 치료사 드롭다운에 치료사 1명 이상 표시', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    // 2번차트 탭 이동
    const chart2Tab = page.getByRole('tab', { name: /2번차트|2번/ }).first();
    if (await chart2Tab.isVisible()) {
      await chart2Tab.click();
    }

    const deductTherapistSelect = page.getByTestId('deduct-therapist-select');
    await expect(deductTherapistSelect).toBeVisible({ timeout: 10_000 });

    // options 개수 확인: placeholder("선택") + 치료사 1명 이상
    const options = deductTherapistSelect.locator('option');
    const count = await options.count();
    // 버그 상태: count === 1 (placeholder만)
    // 픽스 상태: count >= 2 (치료사 1명 이상)
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // SC-3: staff 쿼리 네트워크 레벨 — 400 에러 없음 검증
  test('SC-3: staff 쿼리 400 에러 없음 (display_name 미포함 select)', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const staffQueryErrors: string[] = [];

    // Supabase REST API staff 쿼리 모니터링
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/rest/v1/staff') && response.status() >= 400) {
        staffQueryErrors.push(`${response.status()} ${url}`);
      }
    });

    const customerId = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID!;
    await page.goto(`${BASE_URL}/chart/${customerId}`);
    await page.waitForLoadState('networkidle');

    // staff 쿼리 400 에러 없어야 함
    expect(staffQueryErrors).toHaveLength(0);
  });

  // SC-4: 엣지 케이스 — 치료사 없는 경우 에러 없이 빈 목록 처리
  test('SC-4: 치료사 없는 경우 드롭다운이 오류 없이 렌더 (placeholder만 표시)', async ({ page }) => {
    // 이 테스트는 실제 DB에 therapist가 없는 clinic이 없으므로 구조 검증만
    // 실제 환경: therapistList=[] → <option value="">선택</option>만 존재
    test.skip(true, '별도 clinic 시드 없음 — 구조 테스트 skip');
  });

  // SC-5: 일마감 페이지 직원 드롭다운 로드 확인 (Closing.tsx 동일 버그 수정)
  test('SC-5: 일마감 페이지 직원 드롭다운 정상 로드', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');

    const closingErrors: string[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/rest/v1/staff') && response.status() >= 400) {
        closingErrors.push(`${response.status()} ${url}`);
      }
    });

    await page.goto(`${BASE_URL}/closing`);
    await page.waitForLoadState('networkidle');

    // staff 쿼리 400 에러 없어야 함
    expect(closingErrors).toHaveLength(0);
  });
});
