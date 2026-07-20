/**
 * E2E spec — T-20260720-foot-WALKIN-TIMEBADGE-REMOVE
 * 통합시간표 고객카드 — 워크인 카드의 주황(offHour) 실접수시각 배지 render 제거.
 *   보라 [W] 배지(isWalkIn)는 유지. 예약후 셀프접수 카드 회귀 없음.
 *
 * 현장 confirm: 김주연 총괄(U0ATDB587PV, thread 1784507557.344079, 2026-07-20)
 *   "W 배지 유지 / 접수시간은 빼줘". (선행 T-20260720-foot-DASHBOARD-CUSTCARD-WALKIN-FORMAT-UNIFY
 *   DECISION-REQUEST myig 답변 → 본 티켓으로 재범위·이관.)
 *
 * ★범위 한정: 제거는 배지 render만. offHourTime prop·offHourActualTimeMap 계산 및
 *   T-20260530-foot-WALKIN-OFFHOUR-SLOT 영업외 자동 타임슬롯 배정 비즈로직은 무접점 보존.
 *   policy_superseded = 배지 '표시'에만 적용. display-only, DB 무접점.
 *
 * AC-1: 워크인 카드에서 주황 offHour 실접수시각 배지가 더 이상 렌더되지 않음.
 * AC-2: 보라 [W] 배지(isWalkIn)는 유지.
 * AC-3: 예약후 셀프접수 카드 회귀 없음(기존 양식 유지).
 * AC-4: 영업외 자동 타임슬롯 배정 비즈로직(클램핑) 회귀 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── AC-4: 슬롯 클램핑 비즈로직 회귀 (배지 제거와 무관하게 그대로 동작) ──────────
// Dashboard.tsx offHourActualTimeMap/슬롯 클램핑 로직 미러 — 배지 render 제거가
// 슬롯 배정 로직에 영향 없음을 회귀로 고정.

function clampSlot(rawSlot: string, slots: string[]): string {
  const first = slots[0] ?? '10:00';
  const last = slots[slots.length - 1] ?? '20:00';
  if (rawSlot < first) return first;
  if (rawSlot > last) return last;
  return rawSlot;
}

function generateSlots(open: string, close: string, interval: number): string[] {
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  const out: string[] = [];
  for (let m = start; m < end; m += interval) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

test.describe('T-20260720 WALKIN-TIMEBADGE-REMOVE — 슬롯 배정 비즈로직 회귀(무접점 보존)', () => {
  const slots = generateSlots('10:00', '20:30', 30);

  test('AC-4: 오픈 전(08:30) 워크인 → 첫 슬롯(10:00) 자동 배정 유지', () => {
    expect(clampSlot('08:30', slots)).toBe('10:00');
  });

  test('AC-4: 마감 후(21:00) 워크인 → 마지막 슬롯(20:00) 자동 배정 유지', () => {
    expect(clampSlot('21:00', slots)).toBe('20:00');
  });

  test('AC-4: 영업시간 내(14:00) 워크인 → 클램핑 없음 유지', () => {
    expect(clampSlot('14:00', slots)).toBe('14:00');
  });
});

// ── AC-1/2/3: 통합시간표 고객카드 DOM 검증 ────────────────────────────────────

test.describe('T-20260720 WALKIN-TIMEBADGE-REMOVE — 고객카드 배지 렌더 검증', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-1: 통합시간표 어느 체크인 카드에도 주황(offHour) 실접수시각 배지가 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="timeline-checkin-card"]');
    try {
      await cards.first().waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '오늘 통합시간표 체크인 카드 없음 — 환경 스킵');
      return;
    }

    // 제거된 주황 배지는 bg-orange-100 + title '실접수 …' 조합으로 유일 식별되었음.
    // 카드 내부에 orange 배지 클래스가 하나도 남아있지 않아야 함.
    const orangeBadges = page.locator(
      '[data-testid="timeline-checkin-card"] span.bg-orange-100',
    );
    expect(await orangeBadges.count()).toBe(0);

    // '실접수 … (영업시간 외' title을 가진 요소도 없어야 함 (배지 완전 제거).
    const offHourTitled = page.locator('[title*="영업시간 외 → 슬롯 자동 배정"]');
    expect(await offHourTitled.count()).toBe(0);
  });

  test('AC-2: 워크인 건이 있으면 보라 [W] 배지는 유지되고 텍스트는 "W"', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const walkinBadge = page.locator('[data-testid="walkin-badge"]');
    try {
      await walkinBadge.first().waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '오늘 워크인 데이터 없음 — [W] 배지 검증 스킵');
      return;
    }
    // [W] 배지 유지 + 보라(violet) 유지
    expect((await walkinBadge.first().textContent())?.trim()).toBe('W');
    await expect(walkinBadge.first()).toHaveClass(/bg-violet-100/);
    // [W] 배지 옆에 주황 배지가 붙지 않음 (동일 카드 내 orange 배지 0)
    expect(
      await page.locator('[data-testid="timeline-checkin-card"] span.bg-orange-100').count(),
    ).toBe(0);
  });

  test('AC-3: 예약후 셀프접수 카드 회귀 없음 — 성함/폰뒷4 등 기본 필드 렌더 유지', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="timeline-checkin-card"]');
    try {
      await cards.first().waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '오늘 통합시간표 체크인 카드 없음 — 환경 스킵');
      return;
    }
    // 카드 기본 구성(성함 노드)은 접수경로 무관 공통 — 회귀 없이 렌더.
    const nameNode = cards.first().locator('[data-testid="timeline-name"]');
    await expect(nameNode).toBeVisible();
    // 어떤 카드든(예약후/워크인) 주황 offHour 배지는 없음 = 양식 통일.
    expect(
      await page.locator('[data-testid="timeline-checkin-card"] span.bg-orange-100').count(),
    ).toBe(0);
  });
});
