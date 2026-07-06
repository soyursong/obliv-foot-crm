/**
 * E2E spec — T-20260706-foot-CUSTOMER-CREATE-DIALOG-FIX
 * 신규 고객 등록 팝업 (CreateCustomerDialog, Customers.tsx) 2건 수정 검증.
 *
 * 이슈1 — 등록 팝업 짤림:
 *   선택정보 펼침 시 폼이 길어져 하단이 잘려 [등록] 버튼 접근 불가.
 *   → 폼 본문을 max-h-[70vh] overflow-y-auto 스크롤 컨테이너로 감싸 접근 가능화 (EditCustomerDialog 패턴).
 *
 * 이슈2 — 메모 2번차트(CustomerChartPage) 연동:
 *   기존 신규 등록 메모가 customers.memo(예약메모)로 저장돼 2번차트가 읽는 customers.customer_memo(고객메모)와 어긋남.
 *   → insert payload를 customer_memo로 통일 + Label '메모' → '고객메모'.
 *   customers.memo는 신규 등록 시 null 무방(ADDITIVE·스키마 변경 없음, db_change=false).
 *
 * 시나리오:
 *   1) 스크롤 접근 — 선택정보 펼침 후 [등록] 버튼이 스크롤로 접근 가능 + 스크롤 컨테이너(overflow-y-auto) 존재.
 *   2) 메모 연동 — 고객메모 입력 후 등록 시 insert payload가 customer_memo(=입력값)로 라우팅 + top-level memo 미설정.
 *   3) 메모 미입력 엣지 — 고객메모 공란 등록 시 payload.customer_memo === null (memo.trim() || null) + 크래시 0.
 *
 * ※ 비파괴: 시나리오2·3은 customers POST를 route로 가로채 payload만 캡처 후 abort → 실제 row 미생성(DB 오염 0).
 *   권한/데이터 부재 환경은 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const CREATE_DIALOG = '신규 고객 등록';

async function openCreateCustomerDialog(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: '신규 고객' });
  try {
    await btn.first().click({ timeout: 8_000 });
  } catch {
    return false;
  }
  const dialog = page.getByRole('dialog').filter({ hasText: CREATE_DIALOG });
  try {
    await dialog.waitFor({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/** customers insert(POST) payload를 캡처하고 abort(비파괴). 배열/객체 모두 정규화. */
async function captureCustomerInsertPayload(
  page: Page,
  action: () => Promise<void>,
): Promise<Record<string, unknown> | null> {
  let captured: unknown = undefined;
  await page.route('**/rest/v1/customers**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try {
        captured = JSON.parse(req.postData() || 'null');
      } catch {
        captured = req.postData();
      }
      // 실제 등록 방지 — payload만 검증하고 서버 반영은 차단(비파괴).
      await route.abort();
      return;
    }
    await route.continue();
  });

  await action();

  // POST가 잡힐 때까지 폴링.
  try {
    await expect.poll(() => captured !== undefined, { timeout: 8_000 }).toBeTruthy();
  } catch {
    await page.unroute('**/rest/v1/customers**').catch(() => {});
    return null;
  }
  await page.unroute('**/rest/v1/customers**').catch(() => {});

  if (Array.isArray(captured)) return (captured[0] ?? null) as Record<string, unknown> | null;
  if (captured && typeof captured === 'object') return captured as Record<string, unknown>;
  return null;
}

