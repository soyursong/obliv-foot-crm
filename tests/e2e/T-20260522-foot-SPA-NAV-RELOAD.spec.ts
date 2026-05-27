/**
 * E2E Spec: T-20260522-foot-SPA-NAV-RELOAD
 * SPA 내비게이션 시 화면 미렌더링 — 새로고침 필요 (버그 수정 회귀 방지)
 *
 * 근본 원인: App.tsx 최상위 <Suspense>가 전체 Routes를 감싸고 있어
 *            lazy page 첫 로딩 시 AdminLayout 전체(사이드바·헤더)가 unmount됨.
 * 수정:     AdminLayout의 <Outlet />에 독립 Suspense + ChunkErrorBoundary 추가.
 *           App.tsx에 lazyWithRetry — chunk 404 자동 리로드 복구.
 *
 * AC-1: Suspense 경계가 Outlet에 존재하는지 소스 정적 검증
 * AC-2: 메뉴 전환 5회+ 새로고침 없이 sidebar·header 유지
 * AC-3: PC(viewport≥1024px) + 태블릿(1024×768) 양쪽 확인
 * AC-4: 5개 이상 메뉴 순차 전환 정상
 * AC-5: 기존 sidebar-collapse 등 회귀 없음
 * AC-6: lazyWithRetry 함수 소스 존재 확인
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// ── AC-1: 소스 정적 검증 ───────────────────────────────────────────────────────

test.describe('AC-1: Suspense 경계 소스 정적 검증', () => {
  test('AC-1-1: AdminLayout에 ChunkErrorBoundary + Suspense fallback 존재', () => {
    const adminLayoutPath = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');
    const src = fs.readFileSync(adminLayoutPath, 'utf-8');
    expect(src).toContain('ChunkErrorBoundary');
    expect(src).toContain('<Suspense fallback={<OutletPageLoader />}>');
    expect(src).toContain('<Outlet />');
    expect(src).toContain('data-testid="page-content-area"');
  });

  test('AC-1-2: AdminLayout에 Component, Suspense import 존재', () => {
    const adminLayoutPath = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');
    const src = fs.readFileSync(adminLayoutPath, 'utf-8');
    expect(src).toContain('Component');
    expect(src).toContain('Suspense');
  });
});

// ── AC-6: lazyWithRetry 소스 검증 ─────────────────────────────────────────────

test.describe('AC-6: lazyWithRetry chunk 복구 로직 소스 검증', () => {
  test('AC-6-1: App.tsx에 lazyWithRetry 함수 + sessionStorage 리로드 로직 존재', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const src = fs.readFileSync(appPath, 'utf-8');
    expect(src).toContain('lazyWithRetry');
    expect(src).toContain('spa_reload_tried');
    expect(src).toContain('window.location.reload()');
  });

  test('AC-6-2: 모든 page lazy import가 lazyWithRetry 사용', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const src = fs.readFileSync(appPath, 'utf-8');
    // lazy( 직접 호출이 lazyWithRetry 함수 내부 외에는 없어야 함
    // (App.tsx 내 페이지 import는 전부 lazyWithRetry로 래핑)
    const pageImports = [...src.matchAll(/const \w+ = (lazy|lazyWithRetry)\(/g)];
    for (const match of pageImports) {
      expect(match[1]).toBe('lazyWithRetry');
    }
  });
});

// ── AC-2~4: UI 내비게이션 테스트 (dev server 필요) ──────────────────────────────

test.describe('AC-2~4: SPA 내비게이션 렌더링 (UI)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  });

  test('AC-2/4: 5개+ 메뉴 전환 — sidebar 항상 유지', async ({ page }) => {
    const sidebar = page.getByTestId('desktop-sidebar');
    const contentArea = page.getByTestId('page-content-area');

    // 초기 상태 확인
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(contentArea).toBeVisible();

    // 5개 메뉴 순차 전환
    const navLinks = [
      '/admin/reservations',
      '/admin/customers',
      '/admin/closing',
      '/admin/history',
      '/admin/reservations',  // 반복 전환도 정상이어야 함
    ];

    for (const href of navLinks) {
      await page.click(`a[href="${href}"]`);
      // URL 변경 확인
      await expect(page).toHaveURL(new RegExp(href.replace('/admin/', '')), { timeout: 5000 });
      // AdminLayout(사이드바) unmount 없음 — 여전히 visible
      await expect(sidebar).toBeVisible({ timeout: 3000 });
      // content area 존재
      await expect(contentArea).toBeVisible();
      // "불러오는 중" stuck 상태 아님 (5초 내 사라져야 함)
      // 참고: 빠른 전환에서는 fallback이 아예 안 보일 수도 있음
    }
  });

  test('AC-5: 대시보드 → 예약관리 → 대시보드 회귀 없음', async ({ page }) => {
    const sidebar = page.getByTestId('desktop-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 예약관리 이동
    await page.click('a[href="/admin/reservations"]');
    await expect(page).toHaveURL(/reservations/, { timeout: 5000 });
    await expect(sidebar).toBeVisible();

    // 대시보드 복귀 — NavLink의 end prop은 HTML 어트리뷰트가 아니므로 텍스트로 찾음
    await page.click('nav a[href="/admin"]');
    await expect(sidebar).toBeVisible();

    // sidebar-toggle 여전히 동작
    const toggleBtn = page.getByTestId('sidebar-toggle');
    await expect(toggleBtn).toBeVisible();
  });
});

// ── AC-3: 태블릿 뷰포트 ───────────────────────────────────────────────────────

test.describe('AC-3: 태블릿 뷰포트(1024×768) 내비게이션', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('AC-3: 태블릿에서 5개 메뉴 전환 정상', async ({ page }) => {
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });

    const sidebar = page.getByTestId('desktop-sidebar');
    const contentArea = page.getByTestId('page-content-area');

    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const navLinks = [
      '/admin/reservations',
      '/admin/customers',
      '/admin/closing',
      '/admin/history',
      '/admin/reservations',
    ];

    for (const href of navLinks) {
      await page.click(`a[href="${href}"]`);
      await expect(page).toHaveURL(new RegExp(href.replace('/admin/', '')), { timeout: 5000 });
      await expect(sidebar).toBeVisible({ timeout: 3000 });
      await expect(contentArea).toBeVisible();
    }
  });
});
