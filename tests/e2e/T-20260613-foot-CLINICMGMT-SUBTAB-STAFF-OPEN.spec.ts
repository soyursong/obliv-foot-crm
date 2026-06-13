/**
 * E2E spec — T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN (김주연 총괄, 풋센터)
 *
 * 진료관리(clinic) top-level 서브탭을 '서비스 목록 진입 role과 동일'(직원 포함)로 개방.
 * 김주연 총괄: "서비스 목록|상용구관리|진료관리 3개 전부 직원도 볼 수 있게, 굳이 권한 막을 필요 없어."
 * → 본 티켓 delta = 진료관리 서브탭 직원 노출(서비스목록·상용구관리는 PHRASEMGMT 소관으로 이미 직원 개방).
 *
 * 정책: umbrella open-all-except-3 정합(진료관리=일반=직원개방이 본래 정책, §13.1.A reporter-authorized).
 * T-20260607 AC-4(admin/manager/director 한정) + PHRASEMGMT AC-3 후단(진료관리 게이팅 유지) SUPERSEDED.
 *
 * AC-1: 진료관리 서브탭 노출 = 서비스 목록 진입 role(직원 포함) — admin/manager/director 한정 게이트 제거.
 * AC-2: 메뉴 가시성만 확대 — 내부 패널 데이터 RLS/WRITE 권한 불변(ClinicManagement 내부 미접촉).
 * AC-3: App.tsx 독립 /admin/clinic-management route RoleGuard 는 본 티켓 밖(불변).
 *
 * 본 spec 은 게이트 완화 불변식을 정본 소스로 인코딩(데이터·로그인 비의존, 빠른 회귀) + 권한자 환경 브라우저 렌더 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SERVICES = 'src/pages/Services.tsx';

// ── 소스 구조 불변식 (정본 소스, 데이터·로그인 비의존) ──────────────────────────────
test.describe('CLINICMGMT-SUBTAB-STAFF-OPEN — 소스 구조 불변식', () => {
  const svc = read(SERVICES);

  test('AC-1: admin/manager/director 한정 role 리스트(CLINIC_MGMT_ROLES) 제거 — 직원 게이팅 해제', () => {
    // 진료관리 서브탭을 좁히던 role 화이트리스트 상수가 제거되어야 함(게이팅 SUPERSEDED).
    expect(svc).not.toContain('CLINIC_MGMT_ROLES');
    // admin/manager/director 한정 튜플이 진료관리 게이트로 남아있지 않아야 함.
    expect(svc).not.toMatch(/\['admin',\s*'manager',\s*'director'\]/);
  });

  test('AC-1: canViewClinicMgmt = 로그인 프로필만으로 충족(직원 포함) — 제한 role 배열 미참조', () => {
    // 진료관리 가시성 게이트가 프로필 존재만으로 truthy(서비스 페이지 도달 = 노출 자격).
    expect(svc).toMatch(/const canViewClinicMgmt\s*=\s*!!profile\?\.role\s*;/);
  });

  test('AC-1: 진료관리 서브탭 버튼·렌더는 그대로 존재(노출만 확대, 탭 제거 아님)', () => {
    expect(svc).toContain('data-testid="svc-top-tab-clinic"');
    expect(svc).toContain('ClinicManagementPanel');
  });

  test('AC-2: 본 티켓 delta 는 Services 진입 게이트만 — 내부 패널 RLS/WRITE 토큰 미도입', () => {
    // 메뉴 가시성만 확대. Services 에 신규 권한/쓰기 분기 토큰을 끌어들이지 않음(내부 미접촉 보증).
    expect(svc).not.toContain('CLINIC_MGMT_WRITE');
    // 진료관리 서브탭 순서 보존: 서비스 목록 → 상용구관리 → 진료관리.
    const iServices = svc.indexOf('data-testid="svc-top-tab-services"');
    const iPhrases = svc.indexOf('data-testid="svc-top-tab-phrases"');
    const iClinic = svc.indexOf('data-testid="svc-top-tab-clinic"');
    expect(iServices).toBeLessThan(iPhrases);
    expect(iPhrases).toBeLessThan(iClinic);
  });
});

// ── 브라우저 렌더 검증 (로그인 환경, 비대상 역할이면 graceful skip) ─────────────────
test.describe('CLINICMGMT-SUBTAB-STAFF-OPEN — 브라우저 렌더', () => {
  test('시나리오1: 서비스관리 진입 → 진료관리 서브탭이 노출(직원 포함)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services');
    // 서비스관리 진입 가능 역할(직원 포함)이면 top-tab 네비 렌더. 비대상이면 graceful skip.
    const navOk = await page.getByTestId('svc-top-tab-nav').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!navOk) { test.skip(true, '서비스관리 비대상 역할 — 라우트 가드 정상'); return; }
    // AC-1: 진료관리 서브탭이 role 게이트 없이 노출.
    const clinicTab = page.getByTestId('svc-top-tab-clinic');
    await expect(clinicTab).toBeVisible();
  });

  test('시나리오2: 진료관리 서브탭 클릭 → 패널 렌더(직원 진입 시 화면 무파손)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/services');
    const navOk = await page.getByTestId('svc-top-tab-nav').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!navOk) { test.skip(true, '서비스관리 비대상 역할 — 라우트 가드 정상'); return; }
    const clinicTab = page.getByTestId('svc-top-tab-clinic');
    await clinicTab.click();
    // 직원 진입 후 일부 패널이 비어 보여도(RLS) 화면이 파손되지 않으면 OK(시나리오3 = umbrella Phase2 소관).
    // 패널 컨테이너가 렌더되고 페이지 크래시(에러 바운더리/blank)가 아님을 확인.
    await page.waitForTimeout(1500);
    const crashed = await page.getByText(/문제가 발생|Something went wrong|Unexpected/i).first().isVisible().catch(() => false);
    expect(crashed).toBe(false);
  });
});
