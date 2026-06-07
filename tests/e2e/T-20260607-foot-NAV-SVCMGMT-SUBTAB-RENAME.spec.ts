/**
 * E2E spec — T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME
 *
 * 문지은 대표원장 네비 정리 2건:
 *   1) 진료관리(/admin/clinic-management) top-level 메뉴 제거 →
 *      서비스관리(/admin/services) 화면 내 서브탭으로 편입.
 *      라우트/페이지·기능은 유지(이동만).
 *   2) 진료도구 네비 라벨 '진료 도구' → '진료 대시보드' rename (route/icon/roles 불변).
 *
 * AC-1 (서브탭 편입): AdminLayout NAV_ITEMS 에서 clinic-management top-level 항목 제거 +
 *                     Services.tsx 가 ClinicManagement 를 서브탭으로 렌더.
 * AC-2 (라벨 rename): doctor-tools 라벨='진료 대시보드' (route/icon/roles 불변).
 * AC-3 (권한 보존): consultant/coordinator/therapist 권한 회귀 금지 —
 *                   진료관리 서브탭 admin/manager/director 한정 + App.tsx RoleGuard 이중가드 보존 +
 *                   services 라우트 roles(5역할) 불변.
 *
 * 구조 불변식을 정본 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀 가드).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const LAYOUT = 'src/components/AdminLayout.tsx';
const SERVICES = 'src/pages/Services.tsx';
const APP = 'src/App.tsx';

// ── AC-1: 진료관리 top-level 메뉴 제거 + 서비스관리 서브탭 편입 ──────────────
test('AC-1: AdminLayout NAV_ITEMS 에서 clinic-management top-level 항목 제거', () => {
  const layout = read(LAYOUT);
  // 사이드바 NAV_ITEMS 에 더 이상 clinic-management 라우트 항목이 없어야 함
  expect(layout).not.toContain("to: '/admin/clinic-management'");
  // 사이드바에 '진료관리' top-level 라벨도 없어야 함 (서브탭으로만 노출)
  expect(layout).not.toContain("label: '진료관리'");
});

test('AC-1: Services.tsx 가 ClinicManagement 를 서브탭으로 편입(이동만)', () => {
  const svc = read(SERVICES);
  // 기존 ClinicManagement 페이지 재사용 (신규 구현 금지)
  expect(svc).toContain("import('@/pages/ClinicManagement')");
  // top-level 서브탭 네비 + 진료관리 탭 트리거 존재
  expect(svc).toContain('data-testid="svc-top-tab-nav"');
  expect(svc).toContain('data-testid="svc-top-tab-services"');
  expect(svc).toContain('data-testid="svc-top-tab-clinic"');
  expect(svc).toContain('서비스 관리');
  expect(svc).toContain('진료관리');
});

test('AC-1: clinic-management 라우트/페이지는 유지(이동만, 제거 금지)', () => {
  const app = read(APP);
  // 라우트 보존 (deep-link "관리 화면으로" 연속성 + RoleGuard 이중가드)
  expect(app).toContain('path="clinic-management"');
  expect(app).toContain('<ClinicManagement />');
});

// ── AC-2: 진료도구 라벨 rename (route/icon/roles 불변) ────────────────────────
test('AC-2: doctor-tools 라벨 진료 도구 → 진료 대시보드 (route/icon/roles 불변)', () => {
  const layout = read(LAYOUT);
  // 신규 라벨 존재
  expect(layout).toContain("label: '진료 대시보드'");
  // 구 라벨 제거
  expect(layout).not.toContain("label: '진료 도구'");
  // route/icon/roles 불변 — doctor-tools 라인이 BookOpen 아이콘 + 5역할 유지
  const line = layout.split('\n').find((l) => l.includes("to: '/admin/doctor-tools'"));
  expect(line).toBeTruthy();
  expect(line!).toContain("label: '진료 대시보드'");
  expect(line!).toContain('icon: BookOpen');
  expect(line!).toContain("roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist']");
});

// ── AC-3: 권한 보존 (consultant/coordinator/therapist 회귀 금지) ──────────────
test('AC-3: 진료관리 서브탭은 admin/manager/director 한정 (서브탭 가시성 게이트)', () => {
  const svc = read(SERVICES);
  // 서브탭 가시성 역할 집합 = admin/manager/director 만
  expect(svc).toContain("CLINIC_MGMT_ROLES = ['admin', 'manager', 'director']");
  // 가시성 + 렌더 이중 가드 (canViewClinicMgmt 로 노출/렌더 모두 제어)
  expect(svc).toContain('canViewClinicMgmt');
  // 렌더 가드: 진료관리 패널은 canViewClinicMgmt 참일 때만
  expect(svc).toMatch(/effectiveTopTab === 'clinic' && canViewClinicMgmt/);
});

test('AC-3: services 라우트 roles 5역할 불변 (consultant/coordinator/therapist 접근 보존)', () => {
  const app = read(APP);
  const line = app.split('\n').find((l) => l.includes('path="services"'));
  expect(line).toBeTruthy();
  for (const role of ['admin', 'manager', 'consultant', 'coordinator', 'therapist']) {
    expect(line!).toContain(`'${role}'`);
  }
});

test('AC-3: clinic-management 라우트 RoleGuard(admin/manager/director) 이중가드 보존', () => {
  const app = read(APP);
  const line = app.split('\n').find((l) => l.includes('path="clinic-management"'));
  expect(line).toBeTruthy();
  // 라우트 가드는 admin/manager/director 유지 — consultant/coordinator/therapist 직접 URL 접근 차단
  expect(line!).toContain("'admin'");
  expect(line!).toContain("'manager'");
  expect(line!).toContain("'director'");
  for (const blocked of ['consultant', 'coordinator', 'therapist']) {
    expect(line!).not.toContain(`'${blocked}'`);
  }
});

// ── 브라우저 렌더 검증 (인증 storageState 사용) ──────────────────────────────
test('렌더: /admin/services 진입 시 top-level 서브탭 네비 + 서비스 목록 렌더', async ({ page }) => {
  await page.goto('/admin/services');
  // 사이드바에 진료관리 top-level 메뉴가 없어야 함 (서브탭으로만)
  await expect(page.locator('[data-testid="desktop-sidebar"]').getByRole('link', { name: '진료관리', exact: true })).toHaveCount(0);
  // 사이드바 라벨 rename 확인
  await expect(page.locator('[data-testid="desktop-sidebar"]').getByText('진료 대시보드', { exact: true })).toBeVisible();
  // top-level 서브탭 네비 + 서비스 관리 탭
  await expect(page.getByTestId('svc-top-tab-nav')).toBeVisible();
  await expect(page.getByTestId('svc-top-tab-services')).toBeVisible();
  // 서비스 목록(카테고리 탭) 렌더
  await expect(page.getByTestId('svc-tab-nav')).toBeVisible();
});

test('렌더: 진료관리 서브탭(권한자) 클릭 시 ClinicManagement 패널 렌더', async ({ page }) => {
  await page.goto('/admin/services');
  const clinicTab = page.getByTestId('svc-top-tab-clinic');
  // 권한 없는 계정이면 서브탭 미노출 — 그 경우 본 검증은 skip (회귀 가드는 AC-3 코드레벨이 담당)
  if ((await clinicTab.count()) === 0) {
    test.skip(true, '현재 로그인 역할은 진료관리 서브탭 비대상(consultant/coordinator/therapist) — 권한 게이트 정상');
    return;
  }
  await clinicTab.click();
  // 진료관리 패널 + ClinicManagement 의 상병명 관리 탭이 렌더되어야 함
  await expect(page.getByTestId('svc-clinic-panel')).toBeVisible();
  await expect(page.getByTestId('tab-diagnosis-names')).toBeVisible({ timeout: 10_000 });
});
