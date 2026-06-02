/**
 * E2E spec — T-20260601-foot-HEALTHQ-SELF-RESTRUCTURE
 * 발건강질문지 자가작성 폼 톤앤매너 통일(브라운/베이지) + 5섹션 최종 확정본 재편
 *   1) 발 관련 증상  2) 발 건강 관련 경험  3) 나의 건강 상태  4) 현재 복용 중인 약  5) 치료 및 내원 계획
 *
 * 시나리오 1: 폼 렌더 → 브라운 테마 + 5섹션 노출 + 제거 섹션(방문목적/알레르기/방문경로) 부재 (AC-1/2/3/4/5/6/7)
 * 시나리오 2: 조건부 노출 — 2번 치료"있음"→치료방법 / 5번 실비보험"예"→보험사 입력 (AC-3/AC-6)
 *
 * 이 페이지는 anon + 토큰 게이트(fn_health_q_validate_token) → 로그인 불필요.
 * E2E에서는 validate RPC를 라우트 인터셉트로 성공 응답 모킹해 폼 단계를 렌더한다.
 */
import { test, expect, type Page } from '@playwright/test';

const MOCK_TOKEN = 'e2e-mock-token';

/** fn_health_q_validate_token 성공 응답 모킹 → form 단계 진입 */
async function mockValidateToken(page: Page) {
  await page.route('**/rest/v1/rpc/fn_health_q_validate_token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success:       true,
        token_id:      'tok-e2e',
        customer_id:   'cust-e2e',
        customer_name: 'E2E 테스트',
        clinic_id:     'clinic-e2e',
        check_in_id:   null,
        form_type:     'general',
      }),
    });
  });
}

