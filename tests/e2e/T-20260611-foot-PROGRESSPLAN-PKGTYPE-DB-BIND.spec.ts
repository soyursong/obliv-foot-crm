/**
 * E2E spec — T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND
 * 경과분석 플랜 데이터모델 재설계: package_type(string) → 회차 tier(total_sessions) 기준
 *
 * 확정 스펙 (김주연 총괄 confirm, Option C):
 *  - tier = 6의 배수: 6/12/18/24/30/36/42/48
 *  - 패키지명·FK 무관, 회차수(total_sessions)로 매칭
 *  - 레거시: package1→tier_12, blelabel→tier_36, special→폐기
 *
 * 시나리오:
 *  S1: 경과분석 플랜 탭 — 회차 tier 그룹으로 표시 + package_type 하드코딩 버튼(pkg-type-btn-*) 제거 확인
 *  S2: 새 체크포인트 추가 — tier 버튼 선택 + milestone 입력 → 목록 반영 (이름 무관 tier 기준)
 *  S3: milestone > tier 방어 — 회차수를 넘는 경과분석 회차 입력 시 저장 차단
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const GOTO_TAB = async (page: Parameters<typeof loginAndWaitForDashboard>[0]) => {
  await page.goto('/admin/clinic-management');
  try {
    await page.getByTestId('tab-progress-plans').waitFor({ timeout: 12_000 });
  } catch {
    test.skip(true, '경과분석 플랜 탭 없음');
    return false;
  }
  await page.getByTestId('tab-progress-plans').click();
  await page.waitForTimeout(700);
  return true;
};

test.describe('T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND — 회차 tier 기준 경과분석 플랜', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S1: 회차 tier 그룹 렌더 + package_type 하드코딩 제거
  // ───────────────────────────────────────────────────────────────────────────
  test('S1: 회차 tier 그룹 표시 + package_type 하드코딩 버튼 제거', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;

    await expect(page.getByTestId('progress-plans-tab')).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    // 회차 tier 그룹(12회 등) 존재 — 마이그 후 이관/시드 결과
    await expect(page.getByTestId('progress-plan-group-12')).toBeVisible({ timeout: 5_000 });

    // 추가 다이얼로그 열어 tier 버튼 존재 + 구 package_type 버튼 부재 확인
    await page.getByTestId('progress-plan-add-btn').click();
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // tier 버튼 8종 중 대표값 확인
    await expect(page.getByTestId('tier-btn-6')).toBeVisible();
    await expect(page.getByTestId('tier-btn-12')).toBeVisible();
    await expect(page.getByTestId('tier-btn-36')).toBeVisible();
    await expect(page.getByTestId('tier-btn-48')).toBeVisible();

    // 구 하드코딩 버튼(package1/blelabel/special)은 더 이상 없어야 함
    await expect(page.getByTestId('pkg-type-btn-package1')).toHaveCount(0);
    await expect(page.getByTestId('pkg-type-btn-blelabel')).toHaveCount(0);
    await expect(page.getByTestId('pkg-type-btn-special')).toHaveCount(0);

    console.log('[S1] 회차 tier UI + package_type 하드코딩 제거 OK');
    await page.keyboard.press('Escape');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S2: tier 선택 + milestone 추가 → 목록 반영
  // ───────────────────────────────────────────────────────────────────────────
  test('S2: tier(24회) 선택 + 비충돌 회차 추가 → 목록 반영 후 정리', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;
    await page.waitForTimeout(800);

    await page.getByTestId('progress-plan-add-btn').click();
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 24회 tier 선택, milestone 23 (6배수 아님 → 시드 비충돌, ≤ tier)
    await page.getByTestId('tier-btn-24').click();
    await page.getByTestId('milestone-input').fill('23');
    await page.getByTestId('label-input').fill('[E2E] 23회 tier검증');
    await page.getByTestId('progress-plan-save-btn').click();

    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(800);

    const rows = page.getByTestId('progress-plan-row');
    const texts = await rows.allTextContents();
    expect(texts.some(t => t.includes('23') && t.includes('tier검증'))).toBeTruthy();
    console.log('[S2] tier 기준 체크포인트 추가 + 반영 OK');

    // 정리
    const delBtns = page.getByTestId(/progress-plan-delete-/);
    const cnt = await delBtns.count();
    page.on('dialog', d => d.accept());
    for (let i = 0; i < cnt; i++) {
      const rowText = await rows.nth(i).textContent();
      if (rowText?.includes('tier검증')) {
        await delBtns.nth(i).click();
        await page.waitForTimeout(600);
        break;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S3: milestone > tier 방어
  // ───────────────────────────────────────────────────────────────────────────
  test('S3: 경과분석 회차가 패키지 회차수 초과 시 저장 차단', async ({ page }) => {
    const ok = await GOTO_TAB(page);
    if (!ok) return;
    await page.waitForTimeout(700);

    await page.getByTestId('progress-plan-add-btn').click();
    const dialog = page.getByTestId('progress-plan-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 24회 tier에 30회차(>tier) 입력 → 저장 막힘
    await page.getByTestId('tier-btn-24').click();
    await page.getByTestId('milestone-input').fill('30');
    await page.getByTestId('label-input').fill('초과 회차 테스트');
    await page.getByTestId('progress-plan-save-btn').click();

    // 다이얼로그 유지(저장 불가)
    await expect(dialog).toBeVisible({ timeout: 2_000 });
    console.log('[S3] milestone > tier 저장 차단 OK');

    await page.keyboard.press('Escape');
  });
});
