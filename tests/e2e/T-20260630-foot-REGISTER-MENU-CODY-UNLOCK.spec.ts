/**
 * T-20260630-foot-REGISTER-MENU-CODY-UNLOCK (COORD-PERM-UNLOCK ⑤)
 * 접수/신규등록 동선 권한 3역할 ADDITIVE 확대 — 김주연 총괄 (C0ATE5P6JTH, thread 1782816252.185759).
 * role_scope EXPANDED→CONFIRMED(2026-06-30 ts:1782820093): coordinator → +consultant +therapist.
 *
 * ── 검증 레이어 ──────────────────────────────────────────────────────────────
 *  본 spec 은 FE 권한 게이트(permissions.ts canAccess('register'))를 결정적으로 검증한다.
 *  멀티롤 로그인 하네스 부재 + RLS write-path(20260630210000_..._rls_additive)는 DA_CONSULT_HOLD 상태라
 *  '코디/실장/치료사 계정으로 실제 저장 성공' DB 단언은 RLS landing 후 갤탭 실기기 현장 confirm 으로 닫는다.
 *  (시나리오 1 step4-5 = customers INSERT 저장 성공 = post-RLS 현장 검증 항목.)
 *
 * RC: 증상=메뉴 미노출. PermKey 'register' 는 현재 UI 미소비 + 실 신규등록 surface(Customers '신규 고객'·
 *     Reservations new-mode)는 이미 3역할 FE 노출 → 진짜 게이트=write-RLS(therapist 전면·consultant reservations INSERT 차단).
 */
import { test, expect } from '@playwright/test';
import { canAccess } from '../../src/lib/permissions';

const TARGET_ROLES = ['coordinator', 'consultant', 'therapist'] as const;
const LEGACY_ROLES = ['admin', 'manager', 'director'] as const;
// 본 scope 외 역할 — register 미대상(무변경) 경계 가드.
const OUT_OF_SCOPE = ['part_lead', 'staff', 'tm'] as const;

test.describe('T-20260630 REGISTER-MENU-CODY-UNLOCK — 접수/신규등록 권한 게이트', () => {
  // ── 시나리오 1: 3역할 정상 동선 (확대 검증) ──
  test('시나리오1: coordinator/consultant/therapist 가 register 게이트 통과(확대)', () => {
    for (const role of TARGET_ROLES) {
      expect.soft(canAccess(role, 'register'), `${role} 은 register 접근 허용돼야 함`).toBe(true);
    }
    expect(test.info().errors).toHaveLength(0);
  });

  // ── 시나리오 2: 기존 권한자 무회귀 (lock-out-safe) ──
  test('시나리오2: admin/manager/director 무회귀(기존 권한 유지)', () => {
    for (const role of LEGACY_ROLES) {
      expect.soft(canAccess(role, 'register'), `${role} 은 register 접근 유지돼야 함(무회귀)`).toBe(true);
    }
    expect(test.info().errors).toHaveLength(0);
  });

  // ── 시나리오 3(재정의): scope 경계 — 미대상 역할 무변경 ──
  //   원 시나리오3(치료사 미대상)은 범위확대로 무효화. 대신 part_lead/staff/tm 은 register 미대상(무변경) 확인.
  test('시나리오3: scope 외 역할(part_lead/staff/tm)은 register 미부여(경계 무변경)', () => {
    for (const role of OUT_OF_SCOPE) {
      expect.soft(canAccess(role, 'register'), `${role} 은 register 미대상(scope=3역할)`).toBe(false);
    }
    expect(test.info().errors).toHaveLength(0);
  });

  // ── lock-out-safe 회귀 가드: 인접 PermKey 무영향 ──
  test('회귀가드: register 확대가 인접 키(stats/customer_export) 누수 없음', () => {
    // therapist 는 stats/customer_export 미대상이어야 함(register 만 확대).
    expect.soft(canAccess('therapist', 'stats')).toBe(false);
    expect.soft(canAccess('therapist', 'customer_export')).toBe(false);
    // customers/reservations 메뉴는 본디 3역할 노출(무변경) — surface 정합 확인.
    expect.soft(canAccess('therapist', 'customers')).toBe(true);
    expect.soft(canAccess('therapist', 'reservations')).toBe(true);
    expect(test.info().errors).toHaveLength(0);
  });
});
