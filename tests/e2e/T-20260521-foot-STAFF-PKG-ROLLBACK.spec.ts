/**
 * T-20260521-foot-STAFF-PKG-ROLLBACK
 * staff/part_lead packages 접근 차단 롤백 + 3역할(상담실장·코디·치료사) READ 오픈
 *
 * 배경:
 *   T-20260520-foot-STAFF-PKG-ACCESS에서 generic staff/part_lead에 패키지 접근을 허용했으나,
 *   김주연 총괄 지시로 staff/part_lead는 차단, 3역할(consultant/coordinator/therapist)만 READ 오픈.
 *
 * 수정:
 *   - App.tsx packages RoleGuard: staff/part_lead 제거 → ['admin','manager','consultant','coordinator','therapist']
 *   - Packages.tsx canWritePackage: ['admin','manager','consultant','coordinator'] 유지 (therapist=READ-only)
 *
 * AC-1: 상담실장(consultant) → /packages 접근 + 잔여회차 조회 허용
 * AC-2: 코디(coordinator) → /packages 접근 + 잔여회차 조회 허용
 * AC-3: 치료사(therapist) → /packages 접근 허용, 쓰기 버튼 비노출 (READ-only)
 * AC-4: staff(범용) → /packages 접근 차단 (RoleGuard 배열에 미포함)
 * AC-5: admin/manager CRUD 기존 유지 (회귀 없음)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// 소스 코드 정적 검증
// ─────────────────────────────────────────────────────────
test.describe('T-20260521-foot-STAFF-PKG-ROLLBACK — 소스코드 정적 검증', () => {

  test('AC-4: App.tsx packages 라우트 RoleGuard에 staff가 포함되지 않는다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    const packagesLine = content
      .split('\n')
      .find((line) => line.includes('path="packages"') || line.includes("path='packages'"));

    expect(packagesLine).toBeTruthy();
    // staff / part_lead 차단 확인
    expect(packagesLine).not.toContain("'staff'");
    expect(packagesLine).not.toContain("'part_lead'");
  });

  test('AC-1+AC-2: App.tsx packages 라우트 RoleGuard에 consultant/coordinator가 포함된다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    const packagesLine = content
      .split('\n')
      .find((line) => line.includes('path="packages"') || line.includes("path='packages'"));

    expect(packagesLine).toBeTruthy();
    expect(packagesLine).toContain("'consultant'");
    expect(packagesLine).toContain("'coordinator'");
  });

  test('AC-3: App.tsx packages 라우트 RoleGuard에 therapist가 포함된다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    const packagesLine = content
      .split('\n')
      .find((line) => line.includes('path="packages"') || line.includes("path='packages'"));

    expect(packagesLine).toBeTruthy();
    expect(packagesLine).toContain("'therapist'");
  });

  test('AC-5: App.tsx packages 라우트 RoleGuard에 admin/manager가 포함된다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    const packagesLine = content
      .split('\n')
      .find((line) => line.includes('path="packages"') || line.includes("path='packages'"));

    expect(packagesLine).toBeTruthy();
    expect(packagesLine).toContain("'admin'");
    expect(packagesLine).toContain("'manager'");
  });

  test('AC-3: Packages.tsx canWritePackage에 therapist가 포함되지 않는다 (READ-only)', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    const canWriteLine = content
      .split('\n')
      .find((line) => line.includes('canWritePackage') && line.includes('includes'));

    expect(canWriteLine).toBeTruthy();
    // therapist는 canWritePackage에 없어야 함
    expect(canWriteLine).not.toContain("'therapist'");
  });

  test('AC-4: Packages.tsx canWritePackage에 staff/part_lead가 포함되지 않는다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    const canWriteLine = content
      .split('\n')
      .find((line) => line.includes('canWritePackage') && line.includes('includes'));

    expect(canWriteLine).toBeTruthy();
    expect(canWriteLine).not.toContain("'staff'");
    expect(canWriteLine).not.toContain("'part_lead'");
  });

  test('AC-5: Packages.tsx canWritePackage에 admin/manager/consultant/coordinator가 포함된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    const canWriteLine = content
      .split('\n')
      .find((line) => line.includes('canWritePackage') && line.includes('includes'));

    expect(canWriteLine).toBeTruthy();
    expect(canWriteLine).toContain("'admin'");
    expect(canWriteLine).toContain("'manager'");
    expect(canWriteLine).toContain("'consultant'");
    expect(canWriteLine).toContain("'coordinator'");
  });

  test('AC-3: Packages.tsx 쓰기 버튼(회차소진·환불·양도)이 canWrite 게이트로 제어된다', () => {
    const pkgPath = path.resolve(__dirname, '../../src/pages/Packages.tsx');
    const content = fs.readFileSync(pkgPath, 'utf-8');

    // 회차 소진 버튼이 canWrite 조건 하에 있어야 함
    const lines = content.split('\n');
    const sessionBtnIdx = lines.findIndex((l) => l.includes('회차 소진'));
    expect(sessionBtnIdx).toBeGreaterThan(-1);
    const btnLine = lines[sessionBtnIdx];
    expect(btnLine).toContain('canWrite');
  });
});

// ─────────────────────────────────────────────────────────
// 브라우저 E2E — /admin/packages 실제 렌더 검증
// ─────────────────────────────────────────────────────────
test.describe('T-20260521-foot-STAFF-PKG-ROLLBACK — 브라우저 렌더 검증', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  test('AC-5: /admin/packages 에 직접 접근하면 패키지 페이지가 렌더된다 (admin 회귀 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    expect(currentUrl).toContain('/admin/packages');
  });

  test('AC-5: 패키지 목록 탭(활성/완료/환불/전체)이 렌더된다 (admin 회귀 없음)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const activeTab = page.getByRole('tab', { name: '활성' });
    await expect(activeTab).toBeVisible({ timeout: 8000 });
  });

  test('AC-5: admin 계정에서 패키지 생성 버튼이 보인다 (CRUD 유지)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: '패키지 생성' });
    await expect(createBtn).toBeVisible({ timeout: 8000 });
  });

  test('AC-1+AC-2: 패키지 검색 인풋이 렌더된다 (잔여회차 조회 전제)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/packages`);
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder('이름/전화/패키지명');
    await expect(searchInput).toBeVisible({ timeout: 8000 });
  });
});
