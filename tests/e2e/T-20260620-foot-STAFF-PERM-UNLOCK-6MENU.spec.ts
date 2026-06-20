/**
 * T-20260620-foot-STAFF-PERM-UNLOCK-6MENU
 * 상담실장(consultant)·코디네이터(coordinator)·치료사(therapist) 3역할에 6개 메뉴 권한 일괄 해제.
 *   ① 패키지 ② 일마감 ③ 메시지 ④ 직원·공간 ⑤ 서비스항목 ⑥ 고객관리(정보/민감/주민번호조회)
 *
 * 요청 (김주연 총괄 U0ATDB587PV, #풋센터 C0ATE5P6JTH) — STAFF-SIDEBAR-RESTRICTION-AUDIT 후속 일괄 해제.
 *   원칙 = RX-PERMMENU-PARITY(commit aa687a8): "권한 풀린 메뉴는 역할분기 없이 동일 노출/동작." escape(admin/manager/director) 유지.
 *
 * ⑥ RRN(주민번호) 조회 scope 정정 이력:
 *   · CORRECTION ndoc(MSG-20260620-113604, 11:36) = "RRN NOTOUCH(admin/manager/director 유지)".
 *   · ★CORRECTION o4u4(MSG-20260620-114645, 11:46) = ndoc supersede★ — 대표(김승현) "다열어줘"(MSG-cac9) → A2 승인.
 *     ∴ RRN_VIEW_ROLES 에 3역할 추가. 시나리오3 RRN 조회 단계 ★복원★(아래).
 *   · 전제조건(AC-4): rrn_decrypt 복호 시 조회 이력(phi_access_log, DA canonical) append 무회귀 — rrn_decrypt A2 마이그에 audit-log 동봉.
 *
 * 검증 레벨 = permissions.ts 술어(role-set SSOT) 직접 검증(PHRASE-STAFF-PERM-BLOCKED.spec 패턴).
 *   역할별 인증계정 라이브 검증(태블릿 코디 계정)은 supervisor QA + 갤탭 field-soak 단계.
 *
 * ★held 브랜치: FE union = RLS union 의무. RLS ADDITIVE 마이그(_6menu_staff_rls_additive.DDL_DIFF_HOLD) +
 *   rrn_decrypt A2(+audit-log .PHI_GATE_HOLD) 가 DA CONSULT + supervisor DDL-diff 후 ★동반 landing★. FE 단독 merge 금지.
 *
 * 실행: npx playwright test T-20260620-foot-STAFF-PERM-UNLOCK-6MENU.spec.ts
 */

import { test, expect } from '@playwright/test';
import { isStaffUnlockRole, STAFF_UNLOCK_ROLES, canViewRrn, RRN_VIEW_ROLES, canEditClinicMgmt } from '../../src/lib/permissions';

// 일괄 해제 대상 3역할(현장 확정 직군) — 코드 실 enum 에 모두 active(consultant·coordinator·therapist).
const UNLOCK_3ROLES = ['consultant', 'coordinator', 'therapist'] as const;
// 회귀 escape(축소/제거 0).
const ESCAPE_ROLES = ['admin', 'manager', 'director'] as const;
// ⑥ 민감정보/고객정보 수정 set(Customers.tsx canEditSensitive — 3역할 모두 포함되어야 함).
const SENSITIVE_EDIT_ROLES = ['admin', 'manager', 'consultant', 'coordinator', 'therapist'];

