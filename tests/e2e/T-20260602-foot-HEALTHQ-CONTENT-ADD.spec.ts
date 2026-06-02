/**
 * E2E spec — T-20260602-foot-HEALTHQ-CONTENT-ADD
 * 발건강질문지 자가작성표 항목 2개 추가
 *   항목 1: [3. 나의 건강 상태]   → "임신중 또는 임신준비중" 선택지(체크박스) 추가  (AC-1)
 *   항목 2: [2. 발 건강 관련 경험 > 발 통증 여부] → "없음" 선택지 추가              (AC-2)
 *
 * AC-3(정합): 폼 스키마/저장 구조 변경 없음 — form_data(JSONB)의 기존 필드 재사용.
 *   · 임신 항목 → medical_history 배열에 신규 값 1개 추가(기존 string[] 필드)
 *   · 발 통증 "없음" → foot_pain_level 단일 string 필드에 '없음' 저장 (통증단계와 상호배타)
 * AC-4(양면): 자가작성 화면(본 폼) + 내부 조회(2번차트 [내용보기]=HealthQResultsPanel)
 *   양쪽 반영. 조회 측은 medical_history/foot_pain_level 키를 이미 렌더하므로 자동 반영.
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

// BigBtn 활성 테두리색 (color scheme별) — HealthQMobilePage BigBtn 참조
const ACTIVE_EMERALD = 'rgb(123, 81, 48)'; // #7B5130 (emerald/teal 활성)
const ACTIVE_AMBER   = 'rgb(245, 158, 11)'; // amber-500 (amber 활성, 나의 건강 상태 항목)

/** locator의 borderColor가 expected가 될 때까지 poll (React state flush 대기) */
function borderColor(loc: import('@playwright/test').Locator) {
  return loc.evaluate((el) => getComputedStyle(el).borderColor);
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

test.describe('T-20260602 HEALTHQ-CONTENT-ADD 자가작성표 항목 추가', () => {

  test('시나리오1-A: [발 통증 여부] "없음" 선택지 노출·선택 (AC-2)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });
    await expect(exp.getByText('발 통증 여부', { exact: true })).toBeVisible();

    // 발 통증 여부 블록으로 스코프 (Q1 문제성 발톱 치료에도 '없음'이 있어 strict mode 충돌 방지)
    const painBlock = exp.locator('div').filter({ has: page.getByText('발 통증 여부', { exact: true }) }).last();

    // "없음" 선택지 노출
    // T-20260602-foot-HEALTHQ-PAIN-NONE-LAYOUT: '없음'이 이모지+텍스트 2-span 버튼(통증단계와
    // 동일 그리드 셀)으로 통일 → name exact 매칭 불가, hasText 필터로 변경.
    const none = painBlock.getByRole('button').filter({ hasText: '없음' }).first();
    await expect(none).toBeVisible();

    // 선택 → 활성(브라운/베이지 하이라이트) 표시
    await none.click();
    await expect.poll(() => borderColor(none)).toBe(ACTIVE_EMERALD);

    // 통증 단계(심함)와 상호배타 — 단계 선택 시 "없음" 해제
    // (이모지+텍스트 2-span 버튼이라 name exact 매칭 불가 → hasText 필터)
    await painBlock.getByRole('button').filter({ hasText: '심함' }).first().click();
    await expect.poll(() => borderColor(none)).not.toBe(ACTIVE_EMERALD);
  });

  test('시나리오1-B: [나의 건강 상태] "임신중 또는 임신준비중" 노출·체크 (AC-1)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const health = page.locator('section').filter({ hasText: '나의 건강 상태' });
    const preg = health.getByRole('button', { name: '임신중 또는 임신준비중', exact: true });
    await expect(preg).toBeVisible();

    // 체크(선택) → 활성 표시 (나의 건강 상태 항목 = amber 스킴)
    await preg.click();
    await expect.poll(() => borderColor(preg)).toBe(ACTIVE_AMBER);

    // 기존 항목(당뇨)과 다중선택 공존 가능
    const dm = health.getByRole('button', { name: '당뇨', exact: true });
    await dm.click();
    await expect.poll(() => borderColor(preg)).toBe(ACTIVE_AMBER);
  });

  test('시나리오1-C: "없음" 토글(나의 건강 상태) 선택 시 임신 항목 함께 해제 (AC-3 정합)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const health = page.locator('section').filter({ hasText: '나의 건강 상태' });
    const preg = health.getByRole('button', { name: '임신중 또는 임신준비중', exact: true });

    await preg.click();
    await expect.poll(() => borderColor(preg)).toBe(ACTIVE_AMBER);

    // 섹션 내 "없음" 토글 → medical_history 비움 → 임신 항목 비활성
    await health.getByRole('button', { name: '없음', exact: true }).click();
    await expect.poll(() => borderColor(preg)).not.toBe(ACTIVE_AMBER);
  });

  test('시나리오2: 제출 payload 검증 — form_data 기존 필드에 신규 값 매핑 (AC-3)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // submit RPC 가로채 payload 캡처 (실제 저장 없이 성공 응답)
    let captured: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/fn_health_q_submit', async (route) => {
      try {
        const body = route.request().postDataJSON() as { p_form_data?: Record<string, unknown> };
        captured = body?.p_form_data ?? null;
      } catch { /* noop */ }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    const exp = page.locator('section').filter({ hasText: '발 건강 관련 경험' });
    const painBlock = exp.locator('div').filter({ has: page.getByText('발 통증 여부', { exact: true }) }).last();
    // PAIN-NONE-LAYOUT: '없음' 이모지+텍스트 2-span 버튼 → hasText 필터
    await painBlock.getByRole('button').filter({ hasText: '없음' }).first().click();

    const health = page.locator('section').filter({ hasText: '나의 건강 상태' });
    await health.getByRole('button', { name: '임신중 또는 임신준비중', exact: true }).click();

    await page.getByRole('button', { name: /작성 완료/ }).click();

    await expect.poll(() => captured !== null, { timeout: 10_000 }).toBe(true);
    const data = captured as unknown as { foot_pain_level?: string; medical_history?: string[] };
    expect(data.foot_pain_level).toBe('없음');
    expect(data.medical_history).toContain('임신중 또는 임신준비중');
  });
});
