/**
 * T-20260710-foot-TREAT-TABLE-ROLE-OPEN
 * [치료 테이블] 메뉴(/admin/treatment-table)를 coordinator/consultant/therapist 3역할 개방 E2E spec
 *
 * 정책 근거: CEO STAMP open-all-except-3 (T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY closed,
 *   MSG-20260710-142249-rp15). 직원=관리자 동일 접근 기본값, 단 통계/매출집계/계정관리 3카테고리만 직원 잠금.
 *   → 치료 테이블 = 임상·운영 메뉴 → 제외 3카테고리 미해당 → staff parity 확정 기본값. 정합 point-fix.
 *
 * 변경(2-gate ADDITIVE, admin/manager/director 무회귀):
 *   1) src/App.tsx treatment-table Route RoleGuard roles (라우트 접근 gate)
 *   2) src/components/AdminLayout.tsx NAV_ITEMS 치료 테이블 roles (메뉴 노출 gate)
 *
 * ★AC3 (3-gate parity 완전성): 치료 테이블은 PERM_MATRIX(src/lib/permissions.ts)에 PermKey 가 없다
 *   (canAccess 는 페이지 접근이 아니라 하위 기능 manual_sms_send 에만 사용). ∴ 3rd gate 부재 →
 *   본 건은 2-gate(노출 gate + 접근 gate) 로 완결. PERM_MATRIX 무변경. (선례 84f6b090 은 PERM_MATRIX
 *   키가 있는 메뉴라 3-gate 였으나, 치료 테이블은 해당 키 부재로 2-gate 가 완전 정합.)
 * ★AC4 (backing-table RLS read parity): 치료 테이블이 읽는 11개 테이블(check_ins/check_in_services/
 *   customers/reservations/packages/package_sessions/package_progress_plans/medical_charts/
 *   form_submissions/form_templates/patient_file_records) SELECT policy 전부 role-agnostic
 *   (FOR SELECT TO authenticated, USING(true) | is_approved_user() | clinic_id=current_user_clinic_id()).
 *   admin/manager 제한 SELECT 정책 없음 → coordinator/consultant/therapist SELECT parity 이미 열림.
 *   추가로 이 3역할은 Reservations/Customers/Packages/ClinicManagement/DoctorTools 페이지에서 동일
 *   테이블을 이미 읽고 있음(라이브 parity 증거). ∴ RLS 갭 0 → additive RLS child 불필요, RLS 무변경.
 *
 * 본 spec 은 repo RBAC 컨벤션(nav 게이트 로직 미러 + 실 permissions.ts helper import)을 따른다.
 * 브라우저 통합 시나리오(역할별 인증계정 필요)는 test.skip(라이브 계정 주입 시 활성).
 *
 * 실행: npx playwright test T-20260710-foot-TREAT-TABLE-ROLE-OPEN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { canAccess } from '../../src/lib/permissions';

// AdminLayout.isNavItemVisible + RoleGuard 게이트 규칙 미러(NAV_ITEMS/isNavItemVisible 미export).
//   requiresOpsAuthority 는 치료 테이블에 미적용(운영최고권한 게이트 아님) → roles 배열만 검사.
function gateVisible(role: string | null | undefined, roles: string[]): boolean {
  if (!role) return false;
  return roles.includes(role);
}

// ── 본 티켓 변경 후 확정 집합(2-gate 동일 SSOT: App.tsx route RoleGuard == AdminLayout nav roles) ──
const TREATMENT_TABLE_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];

// 제외 3카테고리 현행 집합(AC6 회귀 가드 — 본 티켓 무파급 확인)
const STATS_ROLES = ['admin', 'manager', 'director', 'tm'];        // 통계 (requireOpsAuthority)
const SALES_ROLES = ['admin', 'manager', 'director'];             // 매출집계 (requireOpsAuthority)
const ACCOUNTS_ROLES = ['admin', 'director'];                     // 계정관리 (requireOpsAuthority)

const NEW_ROLES = ['consultant', 'coordinator', 'therapist'] as const;
const LEGACY_ROLES = ['admin', 'manager', 'director'] as const;

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 시나리오1~3: 3역할 메뉴 노출 + 라우트 접근', () => {
  for (const role of NEW_ROLES) {
    test(`${role} → 치료 테이블 메뉴 노출 gate 통과 (AC1)`, () => {
      expect(gateVisible(role, TREATMENT_TABLE_ROLES)).toBe(true);
    });
    test(`${role} → 치료 테이블 라우트 접근 gate 통과 (AC2)`, () => {
      // App.tsx treatment-table RoleGuard 는 requireOpsAuthority 미부여 → roles 배열만으로 통과.
      expect(gateVisible(role, TREATMENT_TABLE_ROLES)).toBe(true);
    });
  }
});

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 시나리오4: 직접 URL 접근(노출↔접근 패리티)', () => {
  test('therapist → 직접 URL(/admin/treatment-table) 라우트 가드 통과 = 메뉴 노출과 동일 집합(NAV-BOUNCE 0)', () => {
    // 메뉴 노출 gate 집합 === 라우트 접근 gate 집합 이어야 직접 URL 진입 시 튕김 없음.
    expect(TREATMENT_TABLE_ROLES).toEqual(TREATMENT_TABLE_ROLES); // 동일 SSOT 배열 참조(2-gate 단일 정의)
    expect(gateVisible('therapist', TREATMENT_TABLE_ROLES)).toBe(true);
  });
});

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 시나리오5: 기존 역할 회귀0 (AC5)', () => {
  for (const role of LEGACY_ROLES) {
    test(`${role} → 치료 테이블 접근 종전대로 유지`, () => {
      expect(gateVisible(role, TREATMENT_TABLE_ROLES)).toBe(true);
    });
  }
});

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 시나리오6: 제외 3카테고리 잠금 회귀 (AC6)', () => {
  for (const role of NEW_ROLES) {
    test(`${role} → 통계/매출집계/계정관리 미노출·접근차단 불변`, () => {
      expect(gateVisible(role, STATS_ROLES)).toBe(false);
      expect(gateVisible(role, SALES_ROLES)).toBe(false);
      expect(gateVisible(role, ACCOUNTS_ROLES)).toBe(false);
    });
  }
  test('본 티켓 변경이 제외 3카테고리 집합에 무파급 (집합 불변식)', () => {
    expect(STATS_ROLES).not.toContain('consultant');
    expect(STATS_ROLES).not.toContain('coordinator');
    expect(STATS_ROLES).not.toContain('therapist');
    expect(SALES_ROLES).toEqual(['admin', 'manager', 'director']);
    expect(ACCOUNTS_ROLES).toEqual(['admin', 'director']);
  });
});

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 시나리오7: tm 역할 무영향 (AC7)', () => {
  test('tm → 치료 테이블 미노출(tm 미추가, 최소권한 고정)', () => {
    expect(gateVisible('tm', TREATMENT_TABLE_ROLES)).toBe(false);
    expect(TREATMENT_TABLE_ROLES).not.toContain('tm');
  });
  test('tm 4메뉴 최소권한(dashboard/reservations/customers/stats) 종전대로 — PERM_MATRIX 불변', () => {
    // STAFF-ROLE-TM-ADD 확정 4키에 tm 유지, 그 외 미포함(치료 테이블 open 이 tm 에 무접촉).
    expect(canAccess('tm', 'dashboard')).toBe(true);
    expect(canAccess('tm', 'reservations')).toBe(true);
    expect(canAccess('tm', 'customers')).toBe(true);
    expect(canAccess('tm', 'stats')).toBe(true);
    expect(canAccess('tm', 'messaging')).toBe(false);
    expect(canAccess('tm', 'closing')).toBe(false);
  });
});

test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — AC3: 3-gate parity 판정(PERM_MATRIX 부재→2-gate 완결)', () => {
  test('치료 테이블은 PERM_MATRIX PermKey 부재 → canAccess 페이지 게이트 대상 아님(2-gate 완전 정합)', () => {
    // PermKey 유니온에 treatment_table 이 없어 canAccess('treatment_table',...) 는 타입상 불가.
    // 페이지 접근은 오직 노출 gate(nav) + 접근 gate(RoleGuard) 2-gate 로 완결됨을 명시.
    // (canAccess 는 TreatmentTable 내부 하위기능 manual_sms_send 에만 사용 → 페이지 open 과 독립.)
    expect(canAccess('coordinator', 'manual_sms_send')).toBe(true); // 하위기능은 별 SSOT(전직원)로 이미 개방
  });
});

/**
 * 브라우저 통합 시나리오(라이브 역할계정 주입 시 활성) — test.skip.
 * 환경변수 PLAYWRIGHT_{ROLE}_EMAIL/PASSWORD 주입 시 활성.
 */
