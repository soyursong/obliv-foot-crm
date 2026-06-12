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
 *
 * ── T-20260613-foot-VISITPATH-SPEC-REFRESH (테스트 부채 갱신) ──────────────────
 *   기존 spec 은 deprecated slug `/checkin/jongno-foot` 로 진입 → CheckinRoute 가
 *   foot-checkin.pages.dev canonical 로 강제 리다이렉트(App.tsx DEPRECATED_CHECKIN_CANONICAL)
 *   하여 native SelfCheckIn 이 렌더되지 않아 6건 전부 사전 실패.
 *   해소: 비-deprecated slug `/checkin/e2e-foot` + clinics route mock(공유 DB 비의존) 으로
 *   native 렌더 복구. anon 공개 라우트라 빈 storageState 로 auth 의존 제거.
 *   (T-20260613-foot-SELFCHECKIN-BANNER-NAME / T-20260601-foot-SELFLOGIN-RESV-LIST-QR 패턴 재사용)
 */
import { test, expect } from '@playwright/test';

// /checkin 은 anon 공개 라우트 — 빈 storageState 로 auth 의존 제거.
test.use({ storageState: { cookies: [], origins: [] } });

// 비-deprecated slug 사용해야 native SelfCheckIn 이 렌더된다 (jongno-foot 은 canonical 리다이렉트).
const CHECKIN_URL = '/checkin/e2e-foot';
const CLINIC_GLOB = '**/rest/v1/clinics*';
const CLINIC_ROW = { id: 'clinic-e2e-foot', name: '오블리브 풋센터(E2E)' };

// 공유 DB 실 clinic 비의존 — clinics 조회를 route mock 으로 가로채 결정론 확보.
test.beforeEach(async ({ page }) => {
  await page.route(CLINIC_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLINIC_ROW) }),
  );
});

async function gotoWalkin(page: import('@playwright/test').Page) {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수')).toBeVisible({ timeout: 10_000 });
  // 1단계: 예약 없이 방문(워크인) 선택 → 안내 팝업
  await page.getByTestId('btn-walkin').click();
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

    // 성함 입력 시 최종 확인 화면 요약에 반영
    // 워크인=초진(visitType=new)이라 접수하기 → 개인정보 입력(personal_info) 단계를 거쳐 confirm 도달.
    // (T-20260529-foot-SELFCHECKIN-FLOW-REVAMP 로 personal_info 단계 신설됨)
    await nameInput.fill('홍길동');
    await submitBtn.click();

    // personal_info 단계: RRN(생년월일 6자리) + 주소 + 개인정보 동의(워크인 필수) 채우고 다음
    await expect(page.getByText('개인 정보 입력')).toBeVisible({ timeout: 5_000 });
    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).click();
    }
    await page.getByTestId('pi-address-input').fill('서울시 종로구 1');
    await page.getByTestId('pi-consent-checkbox').check();
    const nextBtn = page.getByTestId('btn-personal-info-next');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // 최종 확인 화면 — 유입경로 요약에 지인소개 성함(홍길동) 반영
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

    // 예약하고 왔어요 → 초진 선택 (예약 동선에서는 유입경로 미노출)
    await page.getByTestId('btn-reserved').click();
    await page.getByTestId('btn-visit-new').click();

    await expect(page.getByTestId('leadsource-groups')).not.toBeVisible();
  });
});
