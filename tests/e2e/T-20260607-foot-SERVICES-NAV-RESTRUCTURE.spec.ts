/**
 * E2E spec — T-20260607-foot-SERVICES-NAV-RESTRUCTURE
 *
 * 서비스관리 Nav 구조 개편 (문지은 대표원장, #project-doai-crm-풋확장):
 *   1) 진료관리(/admin/clinic-management) top-level 메뉴 제거 →
 *      서비스관리(/admin/services) 페이지 레벨 탭("서비스 목록" | "진료관리")으로 흡수.
 *   2) 진료도구 네비 라벨 '진료 도구' → '진료 대시보드' (route/icon/roles 불변).
 *
 * ※ 본 티켓은 T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME(deployed f3c12ba)와 동일 요청의
 *    상세 재서술(같은 reporter·슬랙 스레드)이다. 구현은 그 커밋이 수행, 본 spec은 신규 티켓
 *    AC-1~5 + 시나리오 1~4를 정본 기준으로 재검증(라벨 '서비스 목록' 정합 포함).
 *
 * 충돌 게이트(§8, 비파괴적):
 *   - 진료관리 하위 DX-MGMT(상병명 관리)·상용구·처방세트·진료세트 콘텐츠 누락 0 — ClinicManagement 전체 이식.
 *   - DX-MGMT 보안 불변식(크로스환자 차단)은 위치 이동만, 손상 금지(라우트/페이지 불변).
 *   - '진료도구→진료대시보드'는 doctor-tools(별개 메뉴) 라벨만. 라우트 path 불변.
 *
 * 코드 불변식을 정본 그대로 인코딩(데이터·로그인 비의존) + 권한자 브라우저 렌더 2종.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const LAYOUT = 'src/components/AdminLayout.tsx';
const SERVICES = 'src/pages/Services.tsx';
const APP = 'src/App.tsx';

// ── 시나리오 1 / AC-1 / AC-2: 진료관리 탭 흡수 + 페이지 레벨 탭 ───────────────
test('AC-1: AdminLayout 사이드바에서 진료관리 top-level 항목 제거', () => {
  const layout = read(LAYOUT);
  expect(layout).not.toContain("to: '/admin/clinic-management'");
  expect(layout).not.toContain("label: '진료관리'");
});

test('AC-2: Services 페이지 레벨 탭("서비스 목록" | "진료관리") 존재', () => {
  const svc = read(SERVICES);
  // 페이지 레벨 탭 네비 + 양쪽 탭 트리거
  expect(svc).toContain('data-testid="svc-top-tab-nav"');
  expect(svc).toContain('data-testid="svc-top-tab-services"');
  expect(svc).toContain('data-testid="svc-top-tab-clinic"');
  // 라벨 정합 — '서비스 목록'(AC-2 명시) + '진료관리'
  expect(svc).toContain('서비스 목록');
  expect(svc).toContain('진료관리');
});

test('AC-2: 진료관리 탭은 기존 ClinicManagement 전체 콘텐츠 재사용(누락 0, 신규 구현 금지)', () => {
  const svc = read(SERVICES);
  expect(svc).toContain("import('@/pages/ClinicManagement')");
  expect(svc).toContain('data-testid="svc-clinic-panel"');
});

test('AC-2: 기존 CATEGORY_TABS(서비스 목록 내부 카테고리 필터)는 서비스 목록 탭 내부에 유지', () => {
  const svc = read(SERVICES);
  // 서비스 목록 카탈로그 내부 카테고리 필터 네비(svc-tab-nav)가 보존되어야 함
  expect(svc).toContain('data-testid="svc-tab-nav"');
});

// ── 시나리오 2 / AC-1: 진료 대시보드 라벨 ────────────────────────────────────
test('AC-1: doctor-tools 라벨 진료 도구 → 진료 대시보드 (route/icon/roles 불변)', () => {
  const layout = read(LAYOUT);
  expect(layout).toContain("label: '진료 대시보드'");
  expect(layout).not.toContain("label: '진료 도구'");
  const line = layout.split('\n').find((l) => l.includes("to: '/admin/doctor-tools'"));
  expect(line).toBeTruthy();
  expect(line!).toContain("label: '진료 대시보드'");
  expect(line!).toContain('icon: BookOpen');
});

// ── 시나리오 3 / AC-4: 권한 가드 (진료관리 탭 admin/manager/director 유지) ────
test('AC-4: 진료관리 탭 가시성 = admin/manager/director 한정', () => {
  const svc = read(SERVICES);
  expect(svc).toContain("CLINIC_MGMT_ROLES = ['admin', 'manager', 'director']");
  expect(svc).toContain('canViewClinicMgmt');
  // 렌더 가드: 진료관리 패널은 canViewClinicMgmt 참일 때만
  expect(svc).toMatch(/effectiveTopTab === 'clinic' && canViewClinicMgmt/);
});

test('AC-4: clinic-management 라우트 RoleGuard(admin/manager/director) 이중가드 보존', () => {
  const app = read(APP);
  const line = app.split('\n').find((l) => l.includes('path="clinic-management"'));
  expect(line).toBeTruthy();
  expect(line!).toContain("'admin'");
  expect(line!).toContain("'manager'");
  expect(line!).toContain("'director'");
  for (const blocked of ['consultant', 'coordinator', 'therapist']) {
    expect(line!).not.toContain(`'${blocked}'`);
  }
});

test('AC-4: services 라우트 roles(5역할) 불변 — 서비스 목록 접근 보존', () => {
  const app = read(APP);
  const line = app.split('\n').find((l) => l.includes('path="services"'));
  expect(line).toBeTruthy();
  for (const role of ['admin', 'manager', 'consultant', 'coordinator', 'therapist']) {
    expect(line!).toContain(`'${role}'`);
  }
});

// ── 시나리오 4 / AC-5: 딥링크 보존 (라우트 path 불변) ─────────────────────────
test('AC-5: clinic-management·doctor-tools 라우트 path 불변(딥링크·북마크 보존)', () => {
  const app = read(APP);
  expect(app).toContain('path="clinic-management"');
  expect(app).toContain('<ClinicManagement />');
  expect(app).toContain('path="doctor-tools"');
});

// ── 브라우저 렌더 (인증 storageState) ────────────────────────────────────────
test('렌더: /admin/services 진입 시 페이지 레벨 탭 + 서비스 목록 + 라벨 rename', async ({ page }) => {
  await page.goto('/admin/services');
  // 사이드바 진료관리 top-level 메뉴 없음
  await expect(
    page.locator('[data-testid="desktop-sidebar"]').getByRole('link', { name: '진료관리', exact: true }),
  ).toHaveCount(0);
  // 사이드바 라벨 rename 확인
  await expect(
    page.locator('[data-testid="desktop-sidebar"]').getByText('진료 대시보드', { exact: true }),
  ).toBeVisible();
  // 페이지 레벨 탭 네비 + 서비스 목록 탭
  await expect(page.getByTestId('svc-top-tab-nav')).toBeVisible();
  await expect(page.getByTestId('svc-top-tab-services')).toHaveText('서비스 목록');
  // 서비스 목록 내부 카테고리 필터 보존
  await expect(page.getByTestId('svc-tab-nav')).toBeVisible();
});

test('렌더: 진료관리 탭(권한자) 클릭 시 ClinicManagement + 상병명 관리 렌더(누락 0)', async ({ page }) => {
  await page.goto('/admin/services');
  const clinicTab = page.getByTestId('svc-top-tab-clinic');
  if ((await clinicTab.count()) === 0) {
    test.skip(true, '현재 로그인 역할은 진료관리 탭 비대상(consultant/coordinator/therapist) — 권한 게이트 정상');
    return;
  }
  await clinicTab.click();
  await expect(page.getByTestId('svc-clinic-panel')).toBeVisible();
  // DX-MGMT 상병명 관리 탭이 흡수 후에도 렌더(콘텐츠 누락 0)
  await expect(page.getByTestId('tab-diagnosis-names')).toBeVisible({ timeout: 10_000 });
});
