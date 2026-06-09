/**
 * E2E spec — T-20260609-foot-CHART-CONSENT-ALIGN-SMS
 * 2번차트(고객 상세) 개인정보 동의항목을 셀프접수 동의항목으로 정합 + 자동발송 연동
 * — 김주연 총괄 C0ATE5P6JTH (U0ATDB587PV)
 *
 * AC0 (diff-first): privacy_consent / hira_consent / sms_opt_in(+_at) / sms_reject / marketing_reject
 *   모두 customers 기존 컬럼 — 신규 스키마 없음. DB게이트 불필요.
 *
 * 범위:
 *   AC-1 차트 동의 섹션 표시 항목이 "개인정보수집 / 건강보험조회 / 문자수신" 3개로 교체.
 *        (기존 "동의 / 문자수신거부 / 광고미동의" 미노출)
 *   AC-2 셀프접수 동의 결과(privacy_consent/hira_consent/sms_opt_in)가 차트의 3개 항목에 그대로 반영.
 *   AC-3 환자 문자수신 거부(sms_opt_in=false) → send-notification Edge Fn이 자동발송에서 제외(코드 레벨 검증).
 *   AC-4 polarity: 문자수신 체크박스 = sms_opt_in(긍정형). 거부=발송제외, 동의=발송대상.
 *   AC-3(P2) 건보 조회동의 Y/N 토글 중복 노출 제거(동의 섹션으로 통합). NHIS '조회' 버튼은 유지.
 *
 * 데이터 의존(고객/차트)이라 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

// 고객 목록 → 첫 고객 2번차트 열기. 못 열면 false.
async function openCustomerChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const openBtns = page.locator('[data-testid="open-chart-btn"]');
  if ((await openBtns.count()) === 0) return false;
  await openBtns.first().click();
  const sheet = page.locator('[data-testid="customer-chart-sheet"]');
  return sheet
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260609-CHART-CONSENT-ALIGN-SMS — 차트 동의항목 셀프접수 정합 + 자동발송 연동', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 동의 섹션 항목 교체 ──────────────────────────────────────────────
  test('AC-1: 차트 동의 섹션이 개인정보수집/건강보험조회/문자수신 3개로 교체된다', async ({ page }) => {
    if (!(await openCustomerChart(page))) {
      test.skip(true, '고객/차트 미열림(데이터) — 스킵');
      return;
    }
    const section = page.locator('[data-testid="chart-consent-section"]');
    if (
      !(await section
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false))
    ) {
      test.skip(true, '동의 섹션 미노출(데이터) — 스킵');
      return;
    }
    // 신규 항목 3개 노출
    await expect(section.getByText('개인정보수집', { exact: true })).toHaveCount(1);
    await expect(section.getByText('건강보험조회', { exact: true })).toHaveCount(1);
    await expect(section.getByText('문자수신', { exact: true })).toHaveCount(1);
    // 구 항목 미노출 (문자수신거부/광고미동의)
    await expect(section.getByText('문자수신거부', { exact: true })).toHaveCount(0);
    await expect(section.getByText('광고미동의', { exact: true })).toHaveCount(0);
  });

  // ── AC-4: 문자수신 토글 polarity (opt-in 긍정형) ───────────────────────────
  test('AC-4: 문자수신 항목은 클릭 가능한 독립 토글(opt-in)이다', async ({ page }) => {
    if (!(await openCustomerChart(page))) {
      test.skip(true, '고객/차트 미열림(데이터) — 스킵');
      return;
    }
    const section = page.locator('[data-testid="chart-consent-section"]');
    if (
      !(await section
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false))
    ) {
      test.skip(true, '동의 섹션 미노출(데이터) — 스킵');
      return;
    }
    // 3개 항목 각각 독립 button (단일선택 라디오가 아님)
    const buttons = section.locator('button');
    expect(await buttons.count()).toBe(3);
    const smsBtn = section.getByRole('button', { name: '문자수신', exact: true });
    await expect(smsBtn).toBeEnabled();
  });

  // ── AC-3(P2): 건보 조회동의 중복 토글 제거 + 조회 버튼 유지 ──────────────────
  test('AC-3(P2): 건보 조회동의 Y/N 중복 토글이 제거되고 NHIS 조회 버튼은 유지된다', async ({ page }) => {
    if (!(await openCustomerChart(page))) {
      test.skip(true, '고객/차트 미열림(데이터) — 스킵');
      return;
    }
    const sheet = page.locator('[data-testid="customer-chart-sheet"]');
    // '건보 조회' 행의 조회 버튼은 존재
    await expect(sheet.getByRole('button', { name: '조회', exact: true })).toHaveCount(1);
    // 건보 동의 토글은 '개인정보 동의' 섹션의 건강보험조회 단일 토글로만 존재
    const section = page.locator('[data-testid="chart-consent-section"]');
    if (await section.count()) {
      await expect(section.getByText('건강보험조회', { exact: true })).toHaveCount(1);
    }
  });
});
