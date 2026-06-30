/**
 * T-20260629-foot-HEALTHQ-SELF-ADD-2Q — 발건강 질문지 자가작성 신규 항목 2종
 *   (REWORK: 현장 김주연 총괄 항목B 노출범위 B안 + 영문 카피 2종 확정)
 *
 * 항목 A) 패디큐어 제거 유무 (있음/없음 · 영문 "Pedicure removed?" Yes/No)
 *         — 국문 + 영문 전체 양식(purposeChosen 시 모든 flow 1회 노출).
 * 항목 B) 30분 이상 엎드려 시술 가능 여부 (가능/불가능 · 영문 Yes/No)
 *         — B안 확정: 발각질케어(callus) 선택 시에만 조건부 노출. 국문/표준 영문 폼 비노출.
 *         — 영문 라벨 확정: "Can you lie face down for more than 30 minutes during the treatment?"
 *
 * 검증 대상 (HealthQMobilePage "추가 확인 사항" 섹션 + HealthQResultsPanel 뷰어):
 *   S1) 국문 폼 — 항목A 노출 + 있음 선택 저장, 항목B 비노출 (AC-1·AC-4')
 *   S2) 영문 표준 폼(발톱무좀) — 항목A(영문) 노출·선택·저장, 항목B 비노출 (AC-4')
 *   S3) 영문 발각질케어 폼 — 항목A + 항목B 모두 노출 (AC-3')
 *   S4) 무회귀 — 기존 5섹션/발각질 문항 정상 렌더(신규 추가가 기존 회귀 유발 안 함)
 *   S5) 발각질케어 선택 → 항목B 노출 + Yes 선택 시 canonical '가능' 저장 (AC-3'·AC-8)
 *   S6) 표준 영문(발톱무좀) → 항목B 숨김 (AC-4')
 *   S7) 영문 카피 확정 표시 — 항목A "Pedicure removed?" + 항목B "...more than 30 minutes..." + Yes/No (AC-6·AC-7)
 *
 * 방식: anon RPC(fn_health_q_validate_token / fn_health_q_submit)를 page.route 로 mock.
 *       DB 무의존 → 결정적. 저장 검증은 submit RPC 요청 body(p_form_data) 계약으로 확인.
 *       선택자는 "추가 확인 사항/Additional questions" 섹션 + 질문 그룹(div.space-y-2)으로 스코프
 *       (항목A·항목B 가 동일 Yes/No 라벨이라 그룹 스코프 필수).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

const TOKEN = 'e2e-healthq-add2q-token';

/** 항목B 확정 라벨 (substring 매칭용) */
const PRONE_LABEL = 'lie face down for more than 30 minutes';

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
        customer_name: 'Jane Doe',
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
  page.route('**/storage/v1/object/documents/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  return captured;
}

/** "추가 확인 사항 / Additional questions" 섹션으로 스코프 (중복 라벨 회피) */
function extraSection(page: Page, lang: 'ko' | 'en'): Locator {
  return page.locator('section').filter({
    hasText: lang === 'en' ? 'Additional questions' : '추가 확인 사항',
  });
}

/** 섹션 내 단일 질문 그룹(div.space-y-2)으로 스코프 — 항목A/항목B Yes/No 충돌 회피 */
function questionGroup(sec: Locator, labelText: string): Locator {
  return sec.locator('div.space-y-2').filter({ hasText: labelText });
}

