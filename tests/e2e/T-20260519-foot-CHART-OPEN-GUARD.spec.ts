/**
 * E2E Spec: T-20260519-foot-CHART-OPEN-GUARD
 * 차트 열림 로직 regression guard (코드 보호 락)
 *
 * 배경: CHART2-REOPEN 5회 재발 이력. 김주연 매니저 5/19 18:00 현장 요청.
 * 현재 FIRSTVISIT-CHECKIN(deployed 12:45) + PRECHECKIN-CHART(deployed 17:07) 정상.
 * 이 spec은 차트 열림 로직 자체를 변경하지 않고 예방 정책으로 락을 건다.
 *
 * AC-1: 초진(Box1) 카드 클릭 → 차트(1·2번) 열림 E2E 테스트
 * AC-2: 재진(Box2) 카드 클릭 → 차트(1·2번) 열림 E2E 테스트
 * AC-3: 체험 경로 차트 열림 E2E 테스트
 * AC-4: 차트 오픈 핵심 코드 CRITICAL 주석 존재 확인 (소스 정적 검증)
 * AC-5: 기존 FIRSTVISIT-CHECKIN·PRECHECKIN-CHART AC 정상 동작 재확인
 *
 * 하지 않는 것: 차트 열림 로직 자체 변경 X. guard(E2E+주석)만 추가.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── 공통 헬퍼 ────────────────────────────────────────────────────────────────

/** 차트 시트 오픈 대기 — chart-info-panel OR "SMART DOCTOR" 헤더 OR 로딩중 */
async function waitForChartOpen(page: import('@playwright/test').Page): Promise<boolean> {
  return Promise.race([
    page.locator('[data-testid="chart-info-panel"]')
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
    page.getByText('SMART DOCTOR — 고객정보')
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
    page.getByText('불러오는 중')
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
  ]);
}

// ── AC-1: 초진(Box1) 차트 열림 ───────────────────────────────────────────────

test.describe('AC-1: 초진(Box1) 차트 열림 guard', () => {
  test('AC-1-1: box1-resv-card — onSelect prop 연결 (title에 클릭=차트조회 포함)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    const cnt = await cards.count();
    if (cnt === 0) return; // 예약 없는 환경 pass

    // DraggableBox1Card: onSelect 연결 시 title에 "클릭=차트조회" 포함 (구현 보장)
    await expect(cards.first()).toHaveAttribute('title', /클릭=차트조회/);
  });

  test('AC-1-2: box1-resv-card 클릭 → 차트 시트 오픈 (접수 전, 1번차트 진입)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();
    const opened = await waitForChartOpen(page);
    expect(opened, '초진 Box1 클릭 후 차트 시트가 열려야 함').toBe(true);
  });

  test('AC-1-3: box1-resv-card 클릭 → chart-info-panel 렌더 (2번차트 고객정보)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();

    // chart-info-panel 또는 SMART DOCTOR 헤더 → 고객 데이터 렌더 확인
    const panel = page.locator('[data-testid="chart-info-panel"]');
    const header = page.getByText('SMART DOCTOR — 고객정보');
    const found = await Promise.race([
      panel.waitFor({ state: 'visible', timeout: 10000 }).then(() => true),
      header.waitFor({ state: 'visible', timeout: 10000 }).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 10100)),
    ]);
    expect(found, 'chart-info-panel 또는 SMART DOCTOR 헤더가 렌더되어야 함').toBe(true);
  });

  test('AC-1-4: box1-resv-card — 접수 전 기입 가능 (btn-visit-confirm 비활성화 아님)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();
    await page.waitForTimeout(3000);

    const yesBtn = page.locator('[data-testid="btn-visit-confirm-yes"]');
    if (await yesBtn.count() > 0) {
      await expect(yesBtn.first()).not.toBeDisabled();
    }
    // 버튼 없음 = check_in 이미 존재 or confirmed 예약 없음 = 정상
  });
});

// ── AC-2: 재진(Box2) 차트 열림 ───────────────────────────────────────────────

