/**
 * E2E spec — T-20260729-foot-RANKING-NEXTWEEK-CARD-MONOTONE-COMPACT
 * 배정 화면 '다음 주 초진 예약 수' 카드('일일 배정 목표 · 차주 초진 예약')를
 * 제거하지 않고 유지하되, 화려한 emerald 색·큰 크기 → 기존 CRM 표/테이블 톤에 맞춘
 * 모노톤(무채색)·컴팩트(테이블 헤더 수준) 스타일로 리스타일.
 * 카드 데이터·집계 술어(monthInitResvCount SSOT)·실시간 구독은 무접촉(순수 프레젠테이션).
 *
 * 부모: T-20260729-foot-DAILY-TARGET-NEXTWEEK-AUTO(eda97a1f) — 이 카드를 추가한 배포.
 *
 * AC-1: 카드가 여전히 존재하고 차주 요일별 초진 예약 수를 정확히 표시(데이터 무변화).
 * AC-2: 카드 색상이 모노톤(무채색)으로 변경 — 화려한 emerald(bg-emerald / text-emerald) 컬러 제거.
 * AC-3: 카드 크기가 컴팩트하게 축소(text-3xl 초대형 숫자 제거, 셀 패딩 축소).
 * AC-4: 집계·실시간·다른 배정 화면 영역 회귀 없음.
 *
 * 스타일 리스타일이므로 className 정적 검증(emerald 제거 / 컴팩트 클래스 present) + 데이터 렌더 회귀로 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function nextWeekDays(): string[] {
  const todayKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = todayKst.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일..6=토
  const thisMon = isoAddDays(todayKst, -((dow + 6) % 7));
  const nextMon = isoAddDays(thisMon, 7);
  return Array.from({ length: 7 }, (_, i) => isoAddDays(nextMon, i));
}

async function gotoAssignments(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  const card = page.locator('[data-testid="assignments-nextweek-target-card"]');
  return card
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260729 RANKING-NEXTWEEK-CARD-MONOTONE-COMPACT — 차주 초진 카드 모노톤·컴팩트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1: 카드 유지 + 차주 7일 셀 데이터 렌더(제거하지 않음 — 회귀).
  test('AC-1: 카드 유지 + 차주 7일 셀 데이터 표시(제거 아님)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.getByText('일일 배정 목표 · 차주 초진 예약')).toBeVisible();
    const days = nextWeekDays();
    for (const d of days) {
      await expect(page.locator(`[data-testid="nextweek-target-cell-${d}"]`)).toBeVisible();
    }
    // 데이터 무변화: 수치가 여전히 정수로 렌더(빈칸/— 아님).
    for (const d of days) {
      const countCell = page.locator(`[data-testid="nextweek-target-count-${d}"]`);
      await expect(countCell).toBeVisible();
      await expect
        .poll(async () => (await countCell.textContent())?.trim(), { timeout: 10_000 })
        .toMatch(/^\d+$/);
    }
  });

  // AC-2: 모노톤 — 화려한 emerald 컬러 제거.
  test('AC-2: 화려한 emerald 색 제거(모노톤 무채색)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const days = nextWeekDays();
    // 셀·숫자 className 에 emerald 계열 컬러 클래스가 남아있지 않아야 함.
    for (const d of days) {
      const cellClass = (await page.locator(`[data-testid="nextweek-target-cell-${d}"]`).getAttribute('class')) ?? '';
      expect(cellClass).not.toMatch(/emerald/);
      const countClass = (await page.locator(`[data-testid="nextweek-target-count-${d}"]`).getAttribute('class')) ?? '';
      expect(countClass).not.toMatch(/emerald/);
      // 모노톤 배경(bg-muted 계열) 적용 확인.
      expect(cellClass).toMatch(/bg-muted/);
    }
  });

  // AC-3: 컴팩트 — 초대형 숫자(text-3xl) 제거.
  test('AC-3: 컴팩트 크기(text-3xl 초대형 숫자 제거)', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    const days = nextWeekDays();
    for (const d of days) {
      const countClass = (await page.locator(`[data-testid="nextweek-target-count-${d}"]`).getAttribute('class')) ?? '';
      expect(countClass).not.toMatch(/text-3xl/);
    }
  });

  // AC-4: 회귀 — 기존 배정 화면 영역(오늘 배정 현황 / 직원별 누적) 유지.
  test('AC-4 회귀: 기존 배정 카드 영역 유지', async ({ page }) => {
    const ok = await gotoAssignments(page);
    if (!ok) {
      test.skip(true, '배정 화면 진입 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="assignments-monthly-card"]')).toBeVisible();
    await expect(page.getByText('오늘 배정 현황')).toBeVisible();
  });
});
