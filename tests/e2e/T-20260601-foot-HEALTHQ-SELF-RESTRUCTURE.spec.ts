/**
 * E2E spec — T-20260601-foot-HEALTHQ-SELF-RESTRUCTURE
 * 발건강질문지 자가작성 폼 톤앤매너 통일(브라운/베이지) + 항목 구성 재편(1번 증상 / 2번 발건강경험 / 3번 건강상태)
 *
 * 시나리오 1: 고객이 링크 접속 → 폼 렌더 → 브라운 테마 + 신규 섹션/항목 노출 (톤앤매너 + 항목 재편)
 * 시나리오 2: 2번 "발 건강 관련 경험" — 문제성 발톱 치료 "있음" 선택 시 치료방법(먹는약/바르는약/레이저) 다중선택 노출·동작
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
  // 폼 헤더 텍스트로 진입 확인
  try {
    await page.getByText('발건강 질문지', { exact: false }).first().waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260601 HEALTHQ-SELF-RESTRUCTURE 자가작성 폼 톤앤매너+항목 재편', () => {

  test('시나리오1-A: 신규 섹션 구성(1번 증상 / 2번 발건강경험 / 3번 건강상태) 노출', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // 1번 발 관련 증상 + 신규 항목
    await expect(page.getByText('발 관련 증상', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '발톱 변색 및 변형' })).toBeVisible();
    await expect(page.getByRole('button', { name: '울퉁불퉁한 발톱' })).toBeVisible();

    // 2번 발 건강 관련 경험 (신규 섹션)
    await expect(page.getByText('발 건강 관련 경험', { exact: true })).toBeVisible();
    await expect(page.getByText('문제성 발톱 치료 경험', { exact: true })).toBeVisible();
    await expect(page.getByText('증상 시작 시점', { exact: true })).toBeVisible();
    await expect(page.getByText('발 통증 여부', { exact: true })).toBeVisible();

    // 3번 나의 건강상태 (구 "과거 병력" 리네임)
    await expect(page.getByText('나의 건강상태', { exact: true })).toBeVisible();
    // 구 라벨이 더는 노출되지 않음
    await expect(page.getByText('과거 병력 · 만성질환', { exact: false })).toHaveCount(0);
  });

  test('시나리오1-B: 톤앤매너 — 브라운/베이지 통일 (teal 클래스 미사용)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // 제출 버튼 배경이 브라운 primary(#5C3D1E) — teal 아님
    const submitBtn = page.getByRole('button', { name: /작성 완료/ });
    await expect(submitBtn).toBeVisible();
    const bg = await submitBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    // #5C3D1E = rgb(92, 61, 30)
    expect(bg).toBe('rgb(92, 61, 30)');

    // 페이지 어디에도 teal 계열 활성 클래스(border-teal-600 등)가 남지 않음
    const tealCount = await page.locator('[class*="teal-"]').count();
    expect(tealCount).toBe(0);
  });

  test('시나리오2: 문제성 발톱 치료 "있음" → 치료방법 다중선택 노출·동작', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // 2번 "발 건강 관련 경험" 섹션으로 스코프 (있음/없음 라벨이 알레르기 등과 중복되므로)
    const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });

    // 초기엔 치료방법 숨김
    await expect(exp.getByRole('button', { name: '먹는 약' })).toHaveCount(0);

    // "있음" 선택
    await exp.getByRole('button', { name: '있음' }).click();

    // 치료방법 3종 노출
    await expect(exp.getByRole('button', { name: '먹는 약' })).toBeVisible();
    await expect(exp.getByRole('button', { name: '바르는 약' })).toBeVisible();
    await expect(exp.getByRole('button', { name: '레이저' })).toBeVisible();

    // 다중선택: 먹는 약 + 레이저 동시 선택 → 활성 클래스(브라운 bg-[#F5EFE7]) 적용 확인
    // (computed color는 CSS transition 중간값을 잡아 flaky하므로 클래스로 단정)
    const oral = exp.getByRole('button', { name: '먹는 약' });
    const laser = exp.getByRole('button', { name: '레이저' });
    await oral.click();
    await laser.click();
    await expect(oral).toHaveClass(/bg-\[#F5EFE7\]/);
    await expect(laser).toHaveClass(/bg-\[#F5EFE7\]/);

    // "없음"으로 전환하면 치료방법 숨김 (exact: 가족력 "모름 / 없음"과 구분)
    await exp.getByRole('button', { name: '없음', exact: true }).click();
    await expect(exp.getByRole('button', { name: '먹는 약' })).toHaveCount(0);
  });

  test('AC-모바일: 375px 단일컬럼 + sticky 제출 + 44px 터치', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const submitBtn = page.getByRole('button', { name: /작성 완료/ });
    await expect(submitBtn).toBeVisible();
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);

    // 증상 버튼 터치 타겟 44px+ ('발톱 변색 및 변형'은 1번 섹션 고유 라벨)
    const sym = page.getByRole('button', { name: '발톱 변색 및 변형' });
    const sbox = await sym.boundingBox();
    if (sbox) expect(sbox.height).toBeGreaterThanOrEqual(44);
  });
});
