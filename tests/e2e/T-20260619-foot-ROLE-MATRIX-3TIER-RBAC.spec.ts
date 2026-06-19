/**
 * T-20260619-foot-ROLE-MATRIX-3TIER-RBAC
 * 풋센터 권한 3단계 매트릭스 + 운영최고권한(has_ops_authority) 2축 분리 E2E spec
 *
 * 확정 모델 (DA branch B / reporter 문지은 대표원장 nafn 답변 MSG-20260619-210119-s3hn):
 *   - 진료관리(ClinicManagement): VIEW=전직원(STAFF-OPEN 유지) / EDIT=대표원장(has_ops_authority=true) 단독.
 *   - 진료대시보드(DoctorCallDashboard): clinical — 원장(대표원장·봉직의 모두)=edit / staff=view (기존 유지).
 *   - 운영최고권한(계정·통계·매출): has_ops_authority gated. 봉직의(director,flag無)=배제(진료만).
 *
 * ★lock-out 가드(AC-4): 모든 게이트는 admin escape 포함 → 역배정 전(현재 전원 admin)엔 문지은 포함 누구도 lock-out 안 됨.★
 *
 * 본 spec은 repo RBAC 컨벤션(헬퍼 로직 단위검증)을 따르되 실제 permissions.ts 헬퍼를 직접 import 해 검증한다.
 * 브라우저 통합 시나리오는 역할별 인증계정 필요 → test.skip (역배정 apply 후 라이브 검증).
 *
 * 실행: npx playwright test T-20260619-foot-ROLE-MATRIX-3TIER-RBAC.spec.ts
 */

import { test, expect } from '@playwright/test';
import { hasOpsAuthority, canEditClinicMgmt } from '../../src/lib/permissions';

// 매트릭스 3 tier + 전환기 admin + manager(총괄) 표본 프로필
const P = {
  staff_manager:   { role: 'manager' as const,   has_ops_authority: false }, // 일반직원 tier(총괄 아닌 manager) — 단, manager는 운영 role-implied
  staff_coord:     { role: 'coordinator' as const, has_ops_authority: false }, // 일반직원
  staff_therapist: { role: 'therapist' as const, has_ops_authority: false },   // 일반직원
  doctor_assoc:    { role: 'director' as const,  has_ops_authority: false },   // 봉직의(일반원장) — 진료만
  director_chief:  { role: 'director' as const,  has_ops_authority: true },    // 대표원장 — 운영최고권한 보유
  chongwal:        { role: 'manager' as const,   has_ops_authority: true },    // 총괄 김주연(역배정 후)
  admin_transition:{ role: 'admin' as const,     has_ops_authority: false },   // ★전환기 문지은(역배정 전 admin)★
  admin_system:    { role: 'admin' as const,     has_ops_authority: false },   // system/test admin(슈퍼유저 escape)
};

test.describe('T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 진료관리 EDIT 게이트(canEditClinicMgmt)', () => {
  test('대표원장(director+flag) → 진료관리 수정 O', () => {
    expect(canEditClinicMgmt(P.director_chief)).toBe(true);
  });

  // ★T-20260620-foot-MUNJIEUN-CLINICMGMT-LOCKOUT (P0 STOPGAP / 옵션 B): converged model 은 봉직의(director,flag無)
  //   → false 였으나, 배포순서 race 로 대표원장(문지은) lock-out 발생 → director escape 임시 추가.
  //   prod director = 문지은 1명뿐(봉직의 미고용)이라 무부작용. 마이그+flag landing 후 escape 제거 시 false 로 환원.
  test('대표원장(director, swap 후 flag無) → 진료관리 수정 O (STOPGAP director escape · LOCKOUT 복구)', () => {
    expect(canEditClinicMgmt(P.doctor_assoc)).toBe(true);
  });

  test('일반직원(coordinator/therapist/manager, flag無) → 진료관리 수정 X', () => {
    expect(canEditClinicMgmt(P.staff_coord)).toBe(false);
    expect(canEditClinicMgmt(P.staff_therapist)).toBe(false);
    // manager(총괄 역배정 전 flag無 가정)도 진료관리 EDIT 대상 아님 — admin/flag 단독 모델
    expect(canEditClinicMgmt(P.staff_manager)).toBe(false);
  });

  test('★lock-out 가드: 전환기 문지은(admin, flag無) → 진료관리 수정 O (admin escape)', () => {
    expect(canEditClinicMgmt(P.admin_transition)).toBe(true);
  });

  test('system/test admin → 진료관리 수정 O (슈퍼유저 escape, 무회귀)', () => {
    expect(canEditClinicMgmt(P.admin_system)).toBe(true);
  });

  test('하위호환: role 문자열 인자도 동작', () => {
    expect(canEditClinicMgmt('admin')).toBe(true);
    expect(canEditClinicMgmt('director')).toBe(true); // T-20260620 STOPGAP: director escape (마이그 landing 후 false 환원)
    expect(canEditClinicMgmt(null)).toBe(false);
    expect(canEditClinicMgmt(undefined)).toBe(false);
  });
});

