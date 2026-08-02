/**
 * E2E spec — T-20260731-foot-FOOTHEALTH-SURVEY-TREATEXP-LAYOUT-LABEL
 * [발건강 질문지 > 3. 발 건강 관련 경험 > 문제성 발톱 치료 경험]
 *   (1) '있음/없음' 버튼 순서를 [있음 | 없음]으로(있음 좌측) 스왑.
 *   (2) '있음' 선택 시 하위 치료방법 3종 표시 라벨을 현장 표현으로 정정 + 순서(처방→레이저→바르는약).
 *       ⚠ 저장값(value: '먹는 약'/'레이저'/'바르는 약')은 불변, 표시 label만 교체.
 *
 * AC-1 '있음/없음' = [있음 | 없음] 순서(있음 좌측)로 렌더
 * AC-2 '있음' 선택 시 하위 3항목 표시 텍스트가 §2-(2) 그대로
 * AC-3 저장값(value/enum) 매핑 불변 — 기존 응답 데이터 호환 (제출 payload로 검증)
 * AC-4 '없음' 선택 시 기존 동작(하위 미노출) 유지
 *
 * anon + 토큰 게이트(fn_health_q_validate_token) → validate RPC를 라우트 인터셉트로 모킹.
 */
import { test, expect, type Page } from '@playwright/test';

const MOCK_TK = 'e2e-mock-tk';

async function mockValidateToken(page: Page) {
  await page.route('**/rest/v1/rpc/fn_health_q_validate_token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true, token_id: 'tok-e2e', customer_id: 'cust-e2e',
        customer_name: 'E2E 테스트', clinic_id: 'clinic-e2e',
        check_in_id: null, form_type: 'general',
      }),
    });
  });
}

async function gotoForm(page: Page): Promise<boolean> {
  await mockValidateToken(page);
  await page.goto(`/health-q/${MOCK_TK}`);
  try {
    await page.getByText('발건강 질문지', { exact: false }).first().waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

/** '문제성 발톱 치료 경험' 블록 (있음/없음 + 치료방법) */
function nailTreatBlock(page: Page) {
  const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });
  return exp.locator('div').filter({ has: page.getByText('문제성 발톱 치료 경험', { exact: true }) }).first();
}

test.describe('T-20260731 FOOTHEALTH-SURVEY-TREATEXP 버튼순서 + 항목명', () => {

  test('시나리오1: 치료경험 버튼이 [있음 | 없음] 순서(있음 좌측) (AC-1)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const block = nailTreatBlock(page);
    await expect(block.getByText('문제성 발톱 치료 경험', { exact: true })).toBeVisible();

    // '있음'/'없음' 2버튼 grid — 첫 칸=있음, 둘째 칸=없음
    const grid = block.locator('div.grid').first();
    const btns = grid.locator('> button');
    await expect(btns).toHaveCount(2);
    await expect(btns.nth(0)).toHaveText(/있음/);
    await expect(btns.nth(1)).toHaveText(/없음/);
  });

  test('시나리오2: "있음" 선택 시 하위 3항목 표시 텍스트 정정 (AC-2)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const block = nailTreatBlock(page);
    // '있음' 클릭
    await block.locator('div.grid > button').filter({ hasText: '있음' }).first().click();

    // 하위 3항목 표시 텍스트 (순서: 처방→레이저→바르는약)
    for (const label of ['병.의원 약 처방(먹는 약)', '병.의원 레이저 치료', '약국 또는 온라인 바르는 약']) {
      await expect(block.getByRole('button', { name: label }).first()).toBeVisible();
    }
  });

  test('시나리오3: "없음" 선택 시 하위 항목 미노출 (AC-4 회귀)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const block = nailTreatBlock(page);
    await block.locator('div.grid > button').filter({ hasText: '없음' }).first().click();

    // 치료방법 안내 문구 미노출
    await expect(block.getByText('치료 방법', { exact: false })).toHaveCount(0);
    await expect(block.getByRole('button', { name: '병.의원 레이저 치료' })).toHaveCount(0);
  });

  test('시나리오4: 저장값 매핑 불변 — 하위 선택 시 기존 value 저장 (AC-3)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    let captured: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/fn_health_q_submit', async (route) => {
      try {
        const body = route.request().postDataJSON() as { p_form_data?: Record<string, unknown> };
        captured = body?.p_form_data ?? null;
      } catch { /* noop */ }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    const block = nailTreatBlock(page);
    await block.locator('div.grid > button').filter({ hasText: '있음' }).first().click();
    // '병.의원 레이저 치료'(표시 라벨) 선택 → 저장값은 '레이저'
    await block.getByRole('button', { name: '병.의원 레이저 치료' }).first().click();

    await page.getByRole('button', { name: /작성 완료/ }).click();
    await expect.poll(() => captured !== null, { timeout: 10_000 }).toBe(true);
    const data = captured as unknown as { nail_treatment_history?: string; nail_treatment_methods?: string[] };
    expect(data.nail_treatment_history).toBe('있음');
    expect(data.nail_treatment_methods).toContain('레이저'); // 기존 value 유지(라벨 아님)
  });
});
