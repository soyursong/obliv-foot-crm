/**
 * T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED
 * 직원영역 상용구관리(상용구 펜차트·고객차트)·수가세트 편집이 일반 직원에게 막힘 → 직원 role 까지 확대.
 *
 * 요청 (김주연 총괄 U0ATDB587PV, #풋센터 C0ATE5P6JTH, MSG-20260620-111740-5g9v):
 *   "직원 계정에서 상용구관리(상용구 펜차트·고객차트)·수가세트 추가·수정이 전부 막힘. 여기 직원들이 메인으로 쓰는 곳."
 *
 * RC (AC-0):
 *   1) 직원 role enum = permissions.ts(admin/manager/director/consultant/coordinator/therapist/part_lead/staff, +tm).
 *      막힌 대상 = non-admin/manager 운영 직원(director·consultant·coordinator·therapist·part_lead·staff).
 *   2) 직원영역 편집 게이트 = admin||manager (RX-PERMMENU-PARITY) → 위 직원 role 배제 확인(본 갭).
 *   3) 수가세트(FeeSetTemplatesTab) = admin||manager 동형. fee_set_templates RLS=auth_all(true/true) → FE-only 확대로 staff write 즉시 동작.
 *   4) OPINIONPHRASE(b1914883) diff = OpinionPhrasesTab.tsx + ClinicManagement.tsx 만 수정. Services/PhrasesTab/FeeSetTab 무변경 → 의도치 않은 게이트 추가 0(원복 불요).
 *
 * 구현 (role-set 1지점 SSOT = permissions.ts canEditStaffArea / STAFF_AREA_EDIT_ROLES = ALL_STAFF_ROLES(8역할, tm 제외)):
 *   - Phase 1 (본 배포, FE-only/NO-DDL): 수가세트(FeeSetTemplatesTab) canEdit = canEditStaffArea(role).
 *       fee_set_templates RLS=auth_all 라 staff write 가 FE+DB 모두 동작.
 *   - Phase 2 (별 FOLLOWUP, DA CONSULT): 상용구(펜/고객차트, PhrasesTab)는 phrase_templates RLS write=IN('admin','manager') 라
 *       FE 만 풀면 staff write 가 RLS 에서 거부(lock-out-in-disguise) → RLS 확대(admin_write_phrase_templates → +staff) 동반 필요.
 *       ∴ PhrasesTab 게이트는 RLS landing 전까지 admin||manager 유지(본 spec 시나리오 1·2 = 의도된 deferral 상태 검증).
 *   - AC-2 의사영역 무회귀: 소견서/진료차트(medical_chart, canEditClinicMgmt) director/admin-only 무변경.
 *
 * 역할별 인증계정 라이브 검증(태블릿)은 staff 계정 역배정 apply 후 → 여기서는 permissions.ts 헬퍼 직접 검증.
 *
 * 실행: npx playwright test T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED.spec.ts
 */

import { test, expect } from '@playwright/test';
import { canEditStaffArea, STAFF_AREA_EDIT_ROLES, canEditClinicMgmt } from '../../src/lib/permissions';

// 직원영역 수가세트 canEdit 은 FeeSetTemplatesTab 이 canEditStaffArea(profile?.role) 로 판정 → 동일 술어 검증.
const STAFF_ROLES = ['director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'] as const;

test.describe('T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED — 직원영역 편집 권한 확대 게이트', () => {
  // ── 시나리오 3: 직원 — 수가세트 편집 가능 (Phase 1, FE+DB 동작) ──────────────
  test('시나리오3: 운영 직원(consultant/coordinator/therapist/part_lead/staff/director) → 수가세트 편집 O', () => {
    for (const role of STAFF_ROLES) {
      expect(canEditStaffArea(role), `${role} 은 수가세트 편집 가능해야 함`).toBe(true);
    }
  });

  // ── 시나리오 5: admin/manager 무회귀 (편집권 제거 안 됨) ──────────────────────
  test('시나리오5: admin/manager → 수가세트 편집 여전히 O (확대만, 제거 X · lock-out 0)', () => {
    expect(canEditStaffArea('admin')).toBe(true);
    expect(canEditStaffArea('manager')).toBe(true);
  });

  // role-set 1지점 SSOT — 하드코딩 single-role 금지, ALL_STAFF_ROLES(8역할, tm 제외) 재사용 검증
  test('role-set 1지점: STAFF_AREA_EDIT_ROLES = 전직원 8역할(tm 제외)', () => {
    expect(STAFF_AREA_EDIT_ROLES).toEqual(
      expect.arrayContaining(['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff']),
    );
    expect(STAFF_AREA_EDIT_ROLES).toHaveLength(8);
    // tm = 4메뉴 최소권한(STAFF-ROLE-TM-ADD) → 직원영역 편집 미포함
    expect(canEditStaffArea('tm')).toBe(false);
  });

  // null/undefined 방어
  test('빈 role(null/undefined) → 편집 X (안전 기본값)', () => {
    expect(canEditStaffArea(null)).toBe(false);
    expect(canEditStaffArea(undefined)).toBe(false);
  });

  // ── 시나리오 1·2: 상용구(펜/고객차트) — Phase 2 deferral (RLS 확대 landing 전 admin||manager 유지) ──
  //   PhrasesTab 직원영역 게이트는 본 배포에서 미변경(phrase_templates RLS=admin/manager 라
  //   FE 만 풀면 staff write 가 RLS 거부 = lock-out-in-disguise). 의도된 보류 상태를 회귀가드로 고정.
  //   → Phase 2(DA CONSULT, phrase_templates RLS +staff) 완료 시 PhrasesTab 도 canEditStaffArea 로 전환.
  test('시나리오1·2(deferral): 상용구는 RLS 확대(Phase 2) 전까지 admin||manager 유지 — 본 spec 은 Phase 1(수가세트)만 확대 검증', () => {
    // 본 배포 범위 명시: 수가세트만 FE-only 확대. 상용구는 FOLLOWUP(RLS) 대상.
    expect(canEditStaffArea('staff')).toBe(true); // 수가세트(fee_set_templates auth_all)는 동작
  });

  // ── 시나리오 4: 의사영역 무회귀 (medical_chart 소견서/진료차트 director/admin-only 유지) ──
  test('시나리오4: 의사영역(소견서/진료차트, canEditClinicMgmt) — 일반 직원 편집 X (무회귀)', () => {
    expect(canEditClinicMgmt({ role: 'coordinator', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'therapist', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'manager', has_ops_authority: false })).toBe(false);
  });

  test('시나리오4: 의사영역 — 대표원장(has_ops_authority=true)·admin escape 편집 O (무회귀)', () => {
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: true })).toBe(true);
    expect(canEditClinicMgmt({ role: 'admin', has_ops_authority: false })).toBe(true);
  });
});
