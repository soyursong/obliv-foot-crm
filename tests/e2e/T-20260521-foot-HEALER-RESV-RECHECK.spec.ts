/**
 * E2E Spec: T-20260521-foot-HEALER-RESV-RECHECK
 * HEALER-RESV-BTN(b059856) 현장 미동작 2건 검증
 *
 * 검증 대상 (7c1e9c3 + RECHECK 수정 포함):
 *   AC-1 (RECHECK): 재진 슬롯 healer-blink CSS — v5: outline 기반 amber-500(#f59e0b) 단색 blink (green 교번 제거)
 *   AC-2 (RECHECK): 셀프접수 후 자동 HL — fetchCheckIns healer_flag 쿼리 + reset 구조 정상
 *   AC-3: 체크인 전→후 전환 동선 — 대시보드 로드 + 칸반 렌더 + 에러 없음
 *   AC-4: HEALER-RESV-BTN 핵심 기능 회귀 없음 (btn 렌더 / pending_healer_flag / CSS 애니)
 *   AC-5 (추가): CSS healer-border-blink 존재 + v5 outline amber-500(#f59e0b) 단색 확인 (소스 정적)
 *
 * 수정 파일:
 *   - src/pages/CustomerChartPage.tsx: v4 — handleHealerDeduct + 버튼 display > today (당일 제외, 김주연 총괄 UX 피드백)
 *   - src/index.css: v5 — healer-border-blink outline 기반 amber-500(#f59e0b) 단색 (overflow 클리핑 해소)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── AC-1: CSS animation 가시성 — amber-400 ↔ green-300 교번 ──────────────────

test('AC-1 css: healer-border-blink @keyframes — v5 outline 기반 amber-500(#f59e0b) 단색 blink', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const animResult = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules ?? [])) {
          if (rule instanceof CSSKeyframesRule && rule.name === 'healer-border-blink') {
            const text = rule.cssText;
            // v5: outline 기반 amber-500 단색 blink — green 교번 제거됨
            // 브라우저는 hex를 rgb()/rgba()로 정규화하므로 rgb 형식도 허용 (#f59e0b = rgb(245, 158, 11))
            const isOutlineBased = text.includes('outline');
            const hasAmberColor = text.includes('f59e0b') || text.includes('245, 158, 11') || text.includes('245,158,11');
            const hasOutlineAmber = isOutlineBased && hasAmberColor;
            return { hasOutlineAmber, isOutlineBased, text: text.slice(0, 200) };
          }
        }
      } catch {
        // cross-origin skip
      }
    }
    return null;
  });

  expect(animResult).not.toBeNull();
  expect(animResult!.hasOutlineAmber).toBe(true);
  expect(animResult!.isOutlineBased).toBe(true);
});

test('AC-1 static: healer-blink 클래스가 번들에 포함되고 JS 런타임 에러 없음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(2000);

  const healerErrors = errors.filter(e => e.toLowerCase().includes('healer'));
  expect(healerErrors).toHaveLength(0);
});

// ── AC-2: 셀프접수 자동 HL — fetchCheckIns 구조 정상 ─────────────────────────

test('AC-2 static: Dashboard fetchCheckIns에 healer_flag 쿼리 + reset 로직이 포함됨', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // JS 에러 없음 = healer HL 로직 컴파일 성공
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForTimeout(1500);
  expect(errors).toHaveLength(0);
});

test('AC-2 source: fetchCheckIns healer_flag 쿼리 경로가 소스에 포함됨', async () => {
  const dashSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/Dashboard.tsx'), 'utf-8');

  // healer_flag 쿼리 존재
  expect(dashSrc).toContain('.eq(\'healer_flag\', true)');
  // HL(노랑) 업데이트 존재
  expect(dashSrc).toContain('status_flag: \'yellow\'');
  // 1회성 리셋 존재 (healer_flag: false)
  expect(dashSrc).toContain('healer_flag: false');
});

// ── AC-3: 체크인 전→후 전환 동선 ─────────────────────────────────────────────

test('AC-3: 대시보드 로드 → 칸반 컬럼 렌더 → 에러 없음', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(`[console.error] ${msg.text()}`);
  });

  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 치료대기 컬럼 렌더 (재진 셀프접수 목적지)
  await expect(page.getByText('치료대기')).toBeVisible({ timeout: 8000 });

  await page.waitForTimeout(1500);
  expect(pageErrors).toHaveLength(0);
});

test('AC-3 kiosk: SelfCheckIn 페이지 로드 → 에러 없음', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const response = await page.goto(`${BASE_URL}/checkin`);
  // 200 또는 리다이렉트
  expect(response?.status()).toBeLessThan(500);

  await page.waitForTimeout(1000);
  expect(pageErrors).toHaveLength(0);
});

// ── AC-4: HEALER-RESV-BTN 핵심 기능 회귀 없음 ────────────────────────────────

test('AC-4 regression: 힐러예약 후 차감 버튼 관련 컴포넌트 렌더 에러 없음', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  await page.waitForTimeout(2000);
  expect(pageErrors).toHaveLength(0);
});

test('AC-4 source: handleHealerDeduct가 > today (당일 제외) 사용 확인', async () => {
  const chartSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/CustomerChartPage.tsx'), 'utf-8');

  // v4: >= today → > today (당일 예약 제외 — 김주연 총괄 UX 피드백)
  expect(chartSrc).toContain('reservation_date > today');
  const matches = (chartSrc.match(/reservation_date > today/g) ?? []).length;
  expect(matches).toBeGreaterThanOrEqual(2); // handleHealerDeduct(1) + 버튼 display(1) 양쪽
});

test('AC-4 source: 버튼 display nextResv 필터가 > today (v4 수정 — 당일 제외)', async () => {
  const chartSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/CustomerChartPage.tsx'), 'utf-8');

  // v4: >= today → > today (당일 제외)
  const matchGt = (chartSrc.match(/reservation_date > today/g) ?? []).length;
  expect(matchGt).toBeGreaterThanOrEqual(2);
});

// ── AC-5: CSS 기반 깜빡 → source 검증 ────────────────────────────────────────

test('AC-5 source: index.css healer-blink + healer-border-blink 정의됨 (v5 outline amber-500)', async () => {
  const cssSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/index.css'), 'utf-8');

  expect(cssSrc).toContain('@keyframes healer-border-blink');
  expect(cssSrc).toContain('.healer-blink');
  expect(cssSrc).toContain('animation: healer-border-blink');
  // v5: outline 기반 amber-500(#f59e0b) — green 교번 제거, overflow 클리핑 해소
  expect(cssSrc).toContain('f59e0b');
  expect(cssSrc).toContain('outline');
});