test.describe('T-20260629-foot-HEALTHQ-SELF-ADD-2Q', () => {
  test('S1: 국문 폼 — 항목A 노출·저장 + 항목B 비노출', async ({ page }) => {
    await mockValidate(page, 'ko');
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await expect(page.getByText('발건강 질문지')).toBeVisible();

    const sec = extraSection(page, 'ko');
    // 항목 A 노출
    await expect(sec.getByText('패디큐어 제거 유무')).toBeVisible();
    // 항목 B 는 국문 폼 비노출 (AC-4')
    await expect(page.getByText(PRONE_LABEL)).toHaveCount(0);

    // 항목 A '있음' 선택
    await questionGroup(sec, '패디큐어 제거 유무').getByRole('button', { name: '있음', exact: true }).click();

    await page.getByRole('button', { name: '✓ 작성 완료 — 제출하기' }).click();
    await expect(page.getByText('작성 완료!')).toBeVisible();

    // 저장 payload 계약 — pedicure_removed=있음 (canonical), prone_30min_ok 미선택(빈값)
    const form = (captured.body?.p_form_data ?? {}) as Record<string, unknown>;
    expect(form.pedicure_removed).toBe('있음');
    expect(form.prone_30min_ok).toBe('');
    expect(form._lang).toBe('ko');
  });

  test('S2: 영문 표준 폼(발톱무좀) — 항목A(영문) 노출·선택·저장 + 항목B 비노출', async ({ page }) => {
    await mockValidate(page, 'en');
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Nail fungus' }).click();

    const sec = extraSection(page, 'en');
    // 항목 A 영문 확정 라벨 + Yes/No
    await expect(sec.getByText('Pedicure removed?')).toBeVisible();
    // 항목 B 는 표준 폼(비-각질케어)에서 비노출 (AC-4')
    await expect(page.getByText(PRONE_LABEL)).toHaveCount(0);

    // 항목 A = No 선택
    await questionGroup(sec, 'Pedicure removed?').getByRole('button', { name: 'No', exact: true }).click();

    await page.getByRole('button', { name: '✓ Submit' }).click();
    await expect(page.getByText('All done!')).toBeVisible();

    // 저장 payload — value=한국어 canonical (영문 라벨이어도 stable 코드 저장). 항목B 미노출→빈값
    const form = (captured.body?.p_form_data ?? {}) as Record<string, unknown>;
    expect(form.pedicure_removed).toBe('없음');
    expect(form.prone_30min_ok).toBe('');
    expect(form._lang).toBe('en');
  });

  test('S3: 영문 발각질케어 폼 — 항목A + 항목B 모두 노출 (B안 조건부 노출)', async ({ page }) => {
    await mockValidate(page, 'en');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Foot callus care' }).click();

    const sec = extraSection(page, 'en');
    await expect(sec.getByText('Pedicure removed?')).toBeVisible();
    await expect(sec.getByText(PRONE_LABEL)).toBeVisible();
    // 발각질 신규 문항도 함께 존재 (무회귀)
    await expect(page.getByRole('heading', { name: 'Foot concerns' })).toBeVisible();
  });

  test('S4: 무회귀 — 기존 5섹션(ko) 정상 렌더', async ({ page }) => {
    await mockValidate(page, 'ko');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await expect(page.getByText('발 관련 증상')).toBeVisible();
    await expect(page.getByText('나의 건강 상태')).toBeVisible();
    await expect(page.getByText('치료 및 내원 계획')).toBeVisible();
    // 신규 섹션이 기존 섹션을 밀어내지 않고 함께 존재
    await expect(extraSection(page, 'ko').getByText('패디큐어 제거 유무')).toBeVisible();
  });

  test('S5: 발각질케어 선택 → 항목B 노출 + Yes 선택 시 canonical 가능 저장', async ({ page }) => {
    await mockValidate(page, 'en');
    const captured = captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Foot callus care' }).click();

    const sec = extraSection(page, 'en');
    const proneGroup = questionGroup(sec, PRONE_LABEL);
    await expect(proneGroup).toBeVisible();

    // 항목 B = Yes (canonical '가능'), 항목 A = Yes (canonical '있음') — 그룹 스코프로 분리 선택
    await proneGroup.getByRole('button', { name: 'Yes', exact: true }).click();
    await questionGroup(sec, 'Pedicure removed?').getByRole('button', { name: 'Yes', exact: true }).click();

    await page.getByRole('button', { name: '✓ Submit' }).click();
    await expect(page.getByText('All done!')).toBeVisible();

    // canonical value 불변 검증 (라벨만 Yes/No 교체, 저장값은 한국어 stable 코드)
    const form = (captured.body?.p_form_data ?? {}) as Record<string, unknown>;
    expect(form.prone_30min_ok).toBe('가능');
    expect(form.pedicure_removed).toBe('있음');
    expect(form._lang).toBe('en');
  });

  test('S6: 표준 영문(발톱무좀) → 항목B 숨김', async ({ page }) => {
    await mockValidate(page, 'en');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Nail fungus' }).click();

    const sec = extraSection(page, 'en');
    // 항목 A 는 노출, 항목 B 는 숨김
    await expect(sec.getByText('Pedicure removed?')).toBeVisible();
    await expect(page.getByText(PRONE_LABEL)).toHaveCount(0);
  });

  test('S7: 영문 카피 확정 표시 — 항목A "Pedicure removed?" + 항목B 라벨 + Yes/No 선택지', async ({ page }) => {
    await mockValidate(page, 'en');
    captureSubmit(page);

    await page.goto(`/health-q/${TOKEN}`);
    await page.getByRole('button', { name: 'Foot callus care' }).click();

    const sec = extraSection(page, 'en');

    // 항목 A — 확정 라벨 "Pedicure removed?" (구 "Pedicure removal status" 미존재)
    await expect(sec.getByText('Pedicure removed?')).toBeVisible();
    await expect(page.getByText('Pedicure removal status')).toHaveCount(0);
    const pedGroup = questionGroup(sec, 'Pedicure removed?');
    await expect(pedGroup.getByRole('button', { name: 'Yes', exact: true })).toBeVisible();
    await expect(pedGroup.getByRole('button', { name: 'No', exact: true })).toBeVisible();

    // 항목 B — 확정 라벨 "...more than 30 minutes..." (구 "30+ minutes" 미존재) + Yes/No
    await expect(
      sec.getByText('Can you lie face down for more than 30 minutes during the treatment?'),
    ).toBeVisible();
    await expect(page.getByText('Can you lie face down for 30+ minutes during the treatment?')).toHaveCount(0);
    const proneGroup = questionGroup(sec, PRONE_LABEL);
    await expect(proneGroup.getByRole('button', { name: 'Yes', exact: true })).toBeVisible();
    await expect(proneGroup.getByRole('button', { name: 'No', exact: true })).toBeVisible();
    // 구 선택지 Possible/Not possible 미존재
    await expect(proneGroup.getByRole('button', { name: 'Possible', exact: true })).toHaveCount(0);
  });
});