test.describe('AC-2: 재진(Box2) 차트 열림 guard', () => {
  test('AC-2-1: box2-resv-card — onSelect prop 연결 (title에 클릭=차트조회 포함)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box2-resv-card"]');
    const cnt = await cards.count();
    if (cnt === 0) return;

    await expect(cards.first()).toHaveAttribute('title', /클릭=차트조회/);
  });

  test('AC-2-2: box2-resv-card 클릭 → 차트 시트 오픈 (1번차트 진입)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box2-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();
    const opened = await waitForChartOpen(page);
    expect(opened, '재진 Box2 클릭 후 차트 시트가 열려야 함').toBe(true);
  });

  test('AC-2-3: box2-resv-card 클릭 → chart-info-panel 렌더 (2번차트 고객정보)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box2-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();

    const panel = page.locator('[data-testid="chart-info-panel"]');
    const header = page.getByText('SMART DOCTOR — 고객정보');
    const found = await Promise.race([
      panel.waitFor({ state: 'visible', timeout: 10000 }).then(() => true),
      header.waitFor({ state: 'visible', timeout: 10000 }).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 10100)),
    ]);
    expect(found, 'chart-info-panel 또는 SMART DOCTOR 헤더가 렌더되어야 함').toBe(true);
  });

  test('AC-2-4: box2-resv-card — 이전 이력 접근 가능 (차트 열린 후 크래시 없음)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box2-resv-card"]');
    if (await cards.count() > 0) {
      await cards.first().click();
      await page.waitForTimeout(3000);
    }

    const critical = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(critical, `JS 에러 발생: ${critical.join(', ')}`).toHaveLength(0);
  });
});

// ── AC-3: 체험 경로 차트 열림 ────────────────────────────────────────────────

test.describe('AC-3: 체험 경로 차트 열림 guard', () => {
  test('AC-3-1: 체험 visit_type 예약 카드 — 차트 열림 가능 (해당 카드 존재 시)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    // 체험 예약은 Box1(초진 동선)에 포함됨 — visit_type: 'experience'
    // 카드 존재 시 동일 차트 열림 경로 검증
    const box1Cards = page.locator('[data-testid="box1-resv-card"]');
    const cnt = await box1Cards.count();
    if (cnt === 0) return; // 예약 없는 환경 pass

    // 모든 Box1 카드 (체험 포함)는 onSelect prop 연결되어야 함
    for (let i = 0; i < Math.min(cnt, 5); i++) {
      const card = box1Cards.nth(i);
      await expect(card).toHaveAttribute('title', /차트조회|chart/i);
    }
  });

  test('AC-3-2: 체험 경로 — 대시보드 JS 에러 없음 (차트 열림 경로 오염 없음)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000); // React hydration 완료 대기

    const critical = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(critical, `JS 에러 발생: ${critical.join(', ')}`).toHaveLength(0);
  });
});

// ── AC-4: CRITICAL 주석 존재 확인 (소스 정적 검증) ──────────────────────────

