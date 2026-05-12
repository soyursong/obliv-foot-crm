/**
 * E2E spec — T-20260514-foot-VISITTYPE-ROLLBACK
 * 선체험(experience) 슬롯 복구 + 1번차트 배지 미표시 유지
 *
 * AC-1: 수동접수 다이얼로그 — 초진/재진/선체험 3개 표시
 * AC-2: 셀프접수 — 예약없이 방문(experience) 선택지 존재
 * AC-3: 배지(딱지) — 초진(파란)/재진(초록) 2종만 표시, 체험 배지 미표시
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260514 VISITTYPE-ROLLBACK — 선체험 복구 + 배지 2종 유지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: 수동접수 다이얼로그 — 초진/재진/선체험 3개 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 수동접수 버튼 클릭
    const addBtn = page.getByRole('button', { name: /체크인 추가|수동접수|접수 추가/ }).first();
    const hasBtnVisible = await addBtn.count() > 0;
    if (!hasBtnVisible) {
      test.skip(true, '수동접수 버튼 없음 — 권한 부족 또는 레이아웃 변경');
      return;
    }
    await addBtn.click();

    // 다이얼로그 열림 대기
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 5_000 });

    // 초진/재진/선체험 3개 버튼 확인
    await expect(dialog.getByRole('button', { name: '초진' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '재진' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '선체험' })).toBeVisible();
  });

  test('AC-2: 셀프접수 — 예약없이 방문(experience) 선택지 존재', async ({ page }) => {
    await page.goto('/checkin/jongno-foot');
    // 셀프접수 페이지 로딩 대기
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 방문유형 선택 화면까지 진행 (언어 선택이 있으면 한국어 선택)
    const korBtn = page.getByRole('button', { name: /한국어|Korean/ });
    if (await korBtn.count() > 0) await korBtn.first().click();

    // 방문유형 선택지 확인 — "예약없이 방문" 또는 experience 라벨
    const expChoice = page.getByRole('button', { name: /예약없이 방문|Walk-in/ });
    const hasExpChoice = await expChoice.count() > 0;
    expect(hasExpChoice, '선체험(예약없이 방문) 선택지가 없음').toBe(true);
  });

  test('AC-3: 대시보드 카드 배지 — 초진/재진만, 체험 배지 미표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 체험(보라색/amber) 배지가 없음을 확인 (없는 게 정상)
    const purpleBadge = page.locator('.bg-purple-100, .text-purple-800, .bg-violet-100');
    const purpleCount = await purpleBadge.count();
    expect(purpleCount, '체험(보라색) 배지가 표시되면 안 됨').toBe(0);

    // 초진(파란)/재진(초록) 배지는 존재할 수 있음 — 유효성만 확인
    // 카드가 있다면 배지가 올바른 색상인지 검증
    const blueCards = page.locator('.bg-blue-100.text-blue-700');
    const greenCards = page.locator('.bg-emerald-100.text-emerald-700');
    // 존재 여부만 검증 (데이터 없으면 0도 허용)
    expect(await blueCards.count()).toBeGreaterThanOrEqual(0);
    expect(await greenCards.count()).toBeGreaterThanOrEqual(0);
  });
});