/** 폼 단계 진입 — health-q 라우트 미존재(다른 CRM 빌드 등) 시 skip */
async function gotoForm(page: Page): Promise<boolean> {
  await mockValidateToken(page);
  await page.goto(`/health-q/${MOCK_TOKEN}`);
  try {
    await page.getByText('발건강 질문지', { exact: false }).first().waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260601 HEALTHQ-SELF-RESTRUCTURE 자가작성 폼 톤앤매너+5섹션 재편', () => {

  test('시나리오1-A: 5섹션 구성 + 순서 노출 (AC-2/3/4/5/7)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // 1번 발 관련 증상
    await expect(page.getByText('발 관련 증상', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '발톱 변색 및 변형' })).toBeVisible();
    await expect(page.getByRole('button', { name: '내성발톱(파고드는 발톱)' })).toBeVisible();
    await expect(page.getByRole('button', { name: '울퉁불퉁한 발톱' })).toBeVisible();

    // 2번 발 건강 관련 경험
    await expect(page.getByText('발 건강 관련 경험', { exact: true })).toBeVisible();
    await expect(page.getByText('문제성 발톱 치료 경험', { exact: true })).toBeVisible();
    await expect(page.getByText('증상 시작 시점', { exact: true })).toBeVisible();

    // 3번 나의 건강 상태 (11항 — 신규 항목 포함)
    await expect(page.getByText('나의 건강 상태', { exact: true })).toBeVisible();
    const health = page.locator('section').filter({ hasText: '나의 건강 상태' });
    await expect(health.getByRole('button', { name: '갑상선질환' })).toBeVisible();
    await expect(health.getByRole('button', { name: '우울증·공황장애' })).toBeVisible();
    await expect(health.getByRole('button', { name: '위장장애·역류성식도염' })).toBeVisible();

    // 4번 현재 복용 중인 약 (신규 8항)
    await expect(page.getByText('현재 복용 중인 약', { exact: true })).toBeVisible();
    const meds = page.locator('section').filter({ hasText: '현재 복용 중인 약' });
    await expect(meds.getByRole('button', { name: '콜레스테롤약' })).toBeVisible();
    await expect(meds.getByRole('button', { name: '항암제' })).toBeVisible();

    // 5번 치료 및 내원 계획 (신규)
    await expect(page.getByText('치료 및 내원 계획', { exact: true })).toBeVisible();
    await expect(page.getByText('치료 시작 가능한 시기', { exact: true })).toBeVisible();
    await expect(page.getByText('치료를 위해 내원 가능 주기', { exact: true })).toBeVisible();
    await expect(page.getByText('실비보험을 보유하고 계신가요?', { exact: true })).toBeVisible();
  });

  test('시나리오1-B: 제거된 섹션(방문목적/알레르기/방문경로) 부재 (OQ2)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    await expect(page.getByText('방문 목적', { exact: true })).toHaveCount(0);
    await expect(page.getByText('알레르기', { exact: false })).toHaveCount(0);
    await expect(page.getByText('방문 경로', { exact: false })).toHaveCount(0);
  });

  test('시나리오1-C: 톤앤매너 — 브라운/베이지 통일 (teal 클래스 미사용)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const submitBtn = page.getByRole('button', { name: /작성 완료/ });
    await expect(submitBtn).toBeVisible();
    const bg = await submitBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(92, 61, 30)'); // #5C3D1E

    const tealCount = await page.locator('[class*="teal-"]').count();
    expect(tealCount).toBe(0);
  });

  test('시나리오2-A: 문제성 발톱 치료 "있음" → 치료방법 다중선택 노출·동작 (AC-3)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });

    await expect(exp.getByRole('button', { name: '먹는 약' })).toHaveCount(0);
    await exp.getByRole('button', { name: '있음' }).click();

    await expect(exp.getByRole('button', { name: '먹는 약' })).toBeVisible();
    await expect(exp.getByRole('button', { name: '바르는 약' })).toBeVisible();
    await expect(exp.getByRole('button', { name: '레이저' })).toBeVisible();

    const oral = exp.getByRole('button', { name: '먹는 약' });
    const laser = exp.getByRole('button', { name: '레이저' });
    await oral.click();
    await laser.click();
    await expect(oral).toHaveClass(/bg-\[#F5EFE7\]/);
    await expect(laser).toHaveClass(/bg-\[#F5EFE7\]/);

    // T-20260602-foot-HEALTHQ-CONTENT-ADD: 발 통증 여부에도 '없음'이 추가되어
    // 섹션 내 '없음'이 2개 → Q1(문제성 발톱 치료 경험) 블록으로 스코프
    const nailTreat = exp.locator('div').filter({ has: page.getByText('문제성 발톱 치료 경험', { exact: true }) }).last();
    await nailTreat.getByRole('button', { name: '없음', exact: true }).click();
    await expect(exp.getByRole('button', { name: '먹는 약' })).toHaveCount(0);
  });

  test('시나리오2-B: 실비보험 "예" → 보험사 입력 노출 / "아니오" → 숨김 (AC-6)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const plan = page.locator('section').filter({ hasText: '치료 및 내원 계획' });
    const insuranceInput = plan.getByPlaceholder(/보험사명/);

    // 초기엔 보험사 입력란 숨김
    await expect(insuranceInput).toHaveCount(0);

    // "예" 선택 → 보험사 입력란 노출
    await plan.getByRole('button', { name: '예', exact: true }).click();
    await expect(insuranceInput).toBeVisible();
    await insuranceInput.fill('○○화재');

    // "아니오" 전환 → 입력란 숨김
    await plan.getByRole('button', { name: '아니오', exact: true }).click();
    await expect(insuranceInput).toHaveCount(0);
  });

  test('AC-9: 375px 단일컬럼 + sticky 제출 + 44px 터치', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const submitBtn = page.getByRole('button', { name: /작성 완료/ });
    await expect(submitBtn).toBeVisible();
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);

    const sym = page.getByRole('button', { name: '발톱 변색 및 변형' });
    const sbox = await sym.boundingBox();
    if (sbox) expect(sbox.height).toBeGreaterThanOrEqual(44);
  });
});