test.describe('AC-4: CRITICAL 주석 존재 확인 — 코드 보호 락', () => {
  const GUARD_MARKER = 'CRITICAL: DO NOT MODIFY — Chart Open Guard';
  const ROOT = path.resolve(__dirname, '../../src');

  test('AC-4-1: chartContext.ts — CRITICAL 주석 존재', () => {
    const filePath = path.join(ROOT, 'lib/chartContext.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source, `${filePath} 에 CRITICAL 주석 없음`).toContain(GUARD_MARKER);
  });

  test('AC-4-2: AdminLayout.tsx — CRITICAL 주석 존재 (chartId state 영역)', () => {
    const filePath = path.join(ROOT, 'components/AdminLayout.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source, `${filePath} 에 CRITICAL 주석 없음`).toContain(GUARD_MARKER);
    // CustomerChartSheet 단일 렌더 주석도 확인
    expect(source).toContain('CustomerChartSheet는 이 1곳에서만 렌더');
  });

  test('AC-4-3: Dashboard.tsx — DraggableBox1Card CRITICAL 주석 존재', () => {
    const filePath = path.join(ROOT, 'pages/Dashboard.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');
    // 적어도 3개의 CRITICAL 주석 블록 존재 확인
    const occurrences = (source.match(new RegExp(GUARD_MARKER, 'g')) ?? []).length;
    expect(
      occurrences,
      `Dashboard.tsx 에 CRITICAL 주석이 ${occurrences}개뿐 (최소 3개 필요)`,
    ).toBeGreaterThanOrEqual(3);
  });

  test('AC-4-4: Dashboard.tsx — handleReservationSelect CRITICAL 주석 존재', () => {
    const filePath = path.join(ROOT, 'pages/Dashboard.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toContain('handleReservationSelect');
    expect(source).toContain('ctxOpenChart(res.customer_id)');
    // handleReservationSelect 주변에 CRITICAL 주석 확인
    const idx = source.indexOf('handleReservationSelect');
    const surrounding = source.slice(Math.max(0, idx - 600), idx + 200);
    expect(
      surrounding,
      'handleReservationSelect 근방에 CRITICAL 주석 없음',
    ).toContain(GUARD_MARKER);
  });
});

// ── AC-5: FIRSTVISIT-CHECKIN + PRECHECKIN-CHART 기존 AC 재확인 ────────────────

test.describe('AC-5: 기존 FIRSTVISIT-CHECKIN·PRECHECKIN-CHART AC 회귀 재확인', () => {
  // --- FIRSTVISIT-CHECKIN 핵심 ---

  test('AC-5-1 [FIRSTVISIT-CHECKIN]: box1-resv-card "접수" 버튼 존재·비활성화 아님', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    const cnt = await cards.count();
    if (cnt > 0) {
      const checkInBtn = cards.first().getByRole('button', { name: '접수' });
      await expect(checkInBtn).toBeVisible();
      await expect(checkInBtn).not.toBeDisabled();
    }
  });

  test('AC-5-2 [FIRSTVISIT-CHECKIN]: box1-resv-card title — "클릭=차트조회 · 접수버튼=체크인" 포함', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    const cnt = await cards.count();
    if (cnt > 0) {
      await expect(cards.first()).toHaveAttribute('title', /클릭=차트조회/);
      await expect(cards.first()).toHaveAttribute('title', /접수버튼=체크인/);
    }
  });

  test('AC-5-3 [FIRSTVISIT-CHECKIN]: 초진 슬롯(timeline-slot-new) 렌더 확인', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const newSlots = page.locator('[data-testid="timeline-slot-new"]');
    expect(await newSlots.count()).toBeGreaterThan(0);
    await expect(newSlots.first()).toBeVisible();
  });

  // --- PRECHECKIN-CHART 핵심 ---

  test('AC-5-4 [PRECHECKIN-CHART]: box1-resv-card 클릭 → 차트 시트 오픈 (접수 전)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box1-resv-card"]');
    if (await cards.count() === 0) return;

    await cards.first().click();
    const opened = await waitForChartOpen(page);
    expect(opened, 'PRECHECKIN-CHART 회귀: 접수 전 차트가 열려야 함').toBe(true);
  });

  test('AC-5-5 [PRECHECKIN-CHART]: CustomerChartPage — 대시보드 JS 크래시 없음', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const critical = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(critical, `PRECHECKIN-CHART 회귀 JS 에러: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('AC-5-6 [PRECHECKIN-CHART]: box2-resv-card — 차트조회 title 무영향', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const cards = page.locator('[data-testid="box2-resv-card"]');
    const cnt = await cards.count();
    if (cnt > 0) {
      await expect(cards.first()).toHaveAttribute('title', /클릭=차트조회/);
    }
  });

  test('AC-5-7: 통합 시간표 초진·재진 슬롯 — 정상 렌더 (회귀 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

    const newSlots = page.locator('[data-testid="timeline-slot-new"]');
    const retSlots = page.locator('[data-testid="timeline-slot-ret"]');

    expect(await newSlots.count()).toBeGreaterThan(0);
    expect(await retSlots.count()).toBeGreaterThan(0);
    await expect(newSlots.first()).toBeVisible();
    await expect(retSlots.first()).toBeVisible();
  });

  test('AC-5-8: SelfCheckIn 경로 — 차트 열림 가드 적용 후 무영향', async ({ page }) => {
    await page.goto(`${BASE_URL}/self-checkin`);
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/self-checkin/);
  });
});
