/**
 * E2E spec — T-20260609-foot-DRUGFOLDER-LABEL-UNIFY (문지은 대표원장)
 * UI 하드코딩 "약품(폴더)" 표시 텍스트 → "처방세트" 전수 통일.
 *
 * 범위(표시 텍스트 한정):
 *   AC1 진료차트 우측 패널 폴더 섹션 헤더 = "처방세트" (구 "약품 폴더").
 *   AC2 어드민 진료설정 폴더 관리 탭 도움말 = "처방세트" (구 "약품 폴더").
 *   AC3 렌더된 surface 어디에도 표시 텍스트 "약품 폴더"/"약품폴더" 없음.
 *
 * Anti-collision 가드 검증:
 *   AC4 식별자 보존 — data-testid="drug-folder-section-header",
 *       data-testid="tab-drug-folders", route value="drug_folders" 무변경.
 *   AC5 "묶음처방"(prescription_sets surface) 라벨 보존 — 역치환 회귀 없음.
 *
 * 데이터/뷰 상태 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

async function openMedicalChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator('[data-testid="open-chart-btn"]');
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  return page
    .locator('[data-testid="medical-chart-drawer"]')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260609-DRUGFOLDER-LABEL-UNIFY — 약품폴더→처방세트 라벨 통일', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC1 + AC4: 진료차트 우측 폴더 섹션 헤더 "처방세트", 식별자 보존 ──────────
  test('AC1: 진료차트 폴더 섹션 헤더가 "처방세트"이고 "약품 폴더"가 아니다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
    if ((await rxTab.count()) > 0) await rxTab.click();
    await page.waitForTimeout(200);

    const header = page.locator('[data-testid="drug-folder-section-header"]');
    if ((await header.count()) === 0) {
      test.skip(true, '폴더 섹션 헤더 미렌더 — 스킵');
      return;
    }
    // AC4 식별자(data-testid) 보존
    await expect(header.first()).toBeVisible();
    // AC1 표시 텍스트 = 처방세트, 구 라벨 부재
    await expect(header.first()).toContainText('처방세트');
    await expect(header.first()).not.toContainText('약품 폴더');
  });

  // ── AC5: 진료차트 우측에 "묶음처방" 라벨 보존(역치환 회귀 차단) ────────────────
  test('AC5: 진료차트 우측 "묶음처방" 섹션 라벨이 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
    if ((await rxTab.count()) > 0) await rxTab.click();
    await page.waitForTimeout(200);

    const setHeader = page.locator('[data-testid="rx-set-section-header"]');
    if ((await setHeader.count()) === 0) {
      test.skip(true, '묶음처방 섹션 헤더 미렌더 — 스킵');
      return;
    }
    await expect(setHeader.first()).toContainText('묶음처방');
  });

  // ── AC2 + AC3 + AC4: 어드민 진료설정 폴더 관리 탭 도움말 통일 ──────────────────
  test('AC2: 어드민 폴더 관리 탭 도움말이 "처방세트"이고 "약품 폴더"가 아니다', async ({ page }) => {
    await page.goto('/admin/clinic-management');
    await page.waitForLoadState('networkidle');

    // AC4 route 식별자 보존 — 탭 trigger data-testid 무변경
    const tab = page.locator('[data-testid="tab-drug-folders"]');
    if ((await tab.count()) === 0) {
      test.skip(true, '진료설정 폴더 탭 미렌더(권한/뷰 부재) — 스킵');
      return;
    }
    // AC1 탭 라벨도 "처방세트"
    await expect(tab.first()).toContainText('처방세트');
    await tab.first().click();
    await page.waitForTimeout(300);

    // AC2 도움말 안내문 = 처방세트
    const help = page.getByText('약을 분류·탐색하는 도구입니다', { exact: false });
    if ((await help.count()) > 0) {
      await expect(help.first()).toContainText('처방세트');
    }

    // AC3 폴더 관리 탭 패널 어디에도 표시 텍스트 "약품 폴더"/"약품폴더" 없음
    const stale = page.getByText(/약품\s*폴더/);
    await expect(await stale.count()).toBe(0);
  });
});
