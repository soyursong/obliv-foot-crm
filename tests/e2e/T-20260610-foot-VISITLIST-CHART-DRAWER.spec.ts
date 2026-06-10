/**
 * E2E spec — T-20260610-foot-VISITLIST-CHART-DRAWER
 * 진료환자목록 환자 이름 클릭 → 진료차트(variant='full') 서랍 진입 (문지은 대표원장 C0ATE5P6JTH)
 *
 * 진입점: 진료부 통합 대시보드(DoctorCallDashboard, /admin/doctor-tools 기본 탭).
 *   환자 이름 텍스트(span → button)를 클릭하면, 기존 '진료차트' 버튼과 같은 onOpenChart·같은
 *   MedicalChartPanel variant='full' Drawer가 열린다(새 Drawer/새 조회 경로 신설 없음).
 *
 * AC-1: 이름 클릭 → 페이지 이동 없이 진료차트 Drawer(variant='full') 오픈, 이름은 클릭 가능 식별.
 * AC-2: Drawer 닫기(X) 후 목록 유지 + 재오픈(같은 Drawer).
 * AC-3 (REGRESSION): '임상경과'(인라인 차팅, DOCDASH-CHART-UX AC1-1)는 서랍이 아니라 행 아래 인라인
 *        아코디언으로 유지 + '진료차트' 버튼은 이름 클릭과 동일 Drawer.
 *
 * 데이터 의존(당일 진료 호출/완료 환자 행)이라 행이 없으면 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

// 진료부 통합 대시보드 진입 + 이름-차트 버튼이 있는 첫 행 반환. 행 없으면 null.
async function openDashboardFirstNameRow(page: Page): Promise<{
  nameBtn: Locator;
  row: Locator;
} | null> {
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');
  const dash = page.locator('[data-testid="doctor-call-dashboard"]');
  if (!(await dash.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))) {
    return null;
  }
  // 이름 클릭 트리거(피드 행 또는 완료 행)
  const nameBtn = page
    .locator('[data-testid="doctor-call-name-chart-btn"], [data-testid="doctor-completed-name-chart-btn"]')
    .first();
  if ((await nameBtn.count()) === 0) return null;
  // disabled(=customer_id 없는) 이름은 차트 미연결 → 활성 버튼만 사용
  if (await nameBtn.isDisabled()) return null;
  const row = nameBtn.locator(
    'xpath=ancestor::li[@data-testid="doctor-call-feed-row" or @data-testid="doctor-completed-row"]',
  );
  return { nameBtn, row };
}

test.describe('T-20260610-VISITLIST-CHART-DRAWER — 이름 클릭 → 진료차트 서랍', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 이름 클릭 → 진료차트 Drawer(full) 오픈, 페이지 이동 없음 ──────────────
  test('AC-1: 환자 이름 클릭 시 진료차트 전체 Drawer가 열린다(페이지 이동 없음)', async ({ page }) => {
    const r = await openDashboardFirstNameRow(page);
    if (!r) {
      test.skip(true, '차트 연결된 진료 호출/완료 행 없음 — 스킵');
      return;
    }
    const urlBefore = page.url();
    await r.nameBtn.click();

    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    // 진료차트 전체 뷰(variant='full') — CHARTBTN '진료차트'와 동일 Drawer
    await expect(drawer).toHaveAttribute('data-variant', 'full');
    // 페이지 이동(네비게이션) 없이 같은 화면 위 오버레이
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();
  });

  // ── AC-1: 이름이 클릭 가능 어포던스(button + cursor-pointer) ─────────────────────
  test('AC-1: 이름은 클릭 가능한 버튼이며 cursor-pointer 식별이 있다', async ({ page }) => {
    const r = await openDashboardFirstNameRow(page);
    if (!r) {
      test.skip(true, '차트 연결된 진료 호출/완료 행 없음 — 스킵');
      return;
    }
    // 버튼 엘리먼트
    await expect(r.nameBtn).toBeVisible();
    const tag = await r.nameBtn.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('button');
    // cursor-pointer 클래스(활성 행)
    await expect(r.nameBtn).toHaveClass(/cursor-pointer/);
  });

  // ── AC-2: Drawer 닫기 후 목록 유지 + 재오픈(같은 Drawer) ─────────────────────────
  test('AC-2: Drawer 닫기 후 목록 유지, 다시 이름 클릭 시 재오픈', async ({ page }) => {
    const r = await openDashboardFirstNameRow(page);
    if (!r) {
      test.skip(true, '차트 연결된 진료 호출/완료 행 없음 — 스킵');
      return;
    }
    await r.nameBtn.click();
    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // 닫기 — Escape(MedicalChartPanel onOpenChange(false)) → Drawer 사라짐
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    // 목록 유지
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();

    // 재오픈 — 같은 Drawer
    await r.nameBtn.click();
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer).toHaveAttribute('data-variant', 'full');
  });

  // ── AC-3 (REGRESSION): 임상경과 = 인라인 아코디언(서랍 아님), 진료차트 버튼 = 이름과 같은 Drawer ──
  test('AC-3: 임상경과 버튼은 행 아래 인라인(서랍 미사용) — 인라인 차팅 회귀 없음', async ({ page }) => {
    const r = await openDashboardFirstNameRow(page);
    if (!r) {
      test.skip(true, '차트 연결된 진료 호출/완료 행 없음 — 스킵');
      return;
    }
    // 같은 행의 '임상경과' 버튼
    const clinicalBtn = r.row
      .locator('[data-testid="doctor-call-chart-btn"], [data-testid="doctor-completed-chart-btn"]')
      .first();
    if ((await clinicalBtn.count()) === 0 || (await clinicalBtn.isDisabled())) {
      test.skip(true, '임상경과 버튼 없음/비활성 — 스킵');
      return;
    }
    await clinicalBtn.click();
    // 인라인 아코디언(embed clinical) 노출 — 포털 Drawer 아님
    const inline = r.row
      .locator('[data-testid="doctor-call-chart-inline"], [data-testid="doctor-completed-chart-inline"]')
      .first();
    await expect(inline).toBeVisible({ timeout: 10_000 });
    // 임상경과는 portal Drawer(medical-chart-drawer)로 열리지 않아야 함(서랍 금지, AC1-1)
    await expect(page.locator('[data-testid="medical-chart-drawer"]')).toHaveCount(0);
  });

  // ── AC-3: '진료차트' 버튼과 이름 클릭이 같은 full Drawer를 연다 ───────────────────
  test('AC-3: 진료차트 버튼도 이름 클릭과 동일한 full Drawer를 연다', async ({ page }) => {
    const r = await openDashboardFirstNameRow(page);
    if (!r) {
      test.skip(true, '차트 연결된 진료 호출/완료 행 없음 — 스킵');
      return;
    }
    const fullBtn = r.row
      .locator('[data-testid="doctor-call-fullchart-btn"], [data-testid="doctor-completed-fullchart-btn"]')
      .first();
    if ((await fullBtn.count()) === 0 || (await fullBtn.isDisabled())) {
      test.skip(true, '진료차트 버튼 없음/비활성 — 스킵');
      return;
    }
    await fullBtn.click();
    const drawer = page.locator('[data-testid="medical-chart-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer).toHaveAttribute('data-variant', 'full');
  });
});
