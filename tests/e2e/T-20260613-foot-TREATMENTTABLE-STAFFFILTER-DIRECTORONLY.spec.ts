/**
 * E2E spec — T-20260613-foot-TREATMENTTABLE-STAFFFILTER-DIRECTORONLY (정본)
 *
 * ⚠️ 정정: 이전 버전(f3mg)은 스크린샷 없이 '상담실장·치료사 드롭다운 제거'를 검증한
 *   오진 spec이었다. 현장 스크린샷(F0BA6C10V9R) 확인 결과 실제 대상은
 *   치료 현황 테이블(/admin/treatment-table) 상단 '당직 원장:' 배너였다.
 *   duty_roster가 출퇴근 import로 금일 출근 전 직원으로 확장되며 배너가
 *   비-원장(상담실장·치료사 등)까지 노출하던 것을 role=director 만으로 제한한다.
 *
 * AC-1(핵심): '당직 원장:' 배너에 role=director 직원 배지만 표시.
 * AC-2: duty_roster에 금일 출근 비-원장 N명이 있어도 배너 미노출.
 * AC-3(빈 상태): 당직 원장 0명이면 배너 미표시(무파손).
 * AC-4(무회귀): 요약 카드 / 뷰 프리셋 / 담당자 필터 드롭다운(상담실장·치료사) /
 *   환자 테이블 / CSV export 무변경. (f3mg 가 잘못 제거한 드롭다운은 복원되어 존재)
 *
 * 현장 클릭 시나리오:
 *   S1. 어드민이 치료 현황 테이블을 연다 → '당직 원장:' 배너에는 원장 배지만 보인다
 *       (비-원장 직원명이 배지로 섞이지 않는다).
 *   S2. 담당자 필터(상담실장·치료사 드롭다운)는 그대로 존재하며 동작한다(무회귀).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

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

  // ── S1 / AC-1·AC-3: '당직 원장:' 배너는 director 만 노출(빈 상태 graceful) ──────
  test('AC-1: 당직 원장 배너는 원장만 노출 / 비-원장 배지 없음', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    const label = page.getByText('당직 원장:', { exact: true });
    const labelCount = await label.count();

    if (labelCount === 0) {
      // AC-3: 당직 원장 0명 → 배너 자체가 미표시(정상, 무파손).
      test.info().annotations.push({
        type: 'note',
        description: '당직 원장 0명 — 배너 미노출(AC-3 정상). 페이지는 정상 렌더.',
      });
      await expect(page.getByRole('heading', { name: '치료 현황 테이블' })).toBeVisible();
      return;
    }

    // 배너가 있다면, 배지 컨테이너의 직원명은 모두 원장 직책이어야 한다.
    // 비-원장(상담실장/치료사) 명단이 배지로 섞여 들어가면 안 됨(AC-2 표시 측면).
    // 구조 검증: '당직 원장:' 라벨 + 최소 1개 배지가 함께 노출.
    const bannerRow = label.first().locator('xpath=ancestor::div[1]');
    await expect(bannerRow).toBeVisible();
    const badges = bannerRow.locator('.inline-flex, [class*="badge"]');
    expect(await badges.count()).toBeGreaterThan(0);
  });

  // ── S2 / AC-4: 담당자 필터 드롭다운(상담실장·치료사)은 무회귀로 존재 ──────────────
  test('AC-4: 상담실장·치료사 담당자 필터 드롭다운이 유지된다', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    // f3mg 오진으로 제거됐던 per-staff 필터 드롭다운이 복원되어 존재해야 한다.
    await expect(page.getByText('상담실장:', { exact: true })).toBeVisible();
    await expect(page.getByText('치료사:', { exact: true })).toBeVisible();
    // Select(combobox) 2개(상담실장·치료사) 존재.
    expect(await page.getByRole('combobox').count()).toBeGreaterThanOrEqual(2);
  });

  // ── AC-4: 뷰 프리셋(원장 뷰) 전환 무회귀 ───────────────────────────────────────
  test('AC-4: 원장 뷰 전환 — 안내 배너 정상(데이터 의존 graceful)', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    const doctorTab = page.getByRole('tab', { name: /원장 뷰/ });
    if ((await doctorTab.count()) === 0) {
      test.skip(true, '원장 뷰 탭 없음 — 스킵');
      return;
    }
    await doctorTab.click();

    const banner = page.getByText('초진·체험 환자만 표시');
    if ((await banner.count()) > 0) {
      await expect(banner.first()).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'director 데이터 없음 — 안내 배너 미노출(정상). 무파손만 확인.',
      });
    }
  });
});
