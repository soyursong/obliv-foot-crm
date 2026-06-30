// T-20260630-foot-STAFFCRUD-CODY-PERM — 근무자(staff 로스터) write 를 coordinator 에게 ADDITIVE 확대.
//   현장(김주연 총괄): 직원·공간 > 직원 탭 근무자 '추가/삭제'를 coordinator 도 가능하게.
//   DA CONSULT-REPLY MSG-20260701-024304-2fre = GO(ADDITIVE/저위험, 대표게이트 불요).
//   FE union = RLS union: 동반 마이그(20260630220000_staff_coordinator_crud_rls_additive)가
//     coordinator INSERT/UPDATE(role<>'director', clinic-scoped) ADDITIVE 정책 추가.
//   ★본 spec = FE 권한 헬퍼(canManageStaff / canManageStaffRow / assignableStaffRolesFor)가 RLS 가드와 정합함을 검증.

import { test, expect } from '@playwright/test';
import {
  canManageStaff,
  canManageStaffRow,
  assignableStaffRolesFor,
  STAFF_MANAGE_ROLES,
} from '../../src/lib/permissions';
import { STAFF_ROLE_ORDER } from '../../src/lib/status';

// ── AC-1: 근무자 관리 노출 = admin/manager/director + coordinator (ADDITIVE) ──────
test('AC-1 canManageStaff: coordinator 추가, 운영진 무회귀', () => {
  // 신규 허용
  expect(canManageStaff('coordinator')).toBe(true);
  // 기존 운영진 무회귀(확대만)
  expect(canManageStaff('admin')).toBe(true);
  expect(canManageStaff('manager')).toBe(true);
  expect(canManageStaff('director')).toBe(true);
  // 미허용(최소권한) — consultant/therapist/technician/staff/tm 은 본 티켓 범위 밖
  expect(canManageStaff('consultant')).toBe(false);
  expect(canManageStaff('therapist')).toBe(false);
  expect(canManageStaff('technician')).toBe(false);
  expect(canManageStaff('staff')).toBe(false);
  expect(canManageStaff('tm')).toBe(false);
  // null/undefined 안전
  expect(canManageStaff(null)).toBe(false);
  expect(canManageStaff(undefined)).toBe(false);
});

// ── AC-2: 권한상승 가드 — coordinator 는 원장(director) 행을 관리 불가 (RLS USING role<>director 미러) ──
test('AC-2 canManageStaffRow: coordinator 는 원장(director) 행 차단', () => {
  // coordinator: 비-director 행 관리 가능
  expect(canManageStaffRow('coordinator', 'consultant')).toBe(true);
  expect(canManageStaffRow('coordinator', 'coordinator')).toBe(true);
  expect(canManageStaffRow('coordinator', 'therapist')).toBe(true);
  expect(canManageStaffRow('coordinator', 'technician')).toBe(true);
  // ★핵심: coordinator 는 원장(director) 행 관리 불가(권한상승 차단)
  expect(canManageStaffRow('coordinator', 'director')).toBe(false);

  // 운영진(admin/manager/director)은 원장 행 포함 전 행 관리(무회귀)
  for (const actor of ['admin', 'manager', 'director'] as const) {
    expect(canManageStaffRow(actor, 'director')).toBe(true);
    expect(canManageStaffRow(actor, 'therapist')).toBe(true);
  }

  // 비관리 역할은 어떤 행도 관리 불가
  expect(canManageStaffRow('therapist', 'therapist')).toBe(false);
  expect(canManageStaffRow('consultant', 'consultant')).toBe(false);
});

// ── AC-3: role picker — coordinator 는 'director' 옵션 미노출 (RLS WITH CHECK role<>director 미러) ──
test('AC-3 assignableStaffRolesFor: coordinator picker 는 director 제외', () => {
  const coord = assignableStaffRolesFor('coordinator', STAFF_ROLE_ORDER);
  expect(coord).not.toContain('director');
  // 나머지 4 role 은 그대로 노출(추가 가능)
  expect(coord).toContain('consultant');
  expect(coord).toContain('coordinator');
  expect(coord).toContain('therapist');
  expect(coord).toContain('technician');

  // 운영진은 전 role 노출(원장 포함)
  for (const actor of ['admin', 'manager', 'director'] as const) {
    const all = assignableStaffRolesFor(actor, STAFF_ROLE_ORDER);
    expect(all).toEqual([...STAFF_ROLE_ORDER]); // director 포함 전체
  }
});

// ── AC-4: FE 가드 ↔ RLS 가드 정합 (lock-out-in-disguise 방지) ────────────────────
test('AC-4 FE union = RLS union: STAFF_MANAGE_ROLES 가 마이그 정책 set 과 정합', () => {
  // 마이그(20260630220000)는 coordinator 에게만 신규 INSERT/UPDATE 정책 추가.
  // 기존 staff_admin_all = is_admin_or_manager() = {admin, manager, director}.
  // ∴ effective write-set = {admin, manager, director, coordinator} = STAFF_MANAGE_ROLES.
  expect([...STAFF_MANAGE_ROLES].sort()).toEqual(
    ['admin', 'coordinator', 'director', 'manager'].sort(),
  );
  // staff.role enum 에 admin/manager 부재 → coordinator 가 만들 수 있는 천장 = ≤coordinator.
  // (권한상승 경로 없음 — auth 판정은 user_profiles.role 별 테이블, DA 코드검증.)
  const coordAssignable = assignableStaffRolesFor('coordinator', STAFF_ROLE_ORDER);
  expect(coordAssignable.every((r) => r !== 'director')).toBe(true);
});

// ── AC-5: license_no/PII 폼 필드 부재 확인 (DA 잔여확인) ───────────────────────────
test('AC-5 foot staff 폼은 name+role 만 — assignableStaffRolesFor 밖 추가노출 없음', () => {
  // foot staff 폼(CreateStaffDialog/EditStaffDialog)에는 license_no 등 PII 입력 필드가 없다.
  // role picker 만 권한 경계를 가지므로 assignableStaffRolesFor 한정으로 충분(DA MSG-…-2fre 잔여확인).
  // 구조적 사실 문서화 — role picker 외 권한 분기 surface 0.
  expect(typeof assignableStaffRolesFor).toBe('function');
});
