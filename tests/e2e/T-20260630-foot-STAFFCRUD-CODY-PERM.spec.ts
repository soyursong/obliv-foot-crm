// T-20260630-foot-STAFFCRUD-CODY-PERM — 근무자(staff 로스터) 추가/삭제 coordinator ADDITIVE 허용
//   시나리오 4종: ① 코디 추가  ② 코디 삭제(비활성)  ③ admin 회귀  ④ 권한상승 차단(원장 배정 불가)
//   게이트 SSOT = permissions.ts canManageStaff / assignableStaffRolesFor (FE union),
//   동반 RLS = 20260630220000_staff_coordinator_crud_rls_additive (DB union, role<>director).

import { test, expect } from '@playwright/test';
import { canManageStaff, assignableStaffRolesFor, STAFF_CRUD_ROLES } from '../../src/lib/permissions';
import { STAFF_ROLE_ORDER } from '../../src/lib/status';

// ── ① 시나리오: 코디네이터 근무자 추가 가능 ──────────────────────────────────
test('S1 coordinator 근무자 추가/삭제 게이트 통과(canManageStaff=true)', () => {
  expect(canManageStaff('coordinator')).toBe(true);
});

// ── ② 시나리오: 코디 삭제(비활성) — 동일 게이트(add/edit/delete 일원화) ──────
test('S2 coordinator 삭제(비활성)도 동일 canManageStaff 게이트', () => {
  // FE: 추가버튼·행 edit/delete 모두 canManageStaff 단일 게이트 → coordinator true 면 삭제 노출.
  expect(canManageStaff('coordinator')).toBe(true);
  // 코디는 일반 staff 역할(원장 제외)은 추가/수정 대상으로 배정 가능.
  const opts = assignableStaffRolesFor('coordinator', STAFF_ROLE_ORDER);
  expect(opts).toContain('therapist');
  expect(opts).toContain('consultant');
  expect(opts).toContain('coordinator');
  expect(opts).toContain('technician');
});

// ── ③ 시나리오: admin/manager/director 무회귀 ─────────────────────────────────
test('S3 admin/manager/director 기존 동선 100% 유지(무회귀)', () => {
  for (const role of ['admin', 'manager', 'director'] as const) {
    expect(canManageStaff(role), `${role} must manage staff`).toBe(true);
    // 상위 3역할은 원장(director) 포함 전 역할 배정 가능(무회귀).
    const opts = assignableStaffRolesFor(role, STAFF_ROLE_ORDER);
    expect(opts).toEqual([...STAFF_ROLE_ORDER]);
    expect(opts).toContain('director');
  }
});

// ── ④ 시나리오: 권한상승 차단 ────────────────────────────────────────────────
test('S4 권한상승 차단: coordinator 는 원장(director) 배정 불가', () => {
  const opts = assignableStaffRolesFor('coordinator', STAFF_ROLE_ORDER);
  expect(opts).not.toContain('director'); // 코디가 원장 로스터 생성/승격 불가(서버 RLS 와 이중)
});

test('S4b 본 요청 외 역할(consultant/therapist/part_lead/staff/tm)에 add/delete 신설 금지', () => {
  for (const role of ['consultant', 'therapist', 'part_lead', 'staff', 'tm'] as const) {
    expect(canManageStaff(role), `${role} must NOT manage staff`).toBe(false);
    expect(assignableStaffRolesFor(role, STAFF_ROLE_ORDER)).toEqual([]);
  }
});

test('S4c STAFF_CRUD_ROLES SSOT = admin/manager/director/coordinator 정확히 4역할', () => {
  expect([...STAFF_CRUD_ROLES].sort()).toEqual(['admin', 'coordinator', 'director', 'manager']);
});

// ── 방어: null/undefined 안전 ─────────────────────────────────────────────────
test('S5 null/undefined role 안전(false / 빈 배열)', () => {
  expect(canManageStaff(null)).toBe(false);
  expect(canManageStaff(undefined)).toBe(false);
  expect(assignableStaffRolesFor(null, STAFF_ROLE_ORDER)).toEqual([]);
});
