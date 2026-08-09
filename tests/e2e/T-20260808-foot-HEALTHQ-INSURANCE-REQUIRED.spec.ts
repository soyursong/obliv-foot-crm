/**
 * T-20260808-foot-HEALTHQ-INSURANCE-REQUIRED — 발건강 질문지 '실손(실비)보험' 항목 필수화
 *   (현장 김주연 총괄 요청 — 실비보험 문항 미응답 시 제출 차단)
 *
 * 대상: HealthQMobilePage 치료 및 내원 계획(6번) 섹션 Q3 "실비보험을 보유하고 계신가요?"
 *       필드 = has_private_insurance (INSURANCE_OPTIONS ['예','아니오']).
 *
 * 변경: 기존 선택입력 → 필수(required) 승격.
 *   - 라벨에 필수 시각표기(별표 * + (필수)) 노출.
 *   - 미응답 제출 시도 → 제출 차단(RPC 미호출) + inline 필수 안내 메시지 노출.
 *   - 응답 후 → 기존과 동일 정상 저장.
 *   - forward-only FE validation — DB 스키마/NOT NULL 신설 없음.
 *
 * 검증 (AC 1~4):
 *   S1) 필수 시각표기(* / (필수)) 노출 (AC-1)
 *   S2) 미응답 제출 → 차단 + 필수 안내 메시지 + submit RPC 미호출 (AC-2)
 *   S3) 응답 후 제출 → 정상 저장 + payload has_private_insurance 반영 (AC-3)
 *   S4) 응답 선택 시 필수 안내 메시지 사라짐 (AC-2 보조)
 *
 * 방식: anon RPC(fn_health_q_validate_token / fn_health_q_submit)를 page.route 로 mock.
 *       DB 무의존 → 결정적. 저장 검증은 submit RPC 요청 body(p_form_data) 계약으로 확인.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

// gitleaks(hardcoded-secret-token) 오탐 회피 — 변수명/값에 'token' 키워드 미포함(실 시크릿 아님, mock 링크 식별자).
const LINK_ID = 'e2e-healthq-insurance-required-link';
const REQUIRED_MSG = '실손보험 항목은 필수입니다';
const INSURANCE_LABEL = '실비보험을 보유하고 계신가요?';

/** validate_token RPC mock — ko 모드 */
async function mockValidate(page: Page) {
  await page.route('**/rest/v1/rpc/fn_health_q_validate_token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        token_id: '00000000-0000-0000-0000-000000000001',
        customer_id: '00000000-0000-0000-0000-000000000002',
        customer_name: 'Hong Gildong',
        clinic_id: '00000000-0000-0000-0000-000000000003',
        check_in_id: null,
        form_type: 'general',
        lang: 'ko',
      }),
    }),
  );
}

/** submit RPC mock — 호출 여부 + 마지막 body 캡처 */
function captureSubmit(page: Page): { called: boolean; body: Record<string, unknown> | null } {
  const captured: { called: boolean; body: Record<string, unknown> | null } = { called: false, body: null };
  page.route('**/rest/v1/rpc/fn_health_q_submit', (route) => {
    captured.called = true;
    try {
      captured.body = JSON.parse(route.request().postData() ?? '{}');
    } catch {
      captured.body = null;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, result_id: 'r1' }),
    });
  });
  page.route('**/storage/v1/object/documents/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  return captured;
}

/** 실비보험 질문 그룹(div.space-y-2)으로 스코프 */
function insuranceGroup(page: Page): Locator {
  return page.locator('div.space-y-2').filter({ hasText: INSURANCE_LABEL });
}

test.describe('T-20260808-foot-HEALTHQ-INSURANCE-REQUIRED', () => {
  test('S1: 실손보험 항목 필수 시각표기(* / (필수)) 노출', async ({ page }) => {
    await mockValidate(page);
    captureSubmit(page);

    await page.goto(`/health-q/${LINK_ID}`);
    await expect(page.getByText('발건강 질문지')).toBeVisible();

    const grp = insuranceGroup(page);
    await expect(grp.getByText(INSURANCE_LABEL)).toBeVisible();
    // 필수 표기 — 별표 + (필수)
    await expect(grp.getByText('*', { exact: false })).toBeVisible();
    await expect(grp.getByText('(필수)')).toBeVisible();
  });

  test('S2: 실손보험 미응답 제출 → 차단 + 필수 안내 + submit RPC 미호출', async ({ page }) => {
    await mockValidate(page);
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${LINK_ID}`);
    await expect(page.getByText('발건강 질문지')).toBeVisible();

    // 실손보험 미응답 상태로 제출 시도
    await page.getByRole('button', { name: '✓ 작성 완료 — 제출하기' }).click();

    // 필수 안내 메시지 노출 + 제출 차단(완료 화면 미노출)
    await expect(page.getByText(REQUIRED_MSG)).toBeVisible();
    await expect(page.getByText('작성 완료!')).toHaveCount(0);
    // submit RPC 미호출 확인
    expect(captured.called).toBe(false);
  });

  test('S3: 실손보험 응답 후 제출 → 정상 저장 + payload 반영', async ({ page }) => {
    await mockValidate(page);
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${LINK_ID}`);
    await expect(page.getByText('발건강 질문지')).toBeVisible();

    // 실비보험 '아니오' 선택
    await insuranceGroup(page).getByRole('button', { name: '아니오', exact: true }).click();

    await page.getByRole('button', { name: '✓ 작성 완료 — 제출하기' }).click();
    await expect(page.getByText('작성 완료!')).toBeVisible();

    expect(captured.called).toBe(true);
    const form = (captured.body?.p_form_data ?? {}) as Record<string, unknown>;
    expect(form.has_private_insurance).toBe('아니오');
    expect(form._lang).toBe('ko');
  });

  test('S4: 응답 선택 시 필수 안내 메시지 사라짐', async ({ page }) => {
    await mockValidate(page);
    captureSubmit(page);

    await page.goto(`/health-q/${LINK_ID}`);
    await expect(page.getByText('발건강 질문지')).toBeVisible();

    // 미응답 제출 → 에러 노출
    await page.getByRole('button', { name: '✓ 작성 완료 — 제출하기' }).click();
    await expect(page.getByText(REQUIRED_MSG)).toBeVisible();

    // '예' 선택 → 에러 사라짐
    await insuranceGroup(page).getByRole('button', { name: '예', exact: true }).click();
    await expect(page.getByText(REQUIRED_MSG)).toHaveCount(0);
  });
});