test.describe('T-20260620-foot-STAFF-PERM-UNLOCK-6MENU — 직원 3역할 6개 메뉴 일괄 해제', () => {
  // ── 시나리오 1: 치료사 — 패키지 전 기능(신규/회차/결제/환불/양도/삭제) ──────────
  test('시나리오1: 치료사 → 패키지 메뉴/버튼(isStaffUnlockRole) 노출·동작 O', () => {
    expect(isStaffUnlockRole('therapist'), '치료사는 패키지 신규/삭제/결제/환불/양도 가능해야 함').toBe(true);
  });

  // ── 시나리오 2: 상담실장 — 일마감 작성/확정/수정/환불 ──────────────────────────
  test('시나리오2: 상담실장 → 일마감(작성/확정/수정/환불) O', () => {
    expect(isStaffUnlockRole('consultant')).toBe(true);
  });

  // ── 시나리오 3: 코디네이터 — 고객관리 민감정보 + 주민번호(RRN) 조회 [RRN 복원] ──
  test('시나리오3: 코디네이터 → 고객 민감정보(여권 등) 수정 O', () => {
    expect(SENSITIVE_EDIT_ROLES).toContain('coordinator');
    expect(SENSITIVE_EDIT_ROLES).toContain('therapist');
  });

  test('시나리오3(RRN 복원, o4u4): 코디네이터/3역할 → 주민번호 조회 게이트 O (canViewRrn)', () => {
    // ndoc(NOTOUCH) → o4u4(대표 승인) supersede. RRN_VIEW_ROLES 에 3역할 추가됨.
    for (const role of UNLOCK_3ROLES) {
      expect(canViewRrn(role), `${role} 은 RRN 조회 가능해야 함(A2 역할한정 복원)`).toBe(true);
    }
    // ※ 실제 값 표시 + phi_access_log 조회이력 append 는 rrn_decrypt A2 마이그 landing 후 DB-레벨 검증(supervisor DDL-diff).
  });

  // ── 시나리오 4: 메시지(연결설정/QR) + 직원·공간 ───────────────────────────────
  test('시나리오4: 치료사 → 메시지(연결설정/셀프체크인 QR) + 직원·공간 노출 O', () => {
    expect(isStaffUnlockRole('therapist')).toBe(true);
  });

  // ── 시나리오 5(회귀): escape 무회귀 + 경계 보존 ───────────────────────────────
  test('시나리오5: admin/manager/director escape 무회귀 (확대만, 제거 0 = lock-out-safe)', () => {
    for (const role of ESCAPE_ROLES) {
      expect(isStaffUnlockRole(role), `${role} escape 유지`).toBe(true);
      expect(canViewRrn(role), `${role} RRN 조회 무회귀`).toBe(true);
    }
  });

  test('시나리오5(회귀): C3 진료관리(의사영역, canEditClinicMgmt) — 일반 직원 편집 X (leak 금지·무변경)', () => {
    // §⑤ 서비스항목 해제가 진료관리(의사영역)로 leak 되면 안 됨. 3역할은 진료관리 수정 불가 유지.
    expect(canEditClinicMgmt({ role: 'consultant', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'coordinator', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'therapist', has_ops_authority: false })).toBe(false);
    // C2 MUNJIEUN director escape 무회귀
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: false })).toBe(true);
    expect(canEditClinicMgmt({ role: 'admin', has_ops_authority: false })).toBe(true);
  });

  // ── role-set 1지점 SSOT + 경계(floor staff/tm 미확대) 가드 ─────────────────────
  test('role-set 1지점: STAFF_UNLOCK_ROLES = 3역할 + escape(6역할). floor staff/tm 미포함', () => {
    expect(STAFF_UNLOCK_ROLES).toEqual(
      expect.arrayContaining(['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist']),
    );
    expect(STAFF_UNLOCK_ROLES).toHaveLength(6);
    // 본 티켓 대상 직군 외(part_lead/staff/tm)는 일괄해제 대상 아님 — 의도된 경계.
    expect(isStaffUnlockRole('tm')).toBe(false);
    expect(isStaffUnlockRole('part_lead')).toBe(false);
    expect(isStaffUnlockRole('staff')).toBe(false);
  });

  test('RRN_VIEW_ROLES = A2(역할한정) 6역할. part_lead/staff/tm 미포함(A1 전직원복원 아님)', () => {
    expect(RRN_VIEW_ROLES).toHaveLength(6);
    expect(canViewRrn('part_lead')).toBe(false);
    expect(canViewRrn('staff')).toBe(false);
    expect(canViewRrn('tm')).toBe(false);
  });

  // null/undefined 방어
  test('빈 role(null/undefined) → 모든 게이트 X (안전 기본값)', () => {
    expect(isStaffUnlockRole(null)).toBe(false);
    expect(isStaffUnlockRole(undefined)).toBe(false);
  });
});