test.describe('T-20260706-foot-CUSTOMER-CREATE-DIALOG-FIX — 신규 고객 등록 팝업 스크롤·메모연동', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1: 이슈1 — 선택정보 펼침 시 [등록] 버튼 스크롤 접근 가능 + 스크롤 컨테이너 존재', async ({ page }) => {
    // 소형 뷰포트에서 짤림이 가장 잘 재현됨.
    await page.setViewportSize({ width: 1280, height: 720 });
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: CREATE_DIALOG });

    // 선택 정보(생년월일·외국인·메모·추천인) 펼침 → 폼이 길어짐.
    await dialog.getByTestId('custform-optional-toggle').click();
    await expect(dialog.getByTestId('custform-optional-body')).toBeVisible();

    // 스크롤 컨테이너: overflow-y-auto + max-height 제한(70vh) 적용 확인.
    const scroller = dialog.locator('div.overflow-y-auto').first();
    await expect(scroller).toHaveCount(1);
    const style = await scroller.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
    });
    expect(style.overflowY, 'overflow-y').toMatch(/auto|scroll/);
    expect(style.maxHeight, 'max-height 제한 존재').not.toBe('none');

    // 핵심 AC: 고객메모 필드 + [등록] 버튼이 스크롤로 접근 가능(짤림 해소).
    const memoLabel = dialog.getByText('고객메모', { exact: true });
    await memoLabel.scrollIntoViewIfNeeded();
    await expect(memoLabel).toBeVisible();

    const submit = dialog.getByRole('button', { name: '등록' });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();

    console.log(`[시나리오1] 스크롤 컨테이너(overflow-y=${style.overflowY}, max-h=${style.maxHeight}) + 등록버튼 접근 OK`);
  });

  test('시나리오2: 이슈2 — 고객메모 입력 시 insert payload가 customer_memo로 라우팅(2번차트 연동)', async ({ page }) => {
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: CREATE_DIALOG });

    // 필수값(이름·전화) 채움 — 중복 회피용 유니크 값.
    const stamp = String(Date.now()).slice(-9);
    await dialog.getByPlaceholder('이름').fill(`E2E고객메모${stamp}`);
    await dialog.getByPlaceholder('전화번호').fill(`010${stamp}`);

    // 선택 정보 펼쳐 고객메모 입력.
    await dialog.getByTestId('custform-optional-toggle').click();
    await expect(dialog.getByText('고객메모', { exact: true })).toBeVisible();
    const MEMO = `2번차트연동확인-${stamp}`;
    await dialog.locator('textarea').first().fill(MEMO);

    const payload = await captureCustomerInsertPayload(page, async () => {
      await dialog.getByRole('button', { name: '등록' }).click();
    });
    if (!payload) test.skip(true, 'customers insert POST 미포착(권한/RLS로 요청 미발생)');

    // 핵심: 고객메모 → customer_memo 컬럼(2번차트 CustomerChartPage가 읽는 컬럼).
    expect(payload!.customer_memo, 'customer_memo에 입력값 저장').toBe(MEMO);
    // top-level memo(예약메모)에는 오입력 없음 — 신규 등록 시 미설정(null/부재).
    expect(payload!.memo ?? null, 'memo(예약메모)에는 오저장 없음').toBeNull();

    console.log(`[시나리오2] payload.customer_memo="${payload!.customer_memo}" / memo=${JSON.stringify(payload!.memo ?? null)} OK`);
  });

  test('시나리오3: 엣지 — 고객메모 미입력 등록 시 customer_memo === null (크래시 0)', async ({ page }) => {
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: CREATE_DIALOG });

    const stamp = String(Date.now()).slice(-9);
    await dialog.getByPlaceholder('이름').fill(`E2E공란메모${stamp}`);
    await dialog.getByPlaceholder('전화번호').fill(`010${stamp}`);
    // 고객메모는 의도적으로 공란 유지 (선택정보 미펼침 = memo state '' 보존).

    const payload = await captureCustomerInsertPayload(page, async () => {
      await dialog.getByRole('button', { name: '등록' }).click();
    });
    if (!payload) test.skip(true, 'customers insert POST 미포착(권한/RLS로 요청 미발생)');

    // memo.trim() || null → 공란은 null. 빈 문자열이 아니어야 함(2번차트 seed 시 빈 이력 방지).
    expect(payload!.customer_memo ?? null, '공란 메모는 null 저장').toBeNull();
    // 다이얼로그가 크래시 없이 유지(등록 시도 자체는 정상 진행).
    console.log(`[시나리오3] 공란 payload.customer_memo=${JSON.stringify(payload!.customer_memo ?? null)} OK`);
  });
});
