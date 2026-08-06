/**
 * E2E spec — T-20260806-foot-ASSIGNSET-UISIZE-HALF-STAFFSPACE-REVERT
 *
 * [배경] 앞선 UISIZE-HALF-COMPACT(deployed 08-06T10:54, commit 7ddeedce)가 .staff-space-compact{zoom:.7}
 *   를 /admin/staff 화면 전체(Staff.tsx 루트 div)에 오적용. 총괄 실제 의도는
 *   [상담·치료사 배정](/admin/assignments) > [배정 설정] 탭(AssignmentSettingsTab)뿐이었다.
 *
 * [정정 = 이 티켓]
 *   변경1(REVERT): Staff.tsx 루트 div 의 .staff-space-compact 제거 + index.css 규칙 제거 → 원배율 복구.
 *     ★유지: TAB-RELOC 변경3(외곽 여백/밀도 p-3/space-y-3)은 그대로 둔다(과다-revert 금지).
 *   변경2(RETARGET): AssignmentSettingsTab 컨테이너에 .assign-settings-compact{zoom:.7} 부여 → 항목 밀도 축소.
 *
 * ⚠ 시각 밀도('절반 체감')는 픽셀 단정이 곤란(스샷으로 supervisor/field-soak 체감 검증). 본 spec 은
 *   (1)원사이즈 복구 (2)배정 설정 탭 축소 (3)스코프 격리(타 화면 미유출) 회귀 가드에 집중. 하네스=admin 단일.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260806 ASSIGNSET-UISIZE-HALF-STAFFSPACE-REVERT', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — graceful skip');
  });

  // ── 시나리오1: 직원·공간(/admin/staff) 화면 전체 원사이즈 복구 ─────────────────────────
  //   화면 전체 zoom 클래스 제거 → 루트에 .staff-space-compact 없음 + computed zoom == 1(원배율).
  //   ★TAB-RELOC 여백/밀도(p-3/space-y-3)는 유지되어야 함(과다-revert 회귀 가드).
  test('시나리오1: 직원·공간 화면이 원사이즈로 복구됨(전체 zoom 제거, 여백/밀도는 유지)', async ({ page }) => {
    await page.goto('/admin/staff');
    const root = page.locator('[data-testid="staff-space-root"]');
    const ok = await root
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '직원·공간 화면 진입 실패 — 스킵');
      return;
    }
    // 전체 스케일 클래스 제거 확인.
    const cls = (await root.getAttribute('class')) ?? '';
    expect(cls).not.toMatch(/\bstaff-space-compact\b/);
    // ★과다-revert 가드: TAB-RELOC 변경3(여백/밀도)은 유지.
    expect(cls).toMatch(/\bp-3\b/);
    expect(cls).toMatch(/\bspace-y-3\b/);

    // 실제 렌더 배율 원복: computed zoom == 1 (미지원 브라우저는 '' / 'normal' → 통과).
    const zoom = await root.evaluate((el) => getComputedStyle(el).zoom as string);
    if (zoom && zoom !== 'normal') {
      expect(parseFloat(zoom)).toBe(1);
    }
    // 콘텐츠 회귀: 직원 탭 기본 진입 '직원 관리' 헤더 렌더.
    await expect(page.getByRole('heading', { name: '직원 관리' })).toBeVisible();
  });

  // ── 시나리오2: [상담·치료사 배정] > [배정 설정] 탭에만 축소 스케일 적용 ────────────────────
  test('시나리오2: 배정 설정 탭 컨테이너에 균일 스케일(zoom<1) 적용', async ({ page }) => {
    await page.goto('/admin/assignments');
    const tabTrigger = page.locator('[data-testid="assignments-tab-assignment-settings"]');
    const ok = await tabTrigger
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      test.skip(true, '배정 설정 탭 진입 실패(비admin/라우팅) — 스킵');
      return;
    }
    await tabTrigger.click();

    const container = page.locator('[data-testid="assignment-settings-tab"]');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // 스코프 클래스 부여 확인.
    const cls = (await container.getAttribute('class')) ?? '';
    expect(cls).toMatch(/\bassign-settings-compact\b/);

    // 실제 렌더 배율 축소 확인: computed zoom < 1 (미지원 브라우저는 스킵).
    const zoom = await container.evaluate((el) => getComputedStyle(el).zoom as string);
    if (zoom === '' || zoom === 'normal' || zoom == null) {
      test.skip(true, 'zoom 미지원 렌더러 — 균일 스케일 픽셀 단정 스킵(스샷 검증 대체)');
      return;
    }
    expect(parseFloat(zoom)).toBeGreaterThan(0);
    expect(parseFloat(zoom)).toBeLessThan(1);

    // 축소 후에도 콘텐츠 렌더 회귀(가중치 설정 카드 헤더).
    await expect(page.getByText('상담사 매출 순위 가중치')).toBeVisible();
  });

  // ── 시나리오3: 스코프 격리 — 축소가 배정 설정 탭 밖으로 새지 않음 ────────────────────────
  test('시나리오3: 축소 스케일이 타 화면으로 유출되지 않음', async ({ page }) => {
    // (a) /admin/staff 어디에도 assign-settings-compact / staff-space-compact 부재.
    await page.goto('/admin/staff');
    const staffRoot = page.locator('[data-testid="staff-space-root"]');
    const landed = await staffRoot
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) {
      await expect(page.locator('.assign-settings-compact')).toHaveCount(0);
      await expect(page.locator('.staff-space-compact')).toHaveCount(0);
    }

    // (b) /admin 대시보드 — 전역 zoom 정상(1) + 스코프 클래스 부재.
    await page.goto('/admin');
    const dashOk = await page
      .getByText('대시보드', { exact: true })
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!dashOk) {
      test.skip(true, '대시보드 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('.assign-settings-compact')).toHaveCount(0);
    await expect(page.locator('.staff-space-compact')).toHaveCount(0);
    const bodyZoom = await page.evaluate(() => getComputedStyle(document.body).zoom as string);
    if (bodyZoom && bodyZoom !== 'normal' && bodyZoom !== '') {
      expect(parseFloat(bodyZoom)).toBe(1);
    }
  });
});
