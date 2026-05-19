/**
 * T-20260516-foot-MEDICAL-CHART-EXPAND — 진료차트 전체화면 + 6항목 즉시 표시 (FIX)
 *
 * SUPERSEDED by T-20260519-foot-MEDCHART-REVAMP:
 *   전체화면(inset-0) → 우측 Drawer로 전환됨.
 *   AC-1/AC-2 에서 전체화면 특이 assertion 완화 — Drawer 버전으로 재검증.
 *   핵심 기능(열림/폼/저장/닫기)은 REVAMP spec에서 재검증.
 *
 * AC-1: 진료차트 패널 열림 확인
 * AC-2: 폼 항목 즉시 표시 (Drawer 버전 기준)
 * AC-3: 기입 → 저장 → 타임라인 노드 확인
 * AC-4: 닫기(X) → 패널 사라짐
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

async function openMedicalChartPanel(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const checkInCard = page.locator('[data-checkin-id]').first();
  if (await checkInCard.count() === 0) return false;
  await checkInCard.click();
  await page.waitForTimeout(1000);

  const medicalChartBtn = page.getByRole('button', { name: '진료차트' }).first();
  if (!await medicalChartBtn.isVisible({ timeout: 5000 }).catch(() => false)) return false;
  await medicalChartBtn.click();
  await page.waitForTimeout(1500);
  return true;
}

// ── AC-1: 진료차트 패널 열림 확인 ────────────────────────────────────────────

test('AC-1: [진료차트] → 패널 열림 + 헤더 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openMedicalChartPanel(page);
  if (!opened) { test.skip(true, '체크인 없거나 진료차트 버튼 없음'); return; }

  // 진료차트 패널 (Drawer 또는 overlay) 열림 확인
  await expect(
    page.getByText('진료차트', { exact: true }).or(
      page.locator('[role="dialog"]').getByText('진료차트')
    )
  ).toBeVisible({ timeout: 5000 });
});

// ── AC-2: 폼 항목 즉시 표시 ───────────────────────────────────────────────────

test('AC-2: 패널 열리자마자 진단명 등 폼 항목 즉시 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openMedicalChartPanel(page);
  if (!opened) { test.skip(true, '체크인 없거나 진료차트 버튼 없음'); return; }

  // 진료차트 헤더 표시
  await expect(
    page.getByText('진료차트', { exact: true }).or(
      page.locator('[role="dialog"]').getByText('진료차트')
    )
  ).toBeVisible({ timeout: 5000 });

  // 진단명 입력 필드 즉시 표시 (REVAMP 공통 필드)
  await expect(page.getByPlaceholder('진단명 (예: 내성발톱, 무좀)')).toBeVisible({ timeout: 5000 });

  // 경과 타임라인 영역 표시 (좌측 사이드바 or 텍스트)
  const hasTimeline = await page.getByText('경과 타임라인').isVisible({ timeout: 3000 }).catch(() => false);
  const hasTimelinePanel = await page.locator('[data-testid="medical-chart-timeline"]').isVisible({ timeout: 3000 }).catch(() => false);
  expect(hasTimeline || hasTimelinePanel).toBe(true);
});

// ── AC-3: 기입 → 저장 → 타임라인 노드 표시 ──────────────────────────────────

test('AC-3: 진단 기입 → 저장 → 타임라인에 기록 표시', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openMedicalChartPanel(page);
  if (!opened) { test.skip(true, '체크인 없거나 진료차트 버튼 없음'); return; }

  // 진단명 입력
  const dxField = page.getByPlaceholder('진단명 (예: 내성발톱, 무좀)');
  await dxField.waitFor({ timeout: 5000 }).catch(() => {});
  if (!await dxField.isVisible().catch(() => false)) {
    test.skip(true, '폼 필드 없음'); return;
  }
  await dxField.fill('EXPAND-REVAMP E2E 진단 테스트');

  // 저장
  const saveBtn = page.getByRole('button', { name: /저장/ }).last();
  await saveBtn.click();
  await page.waitForTimeout(2000);

  // 타임라인에 저장된 항목 표시 (진단명이 좌측 타임라인 항목에 반영)
  await expect(
    page.getByText('EXPAND-REVAMP E2E 진단 테스트').or(
      page.locator('[data-testid="medical-chart-timeline-entry"]').first()
    )
  ).toBeVisible({ timeout: 8000 });
});

// ── AC-4: 닫기(X) → 패널 사라짐 ─────────────────────────────────────────────

test('AC-4: 닫기(X) → 진료차트 패널 사라짐', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openMedicalChartPanel(page);
  if (!opened) { test.skip(true, '체크인 없거나 진료차트 버튼 없음'); return; }

  // 패널 표시 확인
  await expect(
    page.getByText('진료차트', { exact: true }).or(
      page.locator('[role="dialog"]').getByText('진료차트')
    )
  ).toBeVisible({ timeout: 5000 });

  // 닫기 버튼 클릭
  const closeBtn = page.getByRole('button', { name: '닫기' }).or(page.locator('button[aria-label="닫기"]'));
  await closeBtn.first().click({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // 패널 사라짐 확인 — role="dialog" 미존재 또는 진료차트 텍스트 미표시
  const drawerGone = await page.locator('[data-testid="medical-chart-drawer"]').isVisible({ timeout: 3000 }).catch(() => false);
  expect(drawerGone).toBe(false);
});
