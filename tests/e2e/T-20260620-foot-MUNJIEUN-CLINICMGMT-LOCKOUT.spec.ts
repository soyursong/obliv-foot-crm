/**
 * T-20260620-foot-MUNJIEUN-CLINICMGMT-LOCKOUT
 * [P0 HOTFIX] 문지은 대표원장 진료관리 lock-out (배포순서 race) — 복구 검증
 *
 * 근본 원인:
 *   21:23 MUNJIEUN B2②: 문지은 user_profiles role admin→director (prod 유일 director).
 *   21:30 ROLE-MATRIX Phase1 FE 게이트 배포. canEditClinicMgmt = has_ops_authority || admin (director 미포함).
 *   → swap 으로 admin escape 상실 + has_ops_authority 컬럼 미적재(DDL_DIFF_HOLD)
 *     ⇒ false||false = 진료관리 EDIT 전면 차단(lock-out).
 *
 * 채택 fix: 옵션 B (FE-only / DB-0 / reversible) — canEditClinicMgmt 에 director escape 임시 추가.
 *   prod director = 문지은 1명뿐(봉직의 미고용, nafn Q1)이라 functionally = has_ops_authority 적재와 동일·무부작용.
 *   ★마이그(20260619220000_..._additive.sql) landing + 문지은 has_ops_authority=true set 후 director escape 제거.★
 *
 * AC1: VIEW(route director 포함)는 통과 / lock-out 주영역 = EDIT(canEditClinicMgmt) — 코드 그라운딩 확정.
 * AC2: 문지은(director) → canEditClinicMgmt = true 로 즉시 복구.
 * AC3: admin·manager·일반직원 무회귀.
 *
 * 실행: npx playwright test T-20260620-foot-MUNJIEUN-CLINICMGMT-LOCKOUT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canEditClinicMgmt, hasOpsAuthority } from '../../src/lib/permissions';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

// 표본 프로필
const munjieun_director_swapped = { role: 'director' as const, has_ops_authority: false }; // 21:23 swap 후 prod 상태(flag 미적재)
const munjieun_director_flagged  = { role: 'director' as const, has_ops_authority: true };  // 정석 fix(옵션 A) landing 후
const munjieun_admin_pre_swap    = { role: 'admin' as const, has_ops_authority: false };    // swap 전(과거)
const staff_coord    = { role: 'coordinator' as const, has_ops_authority: false };
const staff_therapist= { role: 'therapist' as const, has_ops_authority: false };
const staff_manager  = { role: 'manager' as const, has_ops_authority: false };
const admin_system   = { role: 'admin' as const, has_ops_authority: false };

test.describe('T-20260620 LOCKOUT — AC2: 문지은(director) 진료관리 EDIT 즉시 복구', () => {
  test('★복구: swap 후 문지은(director, flag無) → canEditClinicMgmt = true (director escape stopgap)', () => {
    expect(canEditClinicMgmt(munjieun_director_swapped)).toBe(true);
  });

  test('정석 fix(옵션 A) landing 후 문지은(director+flag) → 여전히 true (escape 제거해도 무회귀)', () => {
    expect(canEditClinicMgmt(munjieun_director_flagged)).toBe(true);
  });

  test('회귀 재현: swap 전 admin 시절엔 admin escape 로 true 였음(연속성 확인)', () => {
    expect(canEditClinicMgmt(munjieun_admin_pre_swap)).toBe(true);
  });
});

test.describe('T-20260620 LOCKOUT — AC3: 무회귀 가드', () => {
  test('admin(system/슈퍼유저) → EDIT 유지(escape)', () => {
    expect(canEditClinicMgmt(admin_system)).toBe(true);
  });

  test('일반직원(coordinator/therapist) → EDIT 차단 유지(STAFF-OPEN=VIEW만)', () => {
    expect(canEditClinicMgmt(staff_coord)).toBe(false);
    expect(canEditClinicMgmt(staff_therapist)).toBe(false);
  });

  test('manager(flag無) → 진료관리 EDIT 대상 아님(무회귀, admin/director/flag 단독 모델)', () => {
    expect(canEditClinicMgmt(staff_manager)).toBe(false);
  });

  test('운영최고권한(hasOpsAuthority) 게이트는 본 stopgap 영향 없음(director,flag無 → 계정/통계/매출 배제 유지)', () => {
    // stopgap 은 canEditClinicMgmt 에만 director escape 추가 — hasOpsAuthority 는 불변.
    expect(hasOpsAuthority(munjieun_director_swapped)).toBe(false);
    expect(hasOpsAuthority(munjieun_director_flagged)).toBe(true);
  });
});

test.describe('T-20260620 LOCKOUT — AC1: VIEW(route)는 통과 / 코드 그라운딩', () => {
  test('clinic-management Route 가드에 director 포함(VIEW 통과) — App.tsx', () => {
    const appSrc = read('src/App.tsx');
    const routeLine = appSrc.split('\n').find((l) => l.includes('path="clinic-management"')) ?? '';
    expect(routeLine).toContain("'director'");
  });

  test('permissions.ts canEditClinicMgmt 에 STOPGAP director escape 명시(추적 가능)', () => {
    const perms = read('src/lib/permissions.ts');
    expect(perms).toContain('MUNJIEUN-CLINICMGMT-LOCKOUT');
    expect(perms).toMatch(/if\s*\(s\.role\s*===\s*'director'\)\s*return\s*true/);
  });
});
