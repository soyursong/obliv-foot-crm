/**
 * T-20260625-foot-FOREIGN-HEALTHQ-EN — 외국인 전용 설문지(영문) + 발각질케어 신규 문항
 *
 * 검증 대상 (HealthQMobilePage 영문 분기):
 *   S1) 발각질케어(Foot callus care) → 신규 3문항 렌더 + 알레르기 Yes 시 입력칸 동적 노출
 *       + 제출 payload(form_data)에 visit_purpose/foot_concern_symptoms/has_allergy/allergies/_lang 정상 적재 (DA 확정 키)
 *   S2) 발톱무좀(Nail fungus) → 기존 발건강 질문지 "영문" 렌더 (한국어 하드코딩 제거 확인)
 *   S3) 무회귀 — lang 미지정(ko) → 기존 한국어 문진 정상 동작 + 내원목적 단계 미노출
 *
 * 방식: anon RPC(fn_health_q_validate_token / fn_health_q_submit)를 page.route 로 mock.
 *       DB 무의존 → 결정적. 저장 검증은 submit RPC 요청 body(form_data) 계약으로 확인.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN = 'e2e-foreign-healthq-token';

/** validate_token RPC mock — lang 파라미터로 ko/en 전환 */
async function mockValidate(page: Page, lang: 'ko' | 'en') {
  await page.route('**/rest/v1/rpc/fn_health_q_validate_token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        token_id: '00000000-0000-0000-0000-000000000001',
        customer_id: '00000000-0000-0000-0000-000000000002',
        customer_name: 'John Doe',
        clinic_id: '00000000-0000-0000-0000-000000000003',
        check_in_id: null,
        form_type: 'general',
        lang,
      }),
    }),
  );
}

/** submit RPC mock — 마지막 요청 body 캡처 + success 반환 */
function captureSubmit(page: Page): { body: Record<string, unknown> | null } {
  const captured: { body: Record<string, unknown> | null } = { body: null };
  page.route('**/rest/v1/rpc/fn_health_q_submit', (route) => {
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
  // documents 버킷 업로드(optional 백업)도 무력화 — 실패해도 제출은 진행되지만 노이즈 제거
  page.route('**/storage/v1/object/documents/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  return captured;
}

test.describe('T-20260625-foot-FOREIGN-HEALTHQ-EN', () => {
  test('S1: 발각질케어 — 신규 3문항 + 알레르기 동적칸 + 제출 payload', async ({ page }) => {
    await mockValidate(page, 'en');
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);

    // 헤더 영문 확인
    await expect(page.getByText('Foot Health Questionnaire')).toBeVisible();
    // 내원목적 3종(영문 라벨)
    await expect(page.getByRole('button', { name: 'Nail fungus' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ingrown toenail' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Foot callus care' })).toBeVisible();

    // 목적 선택 전 → 제출 비활성
    await expect(page.getByRole('button', { name: '✓ Submit' })).toBeDisabled();

    // 발각질케어 선택 → 신규 문항
    await page.getByRole('button', { name: 'Foot callus care' }).click();
    await expect(page.getByRole('heading', { name: 'Foot concerns' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Allergies' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current medications' })).toBeVisible();

    // Q1 증상 복수선택
    await page.getByRole('button', { name: 'Heel' }).click();
    await page.getByRole('button', { name: 'Dryness' }).click();

    // Q2 알레르기 — 입력칸은 Yes 전엔 숨김
    await expect(page.getByPlaceholder('Please specify your allergies')).toHaveCount(0);
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByPlaceholder('Please specify your allergies')).toBeVisible();
    await page.getByPlaceholder('Please specify your allergies').fill('Penicillin');

    // Q3 복용약
    await page.getByRole('button', { name: 'Diabetes medication' }).click();

    // 제출
    await page.getByRole('button', { name: '✓ Submit' }).click();
    await expect(page.getByText('All done!')).toBeVisible();

    // 제출 payload(form_data) 계약 검증 — DA 확정 키(언어중립 canonical 코드)
    const form = (captured.body?.p_form_data ?? {}) as Record<string, unknown>;
    expect(form.visit_purpose).toBe('발각질케어');
    // 발 고민 증상 = 신규 키 foot_concern_symptoms (표준 symptoms 와 별개), KO canonical 코드
    expect(form.foot_concern_symptoms).toEqual(expect.arrayContaining(['발뒤꿈치', '건조함']));
    expect(form.has_allergy).toBe(true);
    // 알레르기 상세 = DA 명시 키 allergies (재사용)
    expect(form.allergies).toBe('Penicillin');
    expect(form.medications).toEqual(expect.arrayContaining(['당뇨약']));
    // _lang 메타키 동봉 (self-describing)
    expect(form._lang).toBe('en');
  });

  test('S2: 발톱무좀 — 기존 발건강 질문지 영문 렌더 (한국어 하드코딩 제거)', async ({ page }) => {
    await mockValidate(page, 'en');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Nail fungus' }).click();

    // 기존 5섹션이 영문으로
    await expect(page.getByRole('heading', { name: 'Foot symptoms' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Foot health history' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My health status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Treatment & visit plan' })).toBeVisible();
    // 영문 옵션 라벨
    await expect(page.getByRole('button', { name: 'Diabetes', exact: true })).toBeVisible();

    // 한국어 섹션 헤더가 노출되지 않아야 함 (lang 분기 가드)
    await expect(page.getByText('발 관련 증상')).toHaveCount(0);
    await expect(page.getByText('나의 건강 상태')).toHaveCount(0);
  });

  test('S3: 무회귀 — ko 모드 기존 한국어 문진 정상 + 목적 단계 미노출', async ({ page }) => {
    await mockValidate(page, 'ko');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);

    // 한국어 헤더 + 섹션
    await expect(page.getByText('발건강 질문지')).toBeVisible();
    await expect(page.getByText('발 관련 증상')).toBeVisible();
    await expect(page.getByText('나의 건강 상태')).toBeVisible();

    // 영문 내원목적 단계는 ko 모드에서 노출 안 됨
    await expect(page.getByRole('button', { name: 'Foot callus care' })).toHaveCount(0);
    await expect(page.getByText('Reason for visit')).toHaveCount(0);

    // ko 제출 버튼 (목적 게이트 없음 → 활성)
    await expect(page.getByRole('button', { name: '✓ 작성 완료 — 제출하기' })).toBeEnabled();
  });
});
