/**
 * E2E spec — T-20260701-foot-NEWPATIENT-REG-COMPACT
 * 신규 환자(고객) 등록 폼 컴팩트화 — NEWFORM-COMPACT-DEFAULT 변경2 현장 confirm 실행분.
 *
 * 현장(김주연 총괄): "진행ㄱ" (ts 1782898969.563039).
 * 상위 정책 NEWFORM-COMPACT-DEFAULT 1순위 대상 ①신규 환자 등록. 체크인 창은 완료, 등록 화면 동일 방향.
 *
 * 대상: CreateCustomerDialog (Customers.tsx) "신규 고객 등록".
 *  - AC1: 접속 시 필수(이름·전화번호)만 노출. 선택/부가(생년월일·외국인·메모·추천인)는 접힘 기본값.
 *  - AC2: 기본 안내/설명 문구 접힘 뒤로 숨김(필수 화면 노이즈 제거).
 *  - AC3(게이트): 필드 접힘이 저장 payload 필수값·검증 로직 회귀 없음(표시만 숨기고 값은 state 보존).
 *  - AC4: 컴팩트 레이아웃 — 첫 화면 세로 스크롤 최소화.
 *
 * 시나리오:
 *  1) AC1/AC4 — 폼 첫 화면에 필수(이름·전화)만 노출 + 부가 필드(외국인/메모/추천인) 기본 숨김 + 가로 넘침 0.
 *  2) AC1 — [선택 정보] 토글 클릭 시 부가 필드(생년월일/외국인/메모/추천인) 펼침.
 *  3) AC3 — 필수값 검증 회귀 0: 이름/전화 비면 [등록] disabled → 채우면 enabled.
 *
 * ※ FE-only(SQL 0·DB 비파괴·payload 무변경). 권한/데이터 부재 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openCreateCustomerDialog(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: '신규 고객' });
  try {
    await btn.first().click({ timeout: 8_000 });
  } catch {
    return false;
  }
  const dialog = page.getByRole('dialog').filter({ hasText: '신규 고객 등록' });
  try {
    await dialog.waitFor({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260701-foot-NEWPATIENT-REG-COMPACT — 신규 환자 등록 폼 컴팩트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1: AC1/AC4 — 첫 화면 필수만 노출 + 부가 필드 기본 숨김 + 가로 넘침 0', async ({ page }) => {
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '신규 고객 등록' });

    // 필수 2요소 노출: 이름·전화번호.
    await expect(dialog.getByText('이름', { exact: true })).toBeVisible();
    await expect(dialog.getByText('전화번호', { exact: true })).toBeVisible();

    // 부가 필드는 기본 접힘 → 외국인 정보 섹션·메모·추천인 화면에서 숨김.
    await expect(dialog.getByTestId('custform-optional-body')).toHaveCount(0);
    await expect(dialog.getByTestId('foreign-info-section')).toHaveCount(0);
    await expect(dialog.getByText('메모', { exact: true })).toHaveCount(0);

    // 접기 토글은 노출.
    await expect(dialog.getByTestId('custform-optional-toggle')).toBeVisible();

    // 컴팩트: 다이얼로그 내부 가로 넘침 없음.
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, '다이얼로그 가로 넘침').toBeLessThanOrEqual(2);
    console.log(`[시나리오1] 필수2요소 노출 + 부가필드 기본숨김 + 가로넘침 ${overflow}px OK`);
  });

  test('시나리오2: AC1 — [선택 정보] 토글 시 부가 필드 펼침', async ({ page }) => {
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '신규 고객 등록' });
    await dialog.getByTestId('custform-optional-toggle').click();

    // 펼침 후 부가 필드 노출: 외국인 섹션·메모·추천인.
    await expect(dialog.getByTestId('custform-optional-body')).toBeVisible();
    await expect(dialog.getByTestId('foreign-info-section')).toBeVisible();
    await expect(dialog.getByText('메모', { exact: true })).toBeVisible();
    // 추천인 라벨은 "추천인 (선택)" nested span → 추천인 입력창 placeholder로 확인.
    await expect(dialog.getByPlaceholder('추천인 이름 검색 또는 직접 입력')).toBeVisible();
    console.log('[시나리오2] 선택 정보 토글 → 부가필드(외국인/메모/추천인) 펼침 OK');
  });

  test('시나리오3: AC3 — 필수값 검증 회귀 0 (이름/전화 비면 등록 disabled → 채우면 enabled)', async ({ page }) => {
    const opened = await openCreateCustomerDialog(page);
    if (!opened) test.skip(true, '신규 고객 등록 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '신규 고객 등록' });
    const submit = dialog.getByRole('button', { name: '등록', exact: true });

    // 초기: 이름/전화 비어있음 → 등록 disabled(검증 유지).
    await expect(submit).toBeDisabled();

    // 이름만 입력 → 여전히 disabled.
    await dialog.getByPlaceholder('이름').first().fill('테스트환자REGCOMPACT');
    await expect(submit).toBeDisabled();

    // 전화까지 입력 → enabled(저장 검증 회귀 없음, 접힘 상태로도 저장 가능).
    await dialog.getByPlaceholder('전화번호').first().fill('01099998888');
    await expect(submit).toBeEnabled();
    console.log('[시나리오3] 필수값 검증 회귀 0: 빈값 disabled → 이름만 disabled → 이름+전화 enabled OK');
  });
});
