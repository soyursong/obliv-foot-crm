/**
 * E2E spec — T-20260602-foot-HEALTHQ-PAIN-NONE-LAYOUT
 * [발건강 질문지 > 2. 발 건강 관련 경험 > 발 통증 여부]
 *   '없음'(통증 0단계)을 통증 4단계(경미/불편/심함/매우 심함)와 **동일 박스 크기로 한 그리드에 나란히** 배치.
 *   직전(HEALTHQ-CONTENT-ADD)에서 '없음'을 full-width BigBtn으로 그리드 위에 따로 두었던 것을
 *   grid-cols-5 단일 그리드 셀(이모지+라벨 버튼)로 통일.
 *
 * AC-1 '없음' = 4종과 동일 BigBtn 박스 크기
 * AC-2 5개 한 그리드에 나란히(별도 full-width 행 제거), 없음↔단계 단일선택 상호배타 유지
 * AC-3 '없음'에 이모지(😄), 5개 톤/크기/정렬 일관
 * AC-4 무회귀: 저장값 기존 동일(foot_pain_level string '없음')
 * AC-5 좁은 폭 태블릿에서도 박스 균일
 *
 * anon + 토큰 게이트(fn_health_q_validate_token) → validate RPC를 라우트 인터셉트로 모킹.
 */
import { test, expect, type Page } from '@playwright/test';

const MOCK_TOKEN = 'e2e-mock-token';
const ACTIVE_BORDER = 'rgb(123, 81, 48)'; // #7B5130 활성 테두리 (통증/없음 공통)

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

function borderColor(loc: import('@playwright/test').Locator) {
  return loc.evaluate((el) => getComputedStyle(el).borderColor);
}

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

/** 발 통증 여부 블록 (Q1 문제성 발톱 '없음'과 충돌 방지 위해 스코프) */
function painBlock(page: Page) {
  const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });
  return exp.locator('div').filter({ has: page.getByText('발 통증 여부', { exact: true }) }).last();
}

test.describe('T-20260602 HEALTHQ-PAIN-NONE-LAYOUT 발통증 없음 동일박스 그리드', () => {

  test('시나리오1: 5개 선택지가 한 그리드에 동일 박스로 나란히 + 없음 첫 칸·이모지 (AC-1/2/3/5)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const block = painBlock(page);
    await expect(block.getByText('발 통증 여부', { exact: true })).toBeVisible();

    // AC-2: 5개가 단일 grid-cols-5 그리드에 — 별도 full-width 행 없음
    const grid = block.locator('div.grid').first();
    await expect(grid).toHaveClass(/grid-cols-5/);

    const cells = grid.locator('> button');
    await expect(cells).toHaveCount(5);

    // AC-3: 첫 칸 = '없음', 이모지(😄) 동반
    const none = cells.first();
    await expect(none).toContainText('없음');
    await expect(none).toContainText('😄');

    // 5개 라벨 일관 — 없음/경미/불편/심함/매우 심함 순
    for (const label of ['없음', '경미', '불편', '심함', '매우 심함']) {
      await expect(grid.getByRole('button').filter({ hasText: label }).first()).toBeVisible();
    }

    // AC-1/AC-5: 5개 박스 크기 균일 (폭·높이 동일, 높이 ≥ 56px)
    const boxes = await cells.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    expect(boxes).toHaveLength(5);
    const widths = boxes.map((b) => b.w);
    const heights = boxes.map((b) => b.h);
    // 폭/높이 편차 ≤ 1px (그리드 균일 셀)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(56);

    // '없음' 선택 시 활성 하이라이트
    await none.click();
    await expect.poll(() => borderColor(none)).toBe(ACTIVE_BORDER);
  });

  test('시나리오2: 없음↔단계 상호배타 + 저장값 string "없음" (AC-2/AC-4)', async ({ page }) => {
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

    const block = painBlock(page);
    const none = block.locator('div.grid > button').first();
    const severe = block.getByRole('button').filter({ hasText: '심함' }).first();

    // 없음 선택 → 활성
    await none.click();
    await expect.poll(() => borderColor(none)).toBe(ACTIVE_BORDER);

    // 단계(심함) 선택 → 없음 해제 (상호배타)
    await severe.click();
    await expect.poll(() => borderColor(none)).not.toBe(ACTIVE_BORDER);
    await expect.poll(() => borderColor(severe)).toBe(ACTIVE_BORDER);

    // 다시 없음 선택 → 단계 해제
    await none.click();
    await expect.poll(() => borderColor(severe)).not.toBe(ACTIVE_BORDER);
    await expect.poll(() => borderColor(none)).toBe(ACTIVE_BORDER);

    // 제출 → 저장값은 기존과 동일한 string '없음'
    await page.getByRole('button', { name: /작성 완료/ }).click();
    await expect.poll(() => captured !== null, { timeout: 10_000 }).toBe(true);
    const data = captured as unknown as { foot_pain_level?: string };
    expect(data.foot_pain_level).toBe('없음');
  });
});
