/**
 * T-20260620-foot-SUPERADMIN-EXEMPT
 * 상시예외 영속화(exempt_from_restrictions) 권한 헬퍼 단위검증 E2E spec
 *
 * 출처: DA CONSULT-REPLY MSG-20260620-162917-aw39 (DA-20260620-FOOT-SUPERADMIN-EXEMPT) — GO(ADDITIVE 컬럼).
 *   컬럼: user_profiles.exempt_from_restrictions boolean NOT NULL DEFAULT false.
 *   reporter: 김주연 총괄(id ee67fc6b-…-70d12) — role 변경·신규 제한 토글에도 생존하는 상시예외.
 *
 * 검증 계약:
 *   1) isExemptFromRestrictions: flag true 만 exempt, undefined/false/null subject 는 비exempt.
 *   2) canAccess 단락: exempt subject → 제한 토글 메뉴(customer_export 등)도 통과(역할이 잃을 메뉴 보존).
 *   3) ★grant 아님: exempt 는 운영 메뉴(PermKey) 한정 — 의사/진료 publish 는 canAccess 비경유라 영향 0(AC-6 자동 안전).
 *   4) ★durability: role 강등(admin→staff)되어도 exempt=true 면 제한 메뉴 보존.
 *   5) 하위호환: role 문자열 인자(과거 호출부)는 exempt 미고려, 기존 PERM_MATRIX 동작 유지.
 *
 * 본 spec은 repo RBAC 컨벤션(헬퍼 로직 단위검증)을 따라 permissions.ts 헬퍼를 직접 import 한다.
 * 라이브 브라우저 시나리오(exempt 적재 후 강등 유저)는 backfill DML landing 후 라이브 검증 → test.skip.
 *
 * 실행: npx playwright test T-20260620-foot-SUPERADMIN-EXEMPT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { canAccess, isExemptFromRestrictions } from '../../src/lib/permissions';

// 표본 프로필 — exempt 축 × role 축
const P = {
  juyeon_admin_exempt: { role: 'admin' as const, exempt_from_restrictions: true },   // 현재 김주연(admin + exempt 적재 후)
  juyeon_downgraded:   { role: 'staff' as const, exempt_from_restrictions: true },   // ★durability: 향후 role 강등 시나리오
  staff_normal:        { role: 'staff' as const, exempt_from_restrictions: false },  // 일반 직원(비exempt)
  coord_no_flag:       { role: 'coordinator' as const },                              // flag 미적재(DB 컬럼 부재기 = undefined)
  admin_normal:        { role: 'admin' as const, exempt_from_restrictions: false },  // 일반 admin(비exempt)
};

test.describe('T-20260620-foot-SUPERADMIN-EXEMPT — isExemptFromRestrictions', () => {
  test('flag true 만 exempt', () => {
    expect(isExemptFromRestrictions(P.juyeon_admin_exempt)).toBe(true);
    expect(isExemptFromRestrictions(P.juyeon_downgraded)).toBe(true);
  });

  test('flag false/undefined/null subject → 비exempt', () => {
    expect(isExemptFromRestrictions(P.staff_normal)).toBe(false);
    expect(isExemptFromRestrictions(P.coord_no_flag)).toBe(false); // 컬럼 미적재기(undefined) = false 취급(inert)
    expect(isExemptFromRestrictions(null)).toBe(false);
    expect(isExemptFromRestrictions(undefined)).toBe(false);
  });
});

test.describe('T-20260620-foot-SUPERADMIN-EXEMPT — canAccess 단락(제한 토글 우회)', () => {
  test('exempt subject → 제한 메뉴(customer_export: admin/manager/director 한정) 통과', () => {
    // customer_export 는 PERM_MATRIX 상 admin/manager/director 한정 = 대표적 '제한 토글' 메뉴
    expect(canAccess(P.juyeon_admin_exempt, 'customer_export')).toBe(true);
  });

  test('★durability: role 강등(admin→staff)되어도 exempt 면 제한 메뉴 보존', () => {
    // staff 는 PERM_MATRIX.customer_export 에 미포함 → 일반 staff 는 false 여야(아래 회귀)
    expect(canAccess(P.staff_normal, 'customer_export')).toBe(false);
    // 그러나 exempt staff(강등된 김주연)는 보존 → true
    expect(canAccess(P.juyeon_downgraded, 'customer_export')).toBe(true);
    expect(canAccess(P.juyeon_downgraded, 'register')).toBe(true);
    expect(canAccess(P.juyeon_downgraded, 'stats')).toBe(true);
  });
});

test.describe('T-20260620-foot-SUPERADMIN-EXEMPT — 무회귀(비exempt 경로 불변)', () => {
  test('비exempt staff → 제한 메뉴 차단 유지(회귀 0)', () => {
    expect(canAccess(P.staff_normal, 'customer_export')).toBe(false);
    expect(canAccess(P.staff_normal, 'register')).toBe(false);
    expect(canAccess(P.staff_normal, 'stats')).toBe(false);
  });

  test('flag 미적재 coordinator → 기존 PERM_MATRIX 그대로(customers O, customer_export X)', () => {
    expect(canAccess(P.coord_no_flag, 'customers')).toBe(true);       // coordinator 는 customers 보유
    expect(canAccess(P.coord_no_flag, 'customer_export')).toBe(false); // 제한 메뉴 미보유
  });

  test('일반 admin(비exempt) → 기존대로 전 메뉴 통과(PERM_MATRIX 멤버십)', () => {
    expect(canAccess(P.admin_normal, 'customer_export')).toBe(true);
    expect(canAccess(P.admin_normal, 'register')).toBe(true);
  });
});

test.describe('T-20260620-foot-SUPERADMIN-EXEMPT — 하위호환(role 문자열 인자)', () => {
  test('role 문자열 인자 → exempt 미고려, 기존 PERM_MATRIX 동작 유지', () => {
    expect(canAccess('admin', 'customer_export')).toBe(true);
    expect(canAccess('staff', 'customer_export')).toBe(false);
    expect(canAccess('coordinator', 'customers')).toBe(true);
    expect(canAccess('', 'customers')).toBe(false);     // 빈 문자열(profile null fallback) → false
  });
});

// ── 라이브 브라우저 시나리오 (backfill DML landing 후) ──────────────────────────
test.describe('T-20260620-foot-SUPERADMIN-EXEMPT — 라이브 통합(적재 후)', () => {
  test.skip('exempt 적재된 강등 유저 세션 → 제한 메뉴 노출 유지', () => {
    // exempt_from_restrictions=true 적재 + role 강등 계정 필요 → DML landing 후 라이브 검증.
  });
});
