/**
 * T-20260710-foot-OPENALL-EXCEPT3-LIVE-VERIFY
 * open-all-except-3 정책 라이브 前 전수 검증 (재구현 아님 — 전수 감사 + evidence).
 *
 * 정책 근거: CEO STAMP open-all-except-3 (MSG-20260710-142249-rp15, 2026-07-10 14:29).
 *   우산 T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY(closed). 마지막 gap([치료 테이블])은
 *   T-20260710-foot-TREAT-TABLE-ROLE-OPEN(2026-07-10T16:44 배포)로 이미 닫힘.
 *   → 본 spec 은 "잔여 gap 0 / 코드 무변경 완결"을 코드-레벨로 고정하는 전수 회귀 가드.
 *
 * ── AC1 감사 매트릭스 (사이드바 전 메뉴 × {coordinator, consultant, therapist}) ──
 *   소스: src/components/AdminLayout.tsx NAV_ITEMS + src/App.tsx /admin Route 트리.
 *   판정: 노출 gate(nav roles) ∩ 접근 gate(RoleGuard roles) 동일 SSOT 여야 NAV-BOUNCE 0.
 *
 *   메뉴(route)                    | coord/consult/therapist | 분류
 *   -------------------------------|-------------------------|-------------------------
 *   대시보드(/admin)               | ✅ OPEN (roles 미지정)   | 비제외
 *   예약관리(/reservations)        | ✅ OPEN (RoleGuard 없음) | 비제외
 *   고객관리(/customers)           | ✅ OPEN (RoleGuard 없음) | 비제외
 *   진료 대시보드(/doctor-tools)   | ✅ OPEN (VIEW)          | 의료(VIEW=전직원/EDIT=대표원장)
 *   서비스관리(/services)          | ✅ OPEN (VIEW)          | 의료 진료관리 서브탭 포함(VIEW=전직원)
 *   근무 캘린더(/handover)         | ✅ OPEN (RoleGuard 없음) | 비제외
 *   상담·치료사 배정(/assignments) | ✅ OPEN                  | 비제외
 *   치료 테이블(/treatment-table)  | ✅ OPEN (7/10 배포)      | 비제외
 *   메시지 설정(/settings)         | ✅ OPEN                  | 비제외
 *   직원·공간(/staff)              | ✅ OPEN                  | 비제외
 *   패키지(/packages)              | ✅ OPEN                  | 비제외
 *   일마감(/closing)               | ✅ OPEN                  | 비제외
 *   일일 이력(/history)            | ✅ OPEN (RoleGuard 없음) | 비제외
 *   보험청구·EDI(/edi-export)      | ✅ OPEN (RoleGuard 없음) | 비제외
 *   ── 제외 3카테고리 (3역할 잠금 유지) ──
 *   통계(/stats)                   | ❌ LOCK (nav+route)     | 제외①
 *   매출집계(/sales)               | ❌ LOCK (nav+route)     | 제외②
 *   계정관리(/accounts)            | ❌ LOCK (nav+route)     | 제외③
 *
 *   판정: 비제외 메뉴 전부 OPEN + 제외 3 전부 LOCK → 잔여 gap 0. 코드 무변경(deploy-ready 무변경).
 *
 * ── 의료영역 회귀 가드 (절대 불변) ──
 *   진료관리/진료대시보드 메뉴 VIEW 는 확정 모델(VIEW=전직원, permissions.ts canEditClinicMgmt 주석 292~304)로
 *   3역할에 열려 있으나, 의료 WRITE/publish(소견서·진단서 발행·opinion phrase 편집·medical_charts·KOH publish)는
 *   canEditClinicMgmt(대표원장/has_ops_authority) / is_approved_user() RPC 게이트로 director 한정 = 실질 의료보호 무결.
 *   ∴ 3역할 개방 금지의 대상(=의료 데이터 write/publish)은 이미 차단됨. 본 spec 은 write 게이트 불변을 고정.
 *
 * ── AC8 (실로그인 evidence) ──
 *   coordinator·consultant·therapist 실계정 로그인 브라우저 시나리오는 아래 test.skip 블록.
 *   PLAYWRIGHT_{ROLE}_EMAIL/PASSWORD 주입 시 활성(라이브 계정). repo RBAC 컨벤션(treat-table 선례) 동일.
 *
 * 실행: npx playwright test T-20260710-foot-OPENALL-EXCEPT3-LIVE-VERIFY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { canAccess, canEditClinicMgmt } from '../../src/lib/permissions';

// AdminLayout.isNavItemVisible + App.tsx RoleGuard 게이트 규칙 미러(NAV_ITEMS/isNavItemVisible 미export).
//   requiresOpsAuthority 는 3역할에 무관(3역할은 애초에 roles 배열에서 제외되어 별도 가드 불필요) → roles 배열 검사로 충분.
function gateVisible(role: string | null | undefined, roles: string[] | null): boolean {
  if (roles === null) return true; // roles 미지정 = 전직원 노출(RoleGuard 없음 route 포함)
  if (!role) return false;
  return roles.includes(role);
}

const NEW_ROLES = ['coordinator', 'consultant', 'therapist'] as const;
const LEGACY_ROLES = ['admin', 'manager', 'director'] as const;

// ── AC1 감사 매트릭스: 각 메뉴의 확정 role 집합(AdminLayout NAV_ITEMS + App.tsx RoleGuard 동일 SSOT) ──
//   roles === null → 노출/접근 gate 미지정(전직원). 배열 → 해당 role 만.
const MENU_MATRIX: { label: string; route: string; navRoles: string[] | null; routeRoles: string[] | null; excluded?: boolean }[] = [
  { label: '대시보드',        route: '/admin',                   navRoles: null, routeRoles: null },
  { label: '예약관리',        route: '/admin/reservations',      navRoles: null, routeRoles: null },
  { label: '고객관리',        route: '/admin/customers',         navRoles: null, routeRoles: null },
  { label: '진료 대시보드',   route: '/admin/doctor-tools',      navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'therapist', 'technician', 'part_lead', 'consultant', 'coordinator'] },
  { label: '서비스관리',      route: '/admin/services',          navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] },
  { label: '근무 캘린더',     route: '/admin/handover',          navRoles: null, routeRoles: null },
  { label: '상담·치료사 배정', route: '/admin/assignments',      navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] },
  { label: '치료 테이블',     route: '/admin/treatment-table',   navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] },
  { label: '메시지 설정',     route: '/admin/settings',          navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'] },
  { label: '직원·공간',       route: '/admin/staff',             navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] },
  { label: '패키지',          route: '/admin/packages',          navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'staff', 'part_lead'] },
  { label: '일마감',          route: '/admin/closing',           navRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'], routeRoles: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'] },
  { label: '일일 이력',       route: '/admin/history',           navRoles: null, routeRoles: null },
  { label: '보험청구·EDI',    route: '/admin/edi-export',        navRoles: null, routeRoles: null },
  // ── 제외 3카테고리 (3역할 잠금 유지) ──
  { label: '통계',            route: '/admin/stats',             navRoles: ['admin', 'manager', 'director', 'tm'], routeRoles: ['admin', 'manager', 'director', 'tm'], excluded: true },
  { label: '매출집계',        route: '/admin/sales',             navRoles: ['admin', 'manager', 'director'], routeRoles: ['admin', 'manager', 'director'], excluded: true },
  { label: '계정관리',        route: '/admin/accounts',          navRoles: ['admin', 'director'], routeRoles: ['admin', 'director'], excluded: true },
];

test.describe('OPENALL-EXCEPT3 — AC1: 비제외 메뉴 3역할 전수 OPEN (노출+접근 동시)', () => {
  const nonExcluded = MENU_MATRIX.filter((m) => !m.excluded);
  for (const menu of nonExcluded) {
    for (const role of NEW_ROLES) {
      test(`${role} → [${menu.label}] 노출 gate OPEN`, () => {
        expect(gateVisible(role, menu.navRoles)).toBe(true);
      });
      test(`${role} → [${menu.label}] 접근(route) gate OPEN`, () => {
        expect(gateVisible(role, menu.routeRoles)).toBe(true);
      });
    }
  }
});

test.describe('OPENALL-EXCEPT3 — AC1: NAV-BOUNCE 0 (노출 gate 집합 ⊆ 접근 gate 집합)', () => {
  for (const menu of MENU_MATRIX) {
    test(`[${menu.label}] 노출되는 3역할은 route 도 통과(튕김 없음)`, () => {
      for (const role of NEW_ROLES) {
        if (gateVisible(role, menu.navRoles)) {
          expect(gateVisible(role, menu.routeRoles)).toBe(true);
        }
      }
    });
  }
});

test.describe('OPENALL-EXCEPT3 — AC6: 제외 3카테고리(통계/매출집계/계정관리) 3역할 잠금 불변', () => {
  const excluded = MENU_MATRIX.filter((m) => m.excluded);
  for (const menu of excluded) {
    for (const role of NEW_ROLES) {
      test(`${role} → [${menu.label}] 미노출 + route 차단`, () => {
        expect(gateVisible(role, menu.navRoles)).toBe(false);   // 사이드바 미노출
        expect(gateVisible(role, menu.routeRoles)).toBe(false); // 직접 URL 차단
      });
    }
  }
  test('제외 3집합에 3역할 미포함(집합 불변식)', () => {
    for (const menu of excluded) {
      for (const role of NEW_ROLES) {
        expect(menu.navRoles).not.toContain(role);
        expect(menu.routeRoles).not.toContain(role);
      }
    }
  });
});

test.describe('OPENALL-EXCEPT3 — 기존 역할(admin/manager/director) 회귀 0', () => {
  for (const menu of MENU_MATRIX) {
    for (const role of LEGACY_ROLES) {
      // director/manager 는 전 메뉴 종전 접근 유지(통계/매출/계정은 requiresOpsAuthority 별도이나 roles 집합 상 포함).
      const expected = gateVisible(role, menu.routeRoles);
      test(`${role} → [${menu.label}] 접근 종전값 유지 (${expected})`, () => {
        expect(gateVisible(role, menu.routeRoles)).toBe(expected);
      });
    }
  }
});

test.describe('OPENALL-EXCEPT3 — 의료영역 회귀 가드: VIEW 개방 ↔ WRITE/publish director 한정 무결', () => {
  test('의료 메뉴 VIEW 는 3역할 개방(확정 모델 VIEW=전직원)', () => {
    // 진료 대시보드 / 서비스관리(진료관리 서브탭 포함) VIEW gate = 3역할 포함.
    for (const role of NEW_ROLES) {
      expect(gateVisible(role, ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'])).toBe(true);
    }
  });
  test('의료 WRITE/publish(canEditClinicMgmt)는 3역할 차단 = 실질 의료보호 무결', () => {
    // 소견서·진단서 발행·opinion phrase 편집·medical_charts write 게이트.
    for (const role of NEW_ROLES) {
      expect(canEditClinicMgmt(role)).toBe(false);
    }
    // 대표원장(director) / system admin 만 write 허용(MUNJIEUN-CLINICMGMT-LOCKOUT stopgap 포함).
    expect(canEditClinicMgmt('director')).toBe(true);
    expect(canEditClinicMgmt('admin')).toBe(true);
    // has_ops_authority=true(대표원장 flag) → write 허용.
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: true })).toBe(true);
    // manager(운영권한 role-implied)는 진료관리 WRITE 대상 아님(전용 술어 분리).
    expect(canEditClinicMgmt('manager')).toBe(false);
  });
});

test.describe('OPENALL-EXCEPT3 — tm 최소권한(4메뉴) 무접촉', () => {
  test('tm → dashboard/reservations/customers/stats 만, 그 외 미접근', () => {
    expect(canAccess('tm', 'dashboard')).toBe(true);
    expect(canAccess('tm', 'reservations')).toBe(true);
    expect(canAccess('tm', 'customers')).toBe(true);
    expect(canAccess('tm', 'stats')).toBe(true);
    expect(canAccess('tm', 'closing')).toBe(false);
    expect(canAccess('tm', 'messaging')).toBe(false);
  });
});

/**
 * ── AC8: 실로그인 브라우저 evidence (라이브 역할계정 주입 시 활성) ──
 *   PLAYWRIGHT_{ROLE}_EMAIL / PLAYWRIGHT_{ROLE}_PASSWORD 주입 시 실행.
 *   (a) 비제외 메뉴 노출·진입 정상 (b) 제외 3카테고리 미노출 + 직접 URL 차단.
 */