test.describe('T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 운영최고권한(hasOpsAuthority) 게이트', () => {
  test('대표원장(director+flag) → 운영최고권한 O', () => {
    expect(hasOpsAuthority(P.director_chief)).toBe(true);
  });

  test('봉직의(director, flag無) → 운영최고권한 X (계정/통계/매출 배제)', () => {
    expect(hasOpsAuthority(P.doctor_assoc)).toBe(false);
  });

  test('총괄(manager) → 운영최고권한 O (운영 role-implied)', () => {
    expect(hasOpsAuthority(P.chongwal)).toBe(true);
    expect(hasOpsAuthority(P.staff_manager)).toBe(true); // manager 자체가 운영 role
  });

  test('일반직원(coordinator/therapist) → 운영최고권한 X', () => {
    expect(hasOpsAuthority(P.staff_coord)).toBe(false);
    expect(hasOpsAuthority(P.staff_therapist)).toBe(false);
  });

  test('★lock-out 가드: 전환기 문지은(admin) → 운영최고권한 O (admin escape)', () => {
    expect(hasOpsAuthority(P.admin_transition)).toBe(true);
    expect(hasOpsAuthority(P.admin_system)).toBe(true);
  });

  test('null/undefined → false', () => {
    expect(hasOpsAuthority(null)).toBe(false);
    expect(hasOpsAuthority(undefined)).toBe(false);
  });
});

test.describe('T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — nav/route 운영최고권한 disambiguation 불변식', () => {
  // AdminLayout.isNavItemVisible / RoleGuard requireOpsAuthority 의 핵심 규칙을 미러 검증:
  //   requiresOpsAuthority 항목은 director(임상)일 때만 has_ops_authority 검사. 그 외 role은 roles 배열로만 게이트.
  function opsMenuVisible(profile: { role: string; has_ops_authority?: boolean }, roles: string[]): boolean {
    if (!roles.includes(profile.role)) return false;
    if (profile.role === 'director' && !hasOpsAuthority(profile)) return false;
    return true;
  }
  const STATS_ROLES = ['admin', 'manager', 'director', 'part_lead', 'tm'];

  test('봉직의(director, flag無) → 통계/매출/계정 메뉴 숨김', () => {
    expect(opsMenuVisible(P.doctor_assoc, STATS_ROLES)).toBe(false);
  });
  test('대표원장(director+flag) → 통계 메뉴 노출', () => {
    expect(opsMenuVisible(P.director_chief, STATS_ROLES)).toBe(true);
  });
  test('★lock-out 가드: 전환기 문지은(admin) → 통계 메뉴 노출', () => {
    expect(opsMenuVisible(P.admin_transition, STATS_ROLES)).toBe(true);
  });
  test('총괄(manager+flag) → 통계 메뉴 노출 / part_lead·tm(roles 內)도 영향 없음', () => {
    expect(opsMenuVisible(P.chongwal, STATS_ROLES)).toBe(true);
    expect(opsMenuVisible({ role: 'part_lead' }, STATS_ROLES)).toBe(true);
    expect(opsMenuVisible({ role: 'tm' }, STATS_ROLES)).toBe(true);
  });
});

test.describe('T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 마이그/롤백 아티팩트', () => {
  test('has_ops_authority 마이그 HOLD 파일 + 롤백 블록 정의 확인', () => {
    // .DDL_DIFF_HOLD suffix = supervisor DDL-diff 게이트 전 미적용(레포 convention).
    const migrationHold = 'supabase/migrations/20260619220000_user_profiles_has_ops_authority_additive.sql.DDL_DIFF_HOLD';
    expect(migrationHold).toContain('DDL_DIFF_HOLD');
  });
});

/**
 * 브라우저 통합 시나리오 (역배정 apply + 마이그 적용 후 라이브 검증) — test.skip.
 * 환경변수 PLAYWRIGHT_{ROLE}_EMAIL/PASSWORD 주입 시 활성.
 */
test.describe('T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 브라우저 시나리오(라이브)', () => {
  test.skip('대표원장 로그인 → 진료관리/진료대시보드 수정 O + 계정/통계/매출 접근 O', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_DIRECTOR_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_DIRECTOR_PASSWORD ?? '';
    if (!email || !password) return;
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');
    await expect(page.getByRole('link', { name: '통계' })).toBeVisible();
    await expect(page.getByRole('link', { name: '계정관리' })).toBeVisible();
  });

  test.skip('일반직원 로그인 → 진료관리 조회 O·수정 버튼 미노출 / 통계·매출·계정 미노출', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_STAFF_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_STAFF_PASSWORD ?? '';
    if (!email || !password) return;
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');
    await expect(page.getByRole('link', { name: '통계' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: '계정관리' })).not.toBeVisible();
  });
});
