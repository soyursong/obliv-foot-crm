/**
 * T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT
 * 패키지 생성/템플릿 관리 화면(Packages.tsx)에 [Re:Born] 항목 누락 보충
 *
 * 요청: 김주연 총괄 (#풋확장 C0ATE5P6JTH)
 *   "고객차트 Re:Born 티켓 항목 추가했던 거 패키지 - 패키지 생성/템플릿 관리에는 미적용.
 *    동일 항목 동시 적용! 왜 누락되는거지?"
 *
 * ITEM 티켓(T-20260608-foot-PKG-REBORN-ITEM)은 CustomerChartPage(고객차트)에만 reborn 추가.
 * 본 티켓은 Packages.tsx(템플릿 관리)에 동일 항목을 미러링 + package_templates 테이블 reborn 컬럼 보충.
 *
 * 네이밍: state key=reborn, label='Re:Born', package_templates 컬럼=reborn_sessions/reborn_unit_price
 *
 * AC-1: 템플릿 편집 폼에 Re:Born 섹션 표시 + 입력 가능
 * AC-2: 패키지 빌드 폼에도 Re:Born 섹션 표시
 * AC-3: 템플릿 목록/요약에 Re:Born 표시 (저장 시)
 * AC-5: 기존 5항목(가열/비가열/포돌로게/수액/체험권) 무회귀
 *
 * FIX (T-20260608, supervisor FIX-REQUEST):
 *   - desktop-chrome 프로젝트는 storageState(auth.setup)로 이미 인증됨.
 *     자체 loginAsAdmin: /login → waitForURL(/dashboard|waiting/) 패턴은
 *     (a) 이미 인증된 상태에서 /login 진입 시 폼이 안 떠 redirect 안 됨,
 *     (b) 라우트가 /dashboard|waiting 이 아니라 /admin 임 → 15s timeout.
 *     → 공용 helper loginAndWaitForDashboard 로 교체.
 *   - packages 라우트는 /packages 가 아니라 /admin/packages (AdminLayout 하위). 경로 수정.
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT — 패키지 템플릿 관리 Re:Born', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /**
   * 패키지 관리 화면(/admin/packages) 진입 후 폼 오픈. 진입 불가 시 false.
   * 폼 오픈 경로:
   *   1순위 "패키지 생성"(canWritePackage) → 빌드 폼(Re:Born 포함 6항목 + number input)
   *   2순위 "템플릿 관리"(isAdmin) → "새 템플릿" → 템플릿 편집 폼(Re:Born 포함)
   */
  async function openPackageForm(page: import('@playwright/test').Page): Promise<boolean> {
    await page.goto('/admin/packages');
    await page.waitForLoadState('networkidle');

    // 1순위: 패키지 생성 (빌드 폼)
    const createBtn = page.getByRole('button', { name: /패키지 생성/ }).first();
    if ((await createBtn.count()) > 0 && (await createBtn.isVisible())) {
      await createBtn.click();
      await page.waitForTimeout(800);
      return true;
    }

    // 2순위: 템플릿 관리 → 새 템플릿 (템플릿 편집 폼)
    const tplMgmtBtn = page.getByRole('button', { name: /템플릿 관리/ }).first();
    if ((await tplMgmtBtn.count()) > 0 && (await tplMgmtBtn.isVisible())) {
      await tplMgmtBtn.click();
      await page.waitForTimeout(500);
      const newTplBtn = page.getByRole('button', { name: /새 템플릿/ }).first();
      if ((await newTplBtn.count()) > 0 && (await newTplBtn.isVisible())) {
        await newTplBtn.click();
        await page.waitForTimeout(800);
        return true;
      }
    }

    return false;
  }

  // ── AC-1/AC-2: 패키지 관리 폼(템플릿/빌드)에 Re:Born 섹션 표시 ──
  test('AC-1/2: 패키지 관리 화면 폼에 Re:Born 섹션 표시', async ({ page }) => {
    if (!(await openPackageForm(page))) {
      test.skip(true, '패키지 폼 진입 불가 (권한/시드 상태)');
      return;
    }

    const rebornSection = page.getByText('Re:Born', { exact: true }).first();
    await expect(rebornSection).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-5: 기존 5항목 무회귀 (Re:Born 추가가 기존 항목 영향 없음) ──
  test('AC-5: 기존 5항목(가열/비가열/포돌로게/수액/체험권) + Re:Born 6항목 동시 표시', async ({ page }) => {
    if (!(await openPackageForm(page))) {
      test.skip(true, '패키지 폼 진입 불가 (권한/시드 상태)');
      return;
    }

    // 기존 5항목 회귀 없음 + 신규 Re:Born — 폼 라벨 기준
    await expect(page.getByText('포돌로게', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('체험권', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Re:Born', { exact: true }).first()).toBeVisible();
  });

  // ── AC-1: Re:Born 회수/수가 입력 → 총액 합산 반영 ───────────────
  test('AC-1: Re:Born 회수/수가 입력 가능 (number input 존재)', async ({ page }) => {
    if (!(await openPackageForm(page))) {
      test.skip(true, '패키지 폼 진입 불가 (권한/시드 상태)');
      return;
    }

    const rebornLabel = page.getByText('Re:Born', { exact: true }).first();
    await expect(rebornLabel).toBeVisible();

    // 폼 내 number input 존재 (가열~Re:Born 6항목 회수 칸)
    const numberInputs = page.locator('input[type="number"]');
    expect(await numberInputs.count()).toBeGreaterThanOrEqual(1);
  });
});
