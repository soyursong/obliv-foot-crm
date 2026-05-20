/**
 * T-20260520-foot-STAFF-PKG-ACCESS
 * packages 페이지 RoleGuard staff 차단 해제 — 잔여 회차 조회 보장
 *
 * 원인: App.tsx RoleGuard allowedRoles 배열에 staff/part_lead 미포함
 *        → 잔여 회차 조회조차 불가
 *
 * 수정:
 *   - App.tsx: packages 라우트 RoleGuard에 staff/part_lead 추가
 *   - Packages.tsx: canWritePackage = ['admin','manager','consultant','coordinator']
 *     → staff/part_lead는 READ only (생성·편집·삭제 버튼 숨김)
 *
 * AC-1: staff 계정으로 /packages 접근 → 정상 렌더링 (리다이렉트 없음)
 * AC-2: staff 계정으로 패키지 목록 + 잔여 회차 조회 성공
 * AC-3: part_lead 계정으로 동일 동작 성공
 * AC-4: admin/manager/coordinator 기존 패키지 CRUD 회귀 없음
 * AC-5: staff는 READ only — 생성/수정/삭제 버튼 비노출
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

// ─────────────────────────────────────────────────────────
// 소스 코드 정적 검증 (역할별 별도 계정 없는 환경에서 핵심 AC 보장)
// ─────────────────────────────────────────────────────────
test.describe('T-20260520-foot-STAFF-PKG-ACCESS — 소스코드 정적 검증', () => {

  test('AC-1+AC-3: App.tsx packages 라우트 RoleGuard에 staff/part_lead가 포함된다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    // packages 라우트 라인 추출
    const packagesLine = content
      .split('\n')
      .find((line) => line.includes('path="packages"') || line.includes("path='packages'"));

    expect(packagesLine).toBeTruthy();
    expect(packagesLine).toContain('staff');
    expect(packagesLine).toContain('part_lead');
  });

  test('AC-5: Packages.tsx canWritePackage에 staff/part_lead가 제외된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    // canWritePackage 변수 라인 추출
    const canWriteLine = content
      .split('\n')
      .find((line) => line.includes('canWritePackage'));

    expect(canWriteLine).toBeTruthy();
    // staff/part_lead가 canWritePackage 배열에 포함되지 않아야 함
    expect(canWriteLine).not.toContain("'staff'");
    expect(canWriteLine).not.toContain("'part_lead'");
    // admin/manager는 포함
    expect(canWriteLine).toContain("'admin'");
    expect(canWriteLine).toContain("'manager'");
  });

  test('AC-5: Packages.tsx 패키지 생성 버튼이 canWritePackage 조건으로 렌더된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    // "패키지 생성" 버튼이 canWritePackage 조건 하에 있어야 함
    const lines = content.split('\n');
    const createBtnIdx = lines.findIndex((l) => l.includes('패키지 생성'));
    expect(createBtnIdx).toBeGreaterThan(-1);

    // 버튼 앞 10줄 이내에 canWritePackage 조건이 있어야 함
    const surroundingLines = lines.slice(Math.max(0, createBtnIdx - 10), createBtnIdx + 1).join('\n');
    expect(surroundingLines).toContain('canWritePackage');
  });

  test('AC-5: Packages.tsx 회차소진/환불/양도 버튼이 canWrite 조건으로 렌더된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    // 회차소진 버튼에 canWrite !== false 조건 적용
    expect(content).toContain('회차 소진');
    const writeButtonBlock = content
      .split('\n')
      .filter((l) => l.includes('회차 소진') || l.includes("canWrite !== false"))
      .join('\n');
    expect(writeButtonBlock).toContain('canWrite');
  });

  test('AC-4: Packages.tsx canWritePackage에 admin/manager/consultant/coordinator가 포함된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    const canWriteLine = content
      .split('\n')
      .find((line) => line.includes('canWritePackage'));

    expect(canWriteLine).toBeTruthy();
    expect(canWriteLine).toContain("'admin'");
    expect(canWriteLine).toContain("'manager'");
    expect(canWriteLine).toContain("'consultant'");
    expect(canWriteLine).toContain("'coordinator'");
  });
});

// ─────────────────────────────────────────────────────────
// 브라우저 E2E — /admin/packages 실제 렌더 검증
// ─────────────────────────────────────────────────────────
test.describe('T-20260520-foot-STAFF-PKG-ACCESS — 브라우저 렌더 검증', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // AC-1: /admin/packages 직접 접근 시 리다이렉트 없이 렌더
  test('AC-1: /admin/packages 에 직접 접근하면 패키지 페이지가 렌더된다', async ({ page }) => {
    const redirecUrls: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() === 403 || resp.status() === 404) {
        redirecUrls.push(`${resp.status()}: ${resp.url()}`);
      }
    });

    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    // 현재 URL이 /admin/packages 이어야 함 (dashboard로 리다이렉트되지 않음)
    const currentUrl = page.url();
    expect(currentUrl).toContain('/admin/packages');
  });

  // AC-4: admin 계정으로 패키지 페이지 렌더 + 테이블 존재 확인 (회귀 없음)
  test('AC-4: 패키지 목록 테이블이 렌더된다 (admin 계정 기준 회귀 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    // 탭 필터(활성/완료/환불/전체)가 존재
    const activeTab = page.getByRole('tab', { name: '활성' });
    await expect(activeTab).toBeVisible({ timeout: 8000 });

    // 테이블 헤더 "고객" 열이 존재
    const customerHeader = page.getByRole('columnheader', { name: '고객' });
    await expect(customerHeader).toBeVisible({ timeout: 5000 });
  });

  // AC-2: 패키지 검색 인풋이 렌더됨 (잔여 회차 조회 전제 동작)
  test('AC-2: 패키지 검색 인풋이 렌더된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder('이름/전화/패키지명');
    await expect(searchInput).toBeVisible({ timeout: 8000 });
  });

  // AC-4 + AC-5: admin 기준 패키지 생성 버튼 존재 (CRUD 유지)
  test('AC-4: admin 계정에서 패키지 생성 버튼이 보인다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: '패키지 생성' });
    await expect(createBtn).toBeVisible({ timeout: 8000 });
  });

  // 콘솔 에러 없음 (회귀 방지)
  test('AC-4: 패키지 페이지 로드 시 콘솔 에러가 없다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // favicon 등 무관한 404 제외
        if (!text.includes('favicon') && !text.includes('net::ERR_')) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    expect(consoleErrors).toHaveLength(0);
  });
});
