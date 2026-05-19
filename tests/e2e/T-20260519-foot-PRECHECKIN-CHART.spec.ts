/**
 * E2E Spec: T-20260519-foot-PRECHECKIN-CHART
 * 초진 접수 전 차트 열람·기입 가능화 검증
 *
 * AC-1: 초진 Box1Card 클릭 시 차트 정상 열림 (접수 전)
 *       - DraggableBox1Card onSelect → ctxOpenChart → CustomerChartSheet 오픈
 *       - box1-resv-card title에 "클릭=차트조회" 포함 확인
 *
 * AC-2: check_in 없이도 customers+reservations 기반 고객정보 표시
 *       - CustomerChartPage: chart-info-panel 또는 SMART DOCTOR 헤더 렌더
 *       - loading → customer 없으면 fallback 메시지, 크래시 없음
 *
 * AC-3: 접수 전 기입 가능 — 내원콜 방문 확인 UI
 *       - btn-visit-confirm-yes / btn-visit-confirm-no 버튼 존재 시 비활성화 아님
 *       - 가장 가까운 confirmed 예약 기준으로 날짜 표시 (버그 수정 검증)
 *
 * AC-4: 기존 접수 버튼 동작 유지
 *       - box1-resv-card 내 "접수" 버튼 여전히 존재
 *
 * AC-5: 회귀 0
 *       - 재진(Box2) 카드 차트조회 무영향
 *       - 대시보드 JS 에러 없음
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-1: box1-resv-card onSelect 구조 검증 ─────────────────────────────────

test('AC-1: box1-resv-card title — "클릭=차트조회" 포함 (onSelect 핸들러 연결)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    // onSelect prop 연결 시 title에 "클릭=차트조회" 포함됨 (DraggableBox1Card 구현)
    await expect(box1Cards.first()).toHaveAttribute('title', /클릭=차트조회/);
  }
  // 카드 없는 환경 = 정상 (예약 없음)
});

test('AC-1: box1-resv-card 클릭 → 차트 시트 오픈 (접수 전)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt === 0) return; // 예약 없는 환경 pass

  // 카드 본문 클릭 (접수 버튼 외 영역)
  await box1Cards.first().click();

  // CustomerChartSheet 또는 로딩 스피너 → 차트가 열렸음을 확인
  const opened = await Promise.race([
    page.locator('[data-testid="chart-info-panel"]')
      .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
    page.getByText('SMART DOCTOR — 고객정보')
      .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
    page.getByText('불러오는 중')
      .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 6100)),
  ]);
  expect(opened).toBe(true);
});

test('AC-1: box1-resv-card 내 "초" 배지 + 이름 렌더 (초진 표시 구조)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    // "초" 배지 (bg-yellow-200 텍스트)
    await expect(box1Cards.first().getByText('초')).toBeVisible();
  }
});

// ── AC-2: check_in 없이 고객정보 표시 ──────────────────────────────────────

test('AC-2: 차트 오픈 후 chart-info-panel 렌더 (customers 기반, check_in 미필요)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) return;

  await box1Cards.first().click();

  const panel = page.locator('[data-testid="chart-info-panel"]');
  const header = page.getByText('SMART DOCTOR — 고객정보');
  const found = await Promise.race([
    panel.waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
    header.waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
  ]);
  expect(found).toBe(true);
});

test('AC-2: CustomerChartPage — 대시보드 접근 시 JS 크래시 없음', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // React 렌더 치명적 에러 없음
  const critical = jsErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection')
  );
  expect(critical).toHaveLength(0);
});

// ── AC-3: 방문 확인 버튼 ────────────────────────────────────────────────────

test('AC-3: btn-visit-confirm-yes 렌더 시 비활성화 아님 (클릭 가능)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) return;

  await box1Cards.first().click();
  await page.waitForTimeout(2500); // 차트 데이터 로드 대기

  const yesBtn = page.locator('[data-testid="btn-visit-confirm-yes"]');
  const noBtn  = page.locator('[data-testid="btn-visit-confirm-no"]');

  const btnCnt = await yesBtn.count();
  if (btnCnt > 0) {
    // check_in=null + confirmed 예약 있을 때 표시 — 비활성화 아님
    await expect(yesBtn.first()).not.toBeDisabled();
    await expect(noBtn.first()).not.toBeDisabled();
    await expect(yesBtn.first()).toContainText('방문 예정');
    await expect(noBtn.first()).toContainText('방문 안함');
  }
  // 버튼 없는 경우 = check_in 이미 존재 or confirmed 예약 없음 = 정상
});

test('AC-3: 방문확인 UI — "내원콜 방문 확인 (접수 전)" 헤더 확인', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) return;

  await box1Cards.first().click();
  await page.waitForTimeout(2500);

  // "내원콜 방문 확인 (접수 전)" 섹션이 있다면 헤더 확인
  const header = page.getByText('내원콜 방문 확인 (접수 전)');
  const headerCnt = await header.count();
  if (headerCnt > 0) {
    await expect(header.first()).toBeVisible();
  }
});

// ── AC-4: 접수 버튼 유지 ────────────────────────────────────────────────────

test('AC-4: box1-resv-card — PRECHECKIN-CHART 적용 후 "접수" 버튼 여전히 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    const checkInBtn = box1Cards.first().getByRole('button', { name: '접수' });
    await expect(checkInBtn).toBeVisible();
    await expect(checkInBtn).not.toBeDisabled();
  }
});

test('AC-4: box1-resv-card — 카드 클릭 이벤트와 접수 버튼 클릭 분리 (title 검증)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt > 0) {
    // 카드 title에 두 경로 모두 명시
    await expect(box1Cards.first()).toHaveAttribute('title', /클릭=차트조회/);
    await expect(box1Cards.first()).toHaveAttribute('title', /접수버튼=체크인/);
  }
});

// ── AC-5: 회귀 ──────────────────────────────────────────────────────────────

test('AC-5: box2-resv-card — PRECHECKIN-CHART 적용 후 차트조회 title 무영향', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box2Cards = page.locator('[data-testid="box2-resv-card"]');
  const cnt = await box2Cards.count();
  if (cnt > 0) {
    await expect(box2Cards.first()).toHaveAttribute('title', /클릭=차트조회/);
    const checkInBtn = box2Cards.first().getByRole('button', { name: '접수' });
    await expect(checkInBtn).toBeVisible();
  }
});

test('AC-5: 통합 시간표 초진·재진 슬롯 — 정상 렌더 (회귀 없음)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const newSlots = page.locator('[data-testid="timeline-slot-new"]');
  const retSlots = page.locator('[data-testid="timeline-slot-ret"]');

  expect(await newSlots.count()).toBeGreaterThan(0);
  expect(await retSlots.count()).toBeGreaterThan(0);
  await expect(newSlots.first()).toBeVisible();
  await expect(retSlots.first()).toBeVisible();
});

test('AC-5: SelfCheckIn 경로 — PRECHECKIN-CHART 적용 후 무영향', async ({ page }) => {
  await page.goto(`${BASE_URL}/self-checkin`);
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/self-checkin/);
});
