/**
 * T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN
 * 치료 테이블(치료사 평가 근거 뷰어) 어드민 게이팅
 *
 * 배경: 문지은 대표원장 — "이 뷰어는 어드민 권한만. 아무나 보면 안 됨.
 *        이걸 토대로 치료사 평가·어레인지." (C0ATE5P6JTH)
 *
 * 수정:
 *   - App.tsx: treatment-table 라우트를 <RoleGuard roles={['admin','manager']}>로 감쌈
 *              → 비-어드민 직접 URL 접근 시 /admin 리다이렉트(라우트 가드)
 *   - AdminLayout.tsx: treatment-table NAV_ITEM에 roles:['admin','manager'] 추가
 *              → 비-어드민 메뉴 숨김
 *   - Sales(매출집계)와 동일 게이트(['admin','manager']) — lockout 방지(정당 어드민 비잠금)
 *
 * 의무 시나리오 2종:
 *   AC-1 (비-어드민 차단): RoleGuard에 therapist/consultant/coordinator/director/staff 등
 *                          비-어드민 role이 포함되지 않는다 + 메뉴 항목이 roles 게이팅된다.
 *   AC-2 (어드민 정상접근): admin/manager는 라우트·메뉴 모두 접근 가능 + 실제 렌더된다.
 *
 * db_change=false. risk=GO_WARN(접근통제 보안 민감, 양방향 검증).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// playwright.config.ts 의 baseURL/webServer 포트(8089)와 정렬. (이전 5173 기본값은
// 이 레포 dev 포트와 불일치해 webServer 자동기동 환경에서 ERR_CONNECTION_REFUSED 발생)
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

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
// 시나리오 1 — 비-어드민 차단 (소스코드 정적 검증)
//   역할별 별도 테스트 계정이 없는 환경에서 차단 보장의 진실 원천은
//   RoleGuard / NAV roles 배열이다. 양방향 검증(포함·미포함) 강제.
// ─────────────────────────────────────────────────────────
test.describe('T-20260606 — 시나리오1: 비-어드민 차단', () => {

  test('AC-1: App.tsx treatment-table 라우트가 RoleGuard로 감싸진다', () => {
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    const line = content
      .split('\n')
      .find((l) => l.includes('path="treatment-table"') || l.includes("path='treatment-table'"));

    expect(line).toBeTruthy();
    // RoleGuard 적용 + admin/manager만
    expect(line).toContain('RoleGuard');
    expect(line).toContain("'admin'");
    expect(line).toContain("'manager'");
    // 비-어드민 role은 라우트 가드에 미포함 (직접 URL 차단)
    expect(line).not.toContain("'therapist'");
    expect(line).not.toContain("'consultant'");
    expect(line).not.toContain("'coordinator'");
    expect(line).not.toContain("'director'");
    expect(line).not.toContain("'staff'");
    expect(line).not.toContain("'part_lead'");
    expect(line).not.toContain("'technician'");
    expect(line).not.toContain("'tm'");
  });

  test('AC-1: AdminLayout.tsx treatment-table 메뉴가 roles 게이팅된다', () => {
    const layoutPath = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf-8');

    const line = content
      .split('\n')
      .find((l) => l.includes("to: '/admin/treatment-table'"));

    expect(line).toBeTruthy();
    expect(line).toContain('roles:');
    expect(line).toContain("'admin'");
    expect(line).toContain("'manager'");
    // 메뉴도 비-어드민 미노출
    expect(line).not.toContain("'therapist'");
    expect(line).not.toContain("'consultant'");
    expect(line).not.toContain("'staff'");
  });

  test('AC-1: NAV 필터 로직이 roles 미일치 항목을 제외한다 (회귀 가드)', () => {
    const layoutPath = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf-8');
    // roles 게이팅 필터 패턴이 유지되어야 비-어드민에게서 숨겨진다
    expect(content).toContain('!item.roles || (profile?.role && item.roles.includes(profile.role))');
  });
});

// ─────────────────────────────────────────────────────────
// 시나리오 2 — 어드민 정상접근 (브라우저 E2E)
//   기본 테스트 계정(admin)으로 라우트·메뉴·렌더 모두 정상 동작.
//   lockout 금지: 정당 어드민이 잠기지 않음을 실증.
// ─────────────────────────────────────────────────────────
test.describe('T-20260606 — 시나리오2: 어드민 정상접근', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  test('AC-2: admin 계정이 /admin/treatment-table 직접 접근 시 리다이렉트되지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    // RoleGuard가 admin을 통과시켜 URL이 유지되어야 한다 (/admin 으로 튕기지 않음)
    expect(page.url()).toContain('/admin/treatment-table');
  });

  test('AC-2: 치료 현황 테이블 화면이 렌더된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    // 화면 제목 + 치료사 뷰 탭 존재
    await expect(page.getByText('치료 현황 테이블')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('tab', { name: '치료사 뷰' })).toBeVisible({ timeout: 5000 });
  });

  test('AC-2: admin 사이드바에 "치료 테이블" 메뉴가 노출된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const menuLink = page.getByRole('link', { name: '치료 테이블' }).first();
    await expect(menuLink).toBeVisible({ timeout: 8000 });
  });

  test('AC-2: 치료 테이블 로드 시 콘솔 에러가 없다 (회귀 방지)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('net::ERR_')) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    expect(consoleErrors).toHaveLength(0);
  });
});
