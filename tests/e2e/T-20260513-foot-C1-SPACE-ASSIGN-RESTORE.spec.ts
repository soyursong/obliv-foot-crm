/**
 * E2E spec — T-20260513-foot-C1-SPACE-ASSIGN-RESTORE  (SUPERSEDED → 현행 설계 정합 재작성)
 * 1번차트(CheckInDetailSheet) 공간배정 항목 — 금일 동선 자동집계 체계로 전환됨.
 *
 * ── 이력 (왜 이 spec 이 바뀌었나) ───────────────────────────────────────────
 *   원본(2026-05-13)은 1번차트에 "체크리스트 / 동의서" 텍스트 + 수동 공간배정
 *   드롭다운([data-testid="space-assign-select"]) + [배정] 버튼
 *   ([data-testid="space-assign-btn"]) + 이동이력 배지를 기대했다.
 *
 *   이후 승인·배포된 두 티켓이 그 UI 를 의도적으로 제거했다:
 *     • T-20260522-foot-CHART1-TRIM    — "체크리스트 / 동의서" 섹션 제거(펜차트 양식 대체)
 *     • T-20260522-foot-SPACE-AUTOROUTE — 수동 공간배정 드롭다운 + [배정] 버튼 완전 제거,
 *                                         "금일 동선" check_in_room_logs 자동집계로 전환.
 *
 *   따라서 원본 AC-1/AC-5 의 locator(체크리스트/동의서 텍스트·space-assign-select·
 *   space-assign-btn)는 현행 UI 에 더 이상 존재하지 않아 false-regression 으로 실패했다.
 *   (supervisor QA: T-20260608-foot-SPACE-RESET-RECUR4 phase2 spec_fail_regression)
 *
 *   이 spec 은 현행 설계(금일 동선 섹션)에 맞춰 재정의한다. 제거된 수동 UI 는 "부재"로
 *   고정 검증하여 회귀(실수로 되살아남)를 역으로 막는다. 자동집계 동작의 풀 커버리지는
 *   T-20260522-foot-SPACE-AUTOROUTE.spec.ts 가 담당한다(중복 회피).
 *
 * AC-1(재정의): [공간배정 섹션] = "금일 동선"([data-testid="space-assign-section"])이 1번차트에 표시됨
 * AC-2(재정의): 제거된 수동 UI 부재 — 체크리스트/동의서 텍스트·space-assign-select·space-assign-btn 미존재
 * AC-5(재정의): 공간배정 섹션이 에러 없이 정상 렌더(에러 텍스트/토스트 없음)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openFirstChart(page: Page): Promise<boolean> {
  await page.goto('/admin/dashboard');
  const slot = page
    .locator('[data-testid="checkin-card"], [class*="check-in"], [class*="kanban"] [role="button"]')
    .first();
  try {
    await slot.waitFor({ timeout: 10_000 });
  } catch {
    return false;
  }
  await slot.click();
  const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
  try {
    await sheet.waitFor({ timeout: 6_000 });
  } catch {
    return false;
  }
  return true;
}

test.describe('T-20260513-foot-C1-SPACE-ASSIGN-RESTORE 공간배정(금일 동선 전환) 회귀', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 1번차트에 [공간배정=금일 동선] 섹션이 표시됨', async ({ page }) => {
    if (!(await openFirstChart(page))) {
      test.skip(true, '체크인 슬롯/1번차트 미발견 — 더미 데이터 없음');
      return;
    }

    // AC-1: 공간배정 섹션(현행 = "금일 동선") 표시 확인
    const spaceSection = page.locator('[data-testid="space-assign-section"]');
    await expect(spaceSection).toBeVisible({ timeout: 5_000 });
    console.log('[AC-1] 공간배정(금일 동선) 섹션 표시 OK');

    // 현행 레이블은 "금일 동선" (SPACE-AUTOROUTE 전환)
    await expect(page.getByText('금일 동선').first()).toBeVisible();
    console.log('[AC-1] "금일 동선" 레이블 표시 OK');
  });

  test('AC-2: 제거된 수동 공간배정 UI 부재 (CHART1-TRIM + SPACE-AUTOROUTE 회귀 방어)', async ({ page }) => {
    if (!(await openFirstChart(page))) {
      test.skip(true, '체크인 슬롯/1번차트 미발견');
      return;
    }

    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();

    // CHART1-TRIM: "체크리스트 / 동의서" 텍스트 제거됨
    expect(
      await sheet.getByText('체크리스트 / 동의서').count(),
      'CHART1-TRIM: "체크리스트 / 동의서" 텍스트가 되살아나면 안 됨',
    ).toBe(0);

    // SPACE-AUTOROUTE: 수동 공간배정 드롭다운/버튼 제거됨
    expect(
      await page.locator('[data-testid="space-assign-select"]').count(),
      'SPACE-AUTOROUTE: 수동 공간배정 드롭다운이 되살아나면 안 됨',
    ).toBe(0);
    expect(
      await page.locator('[data-testid="space-assign-btn"]').count(),
      'SPACE-AUTOROUTE: 수동 [배정] 버튼이 되살아나면 안 됨',
    ).toBe(0);

    console.log('[AC-2] 제거된 수동 공간배정 UI 부재 확인 OK');
  });

  test('AC-5: 공간배정(금일 동선) 섹션 — 에러 없이 정상 렌더', async ({ page }) => {
    if (!(await openFirstChart(page))) {
      test.skip(true, '체크인 슬롯/1번차트 미발견');
      return;
    }

    const spaceSection = page.locator('[data-testid="space-assign-section"]');
    await expect(spaceSection).toBeVisible({ timeout: 5_000 });

    // 금일 동선 로그 영역 존재(슬롯 배지 컨테이너)
    await expect(page.locator('[data-testid="daily-room-log-section"]')).toBeVisible();

    // 에러 텍스트 미노출
    const errorText = await page.locator('text=오류, text=에러, text=undefined').count();
    expect(errorText).toBe(0);

    // 에러 토스트 미노출
    const errorToast = await page.locator('[data-sonner-toast][data-type="error"]').count();
    expect(errorToast).toBe(0);

    console.log('[AC-5] 공간배정(금일 동선) UI 정상 렌더링 OK (에러 없음)');
  });
});
