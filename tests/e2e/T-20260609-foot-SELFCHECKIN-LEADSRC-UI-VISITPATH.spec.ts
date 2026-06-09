/**
 * T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH
 * 셀프접수 워크인 유입경로 UI 4대그룹 2×2 개편 + 고객차트 방문경로 대/소분류 자동 연동
 *
 * AC-1: 워크인 동선 → 유입경로 4대그룹(SNS/검색/지인소개/제휴·기타) 2×2 그리드 렌더
 * AC-2: 세부 선택지 노출 (SNS→4종 / 검색→2종 / 제휴·기타→세부 없음)
 * AC-3: 지인소개 → 성함 입력칸 신규 노출 (빈값 허용)
 * AC-4: 매핑/완성 로직 — 대분류 워크인 + 소분류 유입경로 (UI 레벨 검증; 차트 저장은 RPC 경유)
 * AC-5: 예약 동선 회귀 — 유입경로 미표시 (LEADSRC-COND 유지)
 *
 * 주의: 고객차트 visit_route(_detail) 실제 저장은 fn_selfcheckin_update_personal_info RPC + DB-gate
 * 적용 후 backend 통합 검증 대상. 본 spec 은 UI 동선/렌더/완성 게이트를 커버한다.
 */
import { test, expect } from '@playwright/test';

const CHECKIN_URL = '/checkin/jongno-foot';

async function gotoWalkin(page: import('@playwright/test').Page) {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
  await expect(page.getByText('당일 예약 상황에 따라')).toBeVisible({ timeout: 3_000 });
  await page.getByRole('button', { name: '확인 후 접수하기' }).click();
}

test.describe('T-20260609 유입경로 4대그룹 2×2 + 차트 연동', () => {
  test('AC-1: 워크인 → 4대그룹 2×2 그리드 렌더', async ({ page }) => {
    await gotoWalkin(page);

    const groups = page.getByTestId('leadsource-groups');
    await expect(groups).toBeVisible({ timeout: 2_000 });
    // 2×2 그리드 = grid-cols-2
    await expect(groups).toHaveClass(/grid-cols-2/);

    await expect(page.getByTestId('leadsource-sns')).toBeVisible();
    await expect(page.getByTestId('leadsource-search')).toBeVisible();
    await expect(page.getByTestId('leadsource-referral')).toBeVisible();
    await expect(page.getByTestId('leadsource-partner_etc')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/visitpath-4groups-2x2.png',
      fullPage: true,
    });
  });

  test('AC-2: SNS 세부 4종 / 검색 세부 2종 노출', async ({ page }) => {
    await gotoWalkin(page);

    // SNS → 인스타/페북/틱톡유튜브/블로그카페
    await page.getByTestId('leadsource-sns').click();
    await expect(page.getByTestId('leadsource-sns-detail')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('leaddetail-instagram')).toBeVisible();
    await expect(page.getByTestId('leaddetail-facebook')).toBeVisible();
    await expect(page.getByTestId('leaddetail-tiktok_youtube')).toBeVisible();
    await expect(page.getByTestId('leaddetail-blog_cafe')).toBeVisible();

    // 검색 → 네이버/구글
    await page.getByTestId('leadsource-search').click();
    await expect(page.getByTestId('leadsource-search-detail')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('leaddetail-naver')).toBeVisible();
    await expect(page.getByTestId('leaddetail-google')).toBeVisible();
    // SNS 세부는 더 이상 표시 안됨
    await expect(page.getByTestId('leadsource-sns-detail')).not.toBeVisible();
  });

  test('AC-2b: 제휴·기타 → 세부 입력 없이 즉시 완성', async ({ page }) => {
    await gotoWalkin(page);

    await page.locator('#sc-name').fill('제휴기타테스트');
    for (const d of ['0', '1', '0', '1', '1', '1', '1', '2', '2', '2', '2']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await page.getByTestId('leadsource-partner_etc').click();
    // 세부 선택 없이 바로 완성 → 접수 활성
    await expect(submitBtn).toBeEnabled();
    // 세부 영역 미노출
    await expect(page.getByTestId('leadsource-sns-detail')).not.toBeVisible();
    await expect(page.getByTestId('leadsource-search-detail')).not.toBeVisible();
    await expect(page.getByTestId('leadsource-referral-name')).not.toBeVisible();
  });

  test('AC-3: 지인소개 → 성함 입력칸 노출 (빈값 허용)', async ({ page }) => {
    await gotoWalkin(page);

    await page.locator('#sc-name').fill('지인소개테스트');
    for (const d of ['0', '1', '0', '3', '3', '3', '3', '4', '4', '4', '4']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    const submitBtn = page.getByRole('button', { name: '접수하기' });
    await page.getByTestId('leadsource-referral').click();

    // 성함 입력칸 신규 노출
    const nameInput = page.getByTestId('leadsource-referral-name-input');
    await expect(nameInput).toBeVisible({ timeout: 2_000 });

    // 빈값이어도 접수 가능 (AC-3: 선택)
    await expect(submitBtn).toBeEnabled();

    // 성함 입력 시 확인 화면 요약에 반영
    await nameInput.fill('홍길동');
    await submitBtn.click();
    await expect(page.getByText('접수 정보 확인')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('홍길동')).toBeVisible();
  });

  test('AC-4: SNS_인스타그램 선택 → 완성 게이트 (대분류 선택만으론 미완성)', async ({ page }) => {
    await gotoWalkin(page);

    await page.locator('#sc-name').fill('인스타테스트');
    for (const d of ['0', '1', '0', '5', '5', '5', '5', '6', '6', '6', '6']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }

    const submitBtn = page.getByRole('button', { name: '접수하기' });
    // SNS 대분류만 선택 → 세부 미선택이라 아직 비활성
    await page.getByTestId('leadsource-sns').click();
    await expect(submitBtn).toBeDisabled();
    // 인스타그램 세부 선택 → 완성 → 활성
    await page.getByTestId('leaddetail-instagram').click();
    await expect(submitBtn).toBeEnabled();
  });

  test('AC-5: 예약 동선 회귀 — 유입경로 미표시', async ({ page }) => {
    await page.goto(CHECKIN_URL);
    await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '예약하고 왔어요' }).click();
    await page.locator('button').filter({ hasText: '초진' }).first().click();

    await expect(page.getByTestId('leadsource-groups')).not.toBeVisible();
  });
});