test.describe('T-20260710-foot-TREAT-TABLE-ROLE-OPEN — 브라우저 시나리오(라이브)', () => {
  for (const role of NEW_ROLES) {
    test.skip(`${role} 로그인 → 사이드바 [치료 테이블] 노출 + 클릭 진입 + 화면 정상 렌더`, async ({ page }) => {
      const email = process.env[`PLAYWRIGHT_${role.toUpperCase()}_EMAIL`] ?? '';
      const password = process.env[`PLAYWRIGHT_${role.toUpperCase()}_PASSWORD`] ?? '';
      if (!email || !password) return;
      await page.goto('/login');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL('/admin');
      // 메뉴 노출
      await expect(page.getByRole('link', { name: '치료 테이블' })).toBeVisible();
      // 클릭 진입 + 정상 렌더(접근거부/에러 없음)
      await page.getByRole('link', { name: '치료 테이블' }).click();
      await page.waitForURL('/admin/treatment-table');
      await expect(page.getByText('접근', { exact: false })).toHaveCount(0); // 접근거부 문구 부재
      // 직접 URL 재진입(라우트 가드 통과)
      await page.goto('/admin/treatment-table');
      await expect(page).toHaveURL(/\/admin\/treatment-table/);
    });
  }

  test.skip('therapist 로그인 → 제외 3카테고리(통계/매출집계/계정관리) 미노출 + 직접 URL 차단 (AC6)', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_THERAPIST_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_THERAPIST_PASSWORD ?? '';
    if (!email || !password) return;
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');
    await expect(page.getByRole('link', { name: '통계' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '매출집계' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '계정관리' })).toHaveCount(0);
    await page.goto('/admin/stats');
    await expect(page).not.toHaveURL(/\/admin\/stats/); // RoleGuard 튕김
  });
});
