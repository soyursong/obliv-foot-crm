/**
 * E2E spec — T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER
 * 차팅 버튼 = 미니멀 임상경과 / 차트 열기 = 전체 진료차트 Drawer (문지은 대표원장 C0ATE5P6JTH)
 *
 * 진입점: 진료부 통합 대시보드(DoctorCallDashboard, /admin/doctor-tools 기본 탭).
 *   기존엔 '차팅' 버튼이 전체 MedicalChartPanel(타임라인·2COL·처방)을 직접 열었음(T-20260603 FOLLOWUP3 C-1).
 *   본 티켓에서 진입점을 분기:
 *     AC-1 '차팅'    → variant='clinical' 미니멀 뷰(임상경과+담당의사+저장만, 타임라인·처방·우측패널 제외)
 *     AC-2 '차트 열기' → variant='full' 전체 진료차트 Drawer(기존 2COL/타임라인/처방/우측패널 보존)
 *     AC-3 두 진입점 모두 같은 MedicalChartPanel·medical_charts 소스 + 오인클릭 방지(별도 버튼)
 *
 * 데이터 의존(당일 진료 호출/완료 환자 행)이라 행이 없으면 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

// 진료부 통합 대시보드 진입 + 첫 행(피드 또는 완료) 반환. 행 없으면 null.
async function openDoctorDashboardFirstRow(page: Page): Promise<{
  chartBtn: Locator;
  fullChartBtn: Locator;
} | null> {
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');
  const dash = page.locator('[data-testid="doctor-call-dashboard"]');
  if (!(await dash.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))) {
    return null;
  }
  // 차팅 버튼이 있는 첫 행(피드 행 또는 완료 행)
  const chartBtn = page
    .locator('[data-testid="doctor-call-chart-btn"], [data-testid="doctor-completed-chart-btn"]')
    .first();
  if ((await chartBtn.count()) === 0) return null;
  // 같은 행의 '차트 열기' 버튼 — 행 단위로 묶어 매칭
  const row = chartBtn.locator(
    'xpath=ancestor::li[@data-testid="doctor-call-feed-row" or @data-testid="doctor-completed-row"]',
  );
  const fullChartBtn = row
    .locator('[data-testid="doctor-call-fullchart-btn"], [data-testid="doctor-completed-fullchart-btn"]')
    .first();
  return { chartBtn, fullChartBtn };
}

test.describe('T-20260609-CHARTBTN-MINIMAL-COURSE-DRAWER — 차팅 진입점 분기', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 차팅 버튼 → 미니멀 임상경과(타임라인·처방·우측패널 미노출) ──────────
  test('AC-1: 차팅 클릭 시 임상경과 미니멀 뷰만 노출(타임라인/처방/우측패널 제외)', async ({ page }) => {
    const row = await openDoctorDashboardFirstRow(page);
    if (!row) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await row.chartBtn.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    // clinical variant 확인
    await expect(drawer).toHaveAttribute('data-variant', 'clinical');

    // 미니멀 본문 + 임상경과 입력칸 노출
    await expect(page.locator('[data-testid="medical-chart-clinical-mini"]')).toBeVisible();
    await expect(page.locator('[data-testid="clinical-mini-textarea"]')).toBeVisible();

    // 제외 대상: 좌측 타임라인 / 우측 콘텐츠 패널 미노출
    await expect(page.locator('[data-testid="medical-chart-timeline"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="medical-chart-right-panel"]')).toHaveCount(0);
    // 전체 차트 진단명 입력칸(미니멀엔 없음)도 미노출
    await expect(page.locator('[data-testid="medical-chart-date"]')).toHaveCount(0);
  });

  // ── AC-1: 미니멀 뷰 임상경과 입력 + 저장/닫기 버튼 존재 ───────────────────────
  test('AC-1: 미니멀 뷰에 임상경과 입력 + 저장/닫기 버튼이 있다', async ({ page }) => {
    const row = await openDoctorDashboardFirstRow(page);
    if (!row) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await row.chartBtn.click();
    const ta = page.locator('[data-testid="clinical-mini-textarea"]');
    await expect(ta).toBeVisible({ timeout: 10_000 });

    await ta.fill('E2E 임상경과 테스트 입력');
    await expect(ta).toHaveValue('E2E 임상경과 테스트 입력');

    await expect(page.locator('[data-testid="clinical-mini-save-btn"]')).toBeVisible();
    const closeBtn = page.locator('[data-testid="clinical-mini-close-btn"]');
    await expect(closeBtn).toBeVisible();
    // 닫기 → Drawer 사라짐(저장 부작용 없이 종료)
    await closeBtn.click();
    await expect(page.locator('[data-testid="medical-chart-drawer"]')).toHaveCount(0);
  });

  // ── AC-2: 차트 열기 → 전체 진료차트 Drawer(타임라인/우측패널 보존) ──────────────
  test('AC-2: 차트 열기 클릭 시 전체 진료차트 Drawer가 열린다(타임라인·우측패널 노출)', async ({ page }) => {
    const row = await openDoctorDashboardFirstRow(page);
    if (!row) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    if ((await row.fullChartBtn.count()) === 0) {
      test.skip(true, '차트 열기 버튼 없음 — 스킵');
      return;
    }
    await row.fullChartBtn.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    // full variant 확인
    await expect(drawer).toHaveAttribute('data-variant', 'full');

    // 전체 차트 산출물 보존: 좌측 타임라인 + 우측 콘텐츠 패널 + 임상경과(2COL) 노출
    await expect(page.locator('[data-testid="medical-chart-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="medical-chart-right-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="medical-chart-clinical"]')).toBeVisible();
    // 미니멀 본문은 없음
    await expect(page.locator('[data-testid="medical-chart-clinical-mini"]')).toHaveCount(0);
  });

  // ── AC-3: 두 진입 버튼이 같은 행에 별도로 공존(오인클릭 방지) ───────────────────
  test('AC-3: 차팅(미니멀)과 차트 열기(전체)가 같은 행에 별도 버튼으로 구분된다', async ({ page }) => {
    const row = await openDoctorDashboardFirstRow(page);
    if (!row) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await expect(row.chartBtn).toBeVisible();
    await expect(row.fullChartBtn).toBeVisible();
    // 두 버튼은 서로 다른 요소(텍스트 구분)
    await expect(row.chartBtn).toContainText('차팅');
    await expect(row.fullChartBtn).toContainText('차트 열기');
  });
});
