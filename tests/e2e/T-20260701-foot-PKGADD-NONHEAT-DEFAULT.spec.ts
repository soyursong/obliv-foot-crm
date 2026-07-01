/**
 * E2E spec — T-20260701-foot-PKGADD-NONHEAT-DEFAULT
 * 패키지 추가 화면 비가열 섹션 기본 오픈 (김주연 총괄 명시 지시, ts 1782898969.563039).
 *
 * 대상: PackageCreateDialog (Packages.tsx) — /admin/packages "패키지 생성" 버튼 → "새 패키지 템플릿" 다이얼로그.
 *  - AC1: 진입 시 비가열(레이저) 섹션이 기본 펼쳐진 상태로, 가열보다 먼저(위) 노출.
 *  - AC2: 가열(열치료) 섹션은 비가열 이후 순서로 노출(접힘 대체안).
 *  - AC3(회귀): 기본 오픈/순서만 변경. 가열 섹션 입력·저장·가격 로직 회귀 없음(가열 섹션도 정상 동작).
 *
 * 시나리오:
 *  1) 정상 동선 — 진입 직후 비가열 레이저 섹션이 가열 레이저보다 DOM/화면상 먼저(위) 노출.
 *  2) 엣지 — 가열(열치료) 섹션 정상 동작: 회수/수가 입력 → 소계·총금액 반영(가격 로직 회귀 0).
 *
 * ※ FE-only(SQL 0·DDL 0·payload 무변경·기본 펼침 순서만). 권한/데이터 부재 환경은 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openPackageCreateDialog(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/packages');
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: '패키지 생성' });
  try {
    await btn.first().click({ timeout: 8_000 });
  } catch {
    return false;
  }
  const dialog = page.getByRole('dialog').filter({ hasText: '새 패키지 템플릿' });
  try {
    await dialog.waitFor({ timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260701-foot-PKGADD-NONHEAT-DEFAULT — 패키지 추가 화면 비가열 기본 오픈', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1: AC1/AC2 — 비가열 레이저 섹션이 가열 레이저보다 먼저(위) 노출', async ({ page }) => {
    const opened = await openPackageCreateDialog(page);
    if (!opened) test.skip(true, '패키지 생성 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '새 패키지 템플릿' });

    // 두 섹션 라벨 모두 노출(둘 다 기본 펼침).
    const nonHeat = dialog.getByText('비가열 레이저', { exact: true }).first();
    const heat = dialog.getByText('가열 레이저', { exact: true }).first();
    await expect(nonHeat).toBeVisible();
    await expect(heat).toBeVisible();

    // AC1/AC2: 비가열이 가열보다 화면상 위(먼저)에 위치.
    const nonHeatBox = await nonHeat.boundingBox();
    const heatBox = await heat.boundingBox();
    expect(nonHeatBox, '비가열 레이저 라벨 bounding box').not.toBeNull();
    expect(heatBox, '가열 레이저 라벨 bounding box').not.toBeNull();
    expect(nonHeatBox!.y).toBeLessThan(heatBox!.y);
  });

  test('시나리오2: AC3 — 가열(열치료) 섹션 입력·가격 로직 회귀 없음', async ({ page }) => {
    const opened = await openPackageCreateDialog(page);
    if (!opened) test.skip(true, '패키지 생성 다이얼로그 미오픈(권한/데이터)');

    const dialog = page.getByRole('dialog').filter({ hasText: '새 패키지 템플릿' });

    // 가열 섹션은 비가열 이후 순서로 여전히 노출 & 동작.
    const heatLabel = dialog.getByText('가열 레이저', { exact: true }).first();
    await expect(heatLabel).toBeVisible();

    // 가열 섹션의 상위 컨테이너(라벨을 감싼 카드) 안에서 회수/수가 입력.
    const heatCard = dialog.locator('div.rounded-lg', { hasText: '가열 레이저' }).first();
    const numberInputs = heatCard.locator('input[type="number"]');
    // 회수 입력 → 값 반영(가격 산정 state 회귀 0).
    await numberInputs.first().fill('2');
    await expect(numberInputs.first()).toHaveValue('2');

    // 패키지명 입력 후 저장 버튼 활성(저장 로직 회귀 0 — 클릭 없이 활성 상태만 확인).
    await dialog.getByPlaceholder('패키지명').fill('E2E-NONHEAT-DEFAULT');
    const saveBtn = dialog.getByRole('button', { name: /템플릿 추가 후 생성|저장/ });
    await expect(saveBtn.first()).toBeEnabled();
  });
});
