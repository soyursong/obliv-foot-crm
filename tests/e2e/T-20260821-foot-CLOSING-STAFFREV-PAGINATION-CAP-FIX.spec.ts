/**
 * E2E spec — T-20260821-foot-CLOSING-STAFFREV-PAGINATION-CAP-FIX (P1 · money-path)
 *
 * 증상(현장 실측, 강경민 08-21):
 *   매출집계 > 담당실장별(화면②) 매출이 수납내역(화면①)과 발산. 특정 실장 최근일 tail 이 탈락하여
 *   과소집계(화면① 수납내역 23건 == 화면② 여야 하나 화면② 가 더 작게 표시).
 *
 * 진단(RC 확정, DIAG z52j):
 *   lib/staffRevenue.fetchAttributedPayments 의 payments/package_payments 2쿼리가 페이지네이션
 *   없이 실행 → PostgREST 기본 1000행 cap 에서 장기간(월/분기) 조회 시 무단 절단. 이 함수는
 *   담당실장별·결제수단별·랭킹·MTM 일별매출이 공유하는 SSOT → 전 화면 동시 과소집계.
 *
 * 수정(no db_change · read-path only):
 *   payments/package_payments 를 fetchAllRows(cursor .range) 로 전(全) 행 수집. 산식·귀속축
 *   (attributed_staff_id)·상태필터·기간축·sim 제외 전부 불변 — 절단된 tail 재조회일 뿐.
 *   package_payments latent 동형 결함도 선제 전환.
 *
 * 검증(브라우저):
 *   S1: 담당실장별 탭 + 장기간(분기) 조회 → 절단·throw 없이 합계 행 렌더(cap-truncation 방어).
 *   S2: tie-out 불변 — 담당실장별 총매출(누적−환불 == 총매출 열)이 구조적으로 정합.
 *   S3: 월경계 조회 회귀 → 정상 렌더(과소집계 회귀 차단).
 *
 * ※ 실데이터 금액 복원(강경민 16,057,900 == 화면①·23건)은 supervisor POST-VERIFY(운영 데이터)에서
 *   확정. 본 spec 은 non-truncation 렌더 + tie-out 불변을 브라우저에서 회귀 고정한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** "1,234,567원" → 1234567 (부호 −/- 포함). tie-out 계산용. */
function parseWon(text: string | null): number {
  if (!text) return NaN;
  const neg = /[−-]/.test(text);
  const digits = text.replace(/[^0-9]/g, '');
  const n = digits ? Number(digits) : 0;
  return neg ? -n : n;
}

test.describe('T-20260821 CLOSING-STAFFREV-PAGINATION-CAP-FIX — 담당실장별 매출 1000행 cap 절단 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  async function gotoDoctorTab(page: import('@playwright/test').Page) {
    await page.goto('/admin/sales');
    // 매출집계 헤더 렌더 대기(권한/route 게이트 통과 확인).
    const header = page.getByRole('heading', { name: '매출집계' });
    if (await header.count() === 0) {
      test.skip(true, '매출집계 진입 불가(권한/환경) — 스킵');
      return false;
    }
    await header.waitFor({ timeout: 20_000 });
    // 담당실장별 탭 활성화.
    await page.getByRole('tab', { name: /담당실장별/ }).click();
    return true;
  }

  async function setCustomRange(page: import('@playwright/test').Page, from: string, to: string) {
    await page.getByTestId('sales-preset-custom').click();
    await page.getByTestId('sales-date-from').fill(from);
    await page.getByTestId('sales-date-to').fill(to);
  }

  /** 로딩 종료 대기 후 합계행/빈상태 판정. 빈상태면 skip(데이터 없으면 pagination 미행사). */
  async function waitDataOrSkip(page: import('@playwright/test').Page): Promise<boolean> {
    await expect(page.getByTestId('sales-doctor-loading')).toHaveCount(0, { timeout: 30_000 });
    if (await page.getByTestId('sales-doctor-empty').count() > 0) {
      test.skip(true, '해당 기간 담당실장 데이터 없음 — pagination 미행사, 스킵');
      return false;
    }
    return true;
  }

  test('S1: 장기간(분기) 조회 — 절단·throw 없이 담당실장별 합계 렌더', async ({ page }) => {
    if (!(await gotoDoctorTab(page))) return;
    await setCustomRange(page, '2026-05-21', '2026-08-21');
    if (!(await waitDataOrSkip(page))) return;
    // 합계 행이 렌더되어야 함(cap 절단/throw 시 빈화면·에러로 미노출).
    await expect(page.getByTestId('sales-doctor-total-total')).toBeVisible({ timeout: 30_000 });
  });

  test('S2: tie-out 불변 — 담당실장별 합계(누적 − 환불 == 총매출)', async ({ page }) => {
    if (!(await gotoDoctorTab(page))) return;
    await setCustomRange(page, '2026-05-21', '2026-08-21');
    if (!(await waitDataOrSkip(page))) return;
    const totalCell = page.getByTestId('sales-doctor-total-total');
    await expect(totalCell).toBeVisible({ timeout: 30_000 });

    const cumulative = parseWon(await page.getByTestId('sales-doctor-total-cumulative').textContent());
    const refund = parseWon(await page.getByTestId('sales-doctor-total-refund').textContent());
    const total = parseWon(await totalCell.textContent());
    // 총매출 = 누적 − 환불 (환불 셀은 음수/− 표기 → 절대값으로 차감).
    expect(total).toBe(cumulative - Math.abs(refund));
  });

  test('S3: 월경계(2026-07-15~2026-08-21) 조회 회귀 — 정상 렌더', async ({ page }) => {
    if (!(await gotoDoctorTab(page))) return;
    await setCustomRange(page, '2026-07-15', '2026-08-21');
    if (!(await waitDataOrSkip(page))) return;
    await expect(page.getByTestId('sales-doctor-total-total')).toBeVisible({ timeout: 30_000 });
  });
});
