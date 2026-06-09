/**
 * E2E spec — T-20260609-foot-MEDDASH-MINIMAL-TABLE
 * 진료부 대시보드 미니멀화 + 환자목록 테이블화 (문지은 대표원장 요구 3건)
 *
 * 본 티켓 항목 대부분(항목1 hover툴팁+취소 / 항목2 차팅 진입점 분기 / 항목3 테이블화·정렬)은
 * 선행 티켓들에서 이미 배포·검증됨:
 *   - QUICKRX-HOVER-TOOLTIP-CANCEL (항목1: AC1/2/3)
 *   - CHARTBTN-MINIMAL-COURSE-DRAWER (항목2: AC4/6)
 *   - DOCPATIENTLIST-SORT-LAYOUT (항목3: AC7~12)
 *
 * 본 spec 은 미충족 갭이었던 AC5 를 검증한다:
 *   AC5 — clinical 미니멀 drawer 내 '본 차트 열기' 별도 버튼으로 전체 진료차트 승격.
 *         같은 환자/같은 패널 인스턴스 유지(variant만 'full' 전환) → 작성 중 임상경과 보존(AC6 재진입).
 *
 * 데이터 의존(당일 진료 호출/완료 환자 행)이라 행이 없으면 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

// 진료부 통합 대시보드 진입 + 차팅 버튼 있는 첫 행 반환. 행 없으면 null.
async function openDoctorDashboardChartBtn(page: Page): Promise<Locator | null> {
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');
  const dash = page.locator('[data-testid="doctor-call-dashboard"]');
  if (!(await dash.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))) {
    return null;
  }
  const chartBtn = page
    .locator('[data-testid="doctor-call-chart-btn"], [data-testid="doctor-completed-chart-btn"]')
    .first();
  if ((await chartBtn.count()) === 0) return null;
  return chartBtn;
}

test.describe('T-20260609-MEDDASH-MINIMAL-TABLE — AC5 clinical drawer 내 본 차트 열기', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC5: clinical 미니멀 drawer 헤더에 '본 차트 열기' 버튼이 노출된다 ─────────────
  test('AC5: clinical drawer 에 "본 차트 열기" 버튼이 있다', async ({ page }) => {
    const chartBtn = await openDoctorDashboardChartBtn(page);
    if (!chartBtn) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await chartBtn.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer).toHaveAttribute('data-variant', 'clinical');

    const openFullBtn = page.locator('[data-testid="clinical-open-full-btn"]');
    await expect(openFullBtn).toBeVisible();
    await expect(openFullBtn).toContainText('본 차트 열기');
  });

  // ── AC5/AC6: 본 차트 열기 클릭 → 전체 차트 전환 + 작성 중 임상경과 보존 ───────────
  test('AC5/AC6: 본 차트 열기 → full 전환되고 2단 레이아웃 보존 + 작성 중 임상경과 유지', async ({ page }) => {
    const chartBtn = await openDoctorDashboardChartBtn(page);
    if (!chartBtn) {
      test.skip(true, '진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await chartBtn.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // 미니멀 임상경과에 작성 중 텍스트 입력(저장 안 함 — 폼 상태 보존 확인용)
    const mini = page.locator('[data-testid="clinical-mini-textarea"]');
    await expect(mini).toBeVisible();
    const draft = 'AC6 보존 확인 임상경과 초안';
    await mini.fill(draft);

    // 본 차트 열기 클릭 → 같은 패널 인스턴스에서 variant='full' 전환
    await page.locator('[data-testid="clinical-open-full-btn"]').click();

    // AC6: 전체 차트 산출물(타임라인·우측패널·2단 임상경과) 재진입
    await expect(drawer).toHaveAttribute('data-variant', 'full');
    await expect(page.locator('[data-testid="medical-chart-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="medical-chart-right-panel"]')).toBeVisible();
    // 미니멀 본문은 사라짐
    await expect(page.locator('[data-testid="medical-chart-clinical-mini"]')).toHaveCount(0);

    // 작성 중 임상경과가 full 뷰 임상경과 칸에 그대로 보존(같은 form 상태)
    const fullClinical = page.locator('[data-testid="medical-chart-clinical"]');
    await expect(fullClinical).toBeVisible();
    await expect(fullClinical).toHaveValue(new RegExp(draft));
  });
});
