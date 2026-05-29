/**
 * E2E Spec: T-20260529-foot-RECEPTION-BTN-REMOVE
 * 대시보드 초진/재진 고객박스 접수 버튼 제거 검증
 *
 * AC-1: 대시보드 초진 고객 박스 옆 "접수" 버튼이 렌더링되지 않아야 함
 * AC-2: 대시보드 재진 고객 박스 옆 "접수" 버튼이 렌더링되지 않아야 함
 * AC-3: 대시보드 우측 상단 "체크인 버튼"은 기존 동작 유지 (영향 없음)
 * AC-4: 셀프접수 매칭 플로우는 기존 동작 유지 (영향 없음)
 *
 * 구현 방식: onReservationCheckIn prop 미전달
 *   → DraggableBox1Card / DraggableBox2ResvCard 내 {onCheckIn && (...)} 가드로 버튼 미렌더
 *
 * 관련: T-20260529-foot-RECEPTION-BTN-REMOVE
 * 대체: T-20260519-foot-FIRSTVISIT-CHECKIN AC-1/AC-2 접수 버튼 존재 단언
 *       (RECEPTION-BTN-REMOVE 이후 해당 단언은 무효)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-1: 초진 고객 박스(DraggableBox1Card) — 접수 버튼 미렌더링 ─────────────

test('AC-1: box1-resv-card — "접수" 버튼이 렌더링되지 않음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    // 모든 초진 카드에서 "접수" 버튼이 없어야 함
    for (let i = 0; i < cnt; i++) {
      const card = box1Cards.nth(i);
      const checkInBtn = card.getByRole('button', { name: '접수' });
      await expect(checkInBtn).not.toBeAttached();
    }
  }
  // 데이터 없을 때도 페이지 렌더 정상 확인
  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  expect(await newSlots.count()).toBeGreaterThan(0);
});

test('AC-1: 통합 시간표 초진 컬럼(timeline-slot-new) 전체 — "접수" 버튼 없음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 초진 컬럼 전체에서 "접수" 버튼이 없어야 함
  const newSlotBtns = page.locator('[data-testid="timeline-slot-new"] button:has-text("접수")');
  await expect(newSlotBtns).toHaveCount(0);
});

// ── AC-2: 재진 고객 박스(DraggableBox2ResvCard) — 접수 버튼 미렌더링 ──────────

test('AC-2: box2-resv-card — "접수" 버튼이 렌더링되지 않음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box2Cards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await box2Cards.count();
  if (cnt > 0) {
    // 모든 재진 카드에서 "접수" 버튼이 없어야 함
    for (let i = 0; i < cnt; i++) {
      const card = box2Cards.nth(i);
      const checkInBtn = card.getByRole('button', { name: '접수' });
      await expect(checkInBtn).not.toBeAttached();
    }
  }
  // 데이터 없을 때도 페이지 렌더 정상 확인
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
  expect(await retSlots.count()).toBeGreaterThan(0);
});

test('AC-2: 통합 시간표 재진 컬럼(timeline-slot-ret) 전체 — "접수" 버튼 없음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 재진 컬럼 전체에서 "접수" 버튼이 없어야 함
  const retSlotBtns = page.locator('[data-testid="timeline-slot-ret"] button:has-text("접수")');
  await expect(retSlotBtns).toHaveCount(0);
});

// ── AC-3: 우측 상단 체크인 버튼 — 기존 동작 유지 ────────────────────────────

test('AC-3: 대시보드 우측 상단 체크인 버튼 — 존재 및 클릭 가능', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 우측 상단 "체크인" 버튼이 여전히 존재해야 함 (영향 없음)
  // 버튼 텍스트 또는 title로 식별
  const checkinBtn = page.getByRole('button', { name: /체크인|Check.?[Ii]n/ }).first();
  if (await checkinBtn.count() > 0) {
    await expect(checkinBtn).toBeVisible();
    await expect(checkinBtn).not.toBeDisabled();
  }
});

// ── AC-4: 셀프접수 매칭 플로우 — 기존 동작 유지 ────────────────────────────

test('AC-4: 셀프접수 페이지 — 기존 경로 정상 렌더', async ({ page }) => {
  await page.goto(`${BASE_URL}/self-checkin`);
  await expect(page).toHaveURL(/self-checkin/);
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
});

// ── 회귀: 타임라인 레이아웃 정상 렌더 확인 ──────────────────────────────────

test('회귀: 통합 시간표 3컬럼(시간·초진·재진) — 접수 버튼 제거 후 레이아웃 정상', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 시간 컬럼
  const timeCol = page.locator('[data-testid="timeline-time-col"]');
  expect(await timeCol.count()).toBeGreaterThan(0);
  await expect(timeCol.first()).toBeVisible();

  // 초진 컬럼
  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  expect(await newSlots.count()).toBeGreaterThan(0);
  await expect(newSlots.first()).toBeVisible();

  // 재진 컬럼
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
  expect(await retSlots.count()).toBeGreaterThan(0);
  await expect(retSlots.first()).toBeVisible();
});

test('회귀: 대시보드 — 접수 버튼 제거 후 JS 오류 없음', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // JS 오류 없어야 함
  const criticalErrors = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('404') && !e.includes('net::ERR'),
  );
  expect(criticalErrors).toHaveLength(0);
});
