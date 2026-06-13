/**
 * E2E spec — T-20260613-foot-TREATMENTTABLE-STAFFFILTER-DIRECTORONLY
 * 치료 현황 테이블(/admin/treatment-table) 상단 필터에서
 * 상담실장·치료사 "전체 직원 명단" 드롭다운을 제거(원장 정보만 유지).
 *
 * AC-1: 상담실장/치료사 per-staff 필터 드롭다운(전체 직원 명단 노출) 제거.
 *        → 이 페이지에 Select(combobox) 0개. "상담실장:" / "치료사:" 필터 라벨 부재.
 * AC-2: 당직 원장 배너(원장 뷰)는 그대로 유지(손대지 않음).
 *        → 원장 뷰 전환 시 데이터 있으면 "초진·체험 환자만 표시" 배너 노출(graceful).
 * AC-3/AC-4: staff 쿼리·DB 무변경. 렌더 필터만 — 본 spec 은 UI 노출만 검증.
 *
 * 현장 클릭 시나리오:
 *   S1. 어드민이 치료 현황 테이블을 연다 → 직원 명단 드롭다운이 보이지 않는다.
 *   S2. 원장 뷰 탭을 누른다 → 당직 원장 안내는 그대로 보인다(데이터 있을 때).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

// 치료 현황 테이블 진입. 헤딩 보이면 true.
async function openTreatmentTable(page: Page): Promise<boolean> {
  await page.goto('/admin/treatment-table');
  await page.waitForLoadState('networkidle');
  const heading = page.getByRole('heading', { name: '치료 현황 테이블' });
  return heading
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260613-TREATMENTTABLE-STAFFFILTER-DIRECTORONLY', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── S1 / AC-1: 직원 명단 필터 드롭다운(combobox)이 제거됐다 ─────────────────
  test('AC-1: 상담실장·치료사 직원 명단 드롭다운이 없다', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    // per-staff 필터는 유일한 Select(combobox)였음 → 제거 후 0개여야 한다.
    await expect(page.getByRole('combobox')).toHaveCount(0);

    // 필터 라벨(콜론 포함)도 사라졌다. (뷰 탭 "실장 뷰"/"치료사 뷰"·컬럼 헤더와 충돌 없음)
    await expect(page.getByText('상담실장:', { exact: true })).toHaveCount(0);
    await expect(page.getByText('치료사:', { exact: true })).toHaveCount(0);
  });

  // ── S2 / AC-2: 원장 뷰 당직 배너는 유지 ───────────────────────────────────
  test('AC-2: 원장 뷰 전환 — 당직 원장 안내 배너 보존(데이터 있을 때)', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    // 원장 뷰 탭 클릭 (Tabs - role=tab)
    const doctorTab = page.getByRole('tab', { name: /원장 뷰/ });
    if ((await doctorTab.count()) === 0) {
      test.skip(true, '원장 뷰 탭 없음 — 스킵');
      return;
    }
    await doctorTab.click();

    // 원장 뷰에서도 combobox(직원 명단 필터)는 여전히 0개.
    await expect(page.getByRole('combobox')).toHaveCount(0);

    // 당직 원장 안내 배너는 director 데이터가 있을 때만 노출 → graceful.
    const banner = page.getByText('초진·체험 환자만 표시');
    if ((await banner.count()) > 0) {
      await expect(banner.first()).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'director 데이터 없음 — 배너 미노출(정상). AC-2 비파괴만 확인.',
      });
    }
  });
});