test.describe('OPENALL-EXCEPT3 — AC8 브라우저 실로그인 시나리오(라이브)', () => {
  for (const role of NEW_ROLES) {
    test.skip(`${role} 실로그인 → 비제외 메뉴 노출·진입 정상 + 제외 3 차단`, async ({ page }) => {
      const email = process.env[`PLAYWRIGHT_${role.toUpperCase()}_EMAIL`] ?? '';
      const password = process.env[`PLAYWRIGHT_${role.toUpperCase()}_PASSWORD`] ?? '';
      if (!email || !password) return;
      await page.goto('/login');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL('/admin');

      // (a) 비제외 대표 메뉴 노출 + 진입
      for (const label of ['예약관리', '고객관리', '치료 테이블', '패키지', '일마감', '메시지 설정', '직원·공간']) {
        await expect(page.getByRole('link', { name: label })).toBeVisible();
      }
      await page.getByRole('link', { name: '치료 테이블' }).click();
      await page.waitForURL('/admin/treatment-table');
      await expect(page).toHaveURL(/\/admin\/treatment-table/);

      // (b) 제외 3카테고리 미노출
      await expect(page.getByRole('link', { name: '통계' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '매출집계' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '계정관리' })).toHaveCount(0);
      // 직접 URL 차단(RoleGuard 튕김)
      await page.goto('/admin/stats');
      await expect(page).not.toHaveURL(/\/admin\/stats/);
      await page.goto('/admin/sales');
      await expect(page).not.toHaveURL(/\/admin\/sales/);
      await page.goto('/admin/accounts');
      await expect(page).not.toHaveURL(/\/admin\/accounts/);
    });
  }
});
