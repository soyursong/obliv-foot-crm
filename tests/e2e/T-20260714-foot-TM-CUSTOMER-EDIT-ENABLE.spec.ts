// T-20260714-foot-TM-CUSTOMER-EDIT-ENABLE — 풋 자체 TM(tm) 고객관리 '수정' 활성화(삭제 X)
//   AC-0 게이트 PASS(분기 a): PROD role='tm' 3계정(진운선/이수빈/김효신) 전부 clinic=jongno-foot·
//     @medibuilder.com·provider=email·source_system=null → 전원 풋 자체 TM(도파민 TM콜센터 소속 0).
//   권한 SSOT = src/lib/permissions.ts(canEditCustomer/canDeleteCustomer). 인라인 상수에서 추출(무회귀).
//   ★FE union = RLS union 이미 충족(무DDL): customers UPDATE 'customers_staff_update'(is_floor_staff())의
//     is_floor_staff() 가 PROD 에서 이미 tm 포함 → tm write 旣허용. RLS ADDITIVE 불요.

import { test, expect } from '@playwright/test';
import {
  canEditCustomer,
  canDeleteCustomer,
  CUSTOMER_EDIT_ROLES,
  CUSTOMER_DELETE_ROLES,
} from '../../src/lib/permissions';
import type { UserRole } from '../../src/lib/permissions';

// ── AC-1: 풋 자체 TM 은 고객정보 '수정' 권한 보유(수정버튼 노출·저장 → RLS 차단 없음) ──────────
test('AC-1 tm 은 고객정보 수정(edit) 권한 보유', () => {
  expect(canEditCustomer('tm')).toBe(true);
  // is_floor_staff()(PROD)에 tm 포함 → customers_staff_update UPDATE RLS 통과(저장 성공, 차단 없음).
  // (RLS 자체는 prod pg_policies 실측으로 검증: scripts/out/..._rls_investigate.md)
});

// ── AC-2: 동일 tm 계정은 '삭제' 권한 없음(삭제버튼 미노출) ────────────────────────────────
test('AC-2 tm 은 고객 삭제(delete) 권한 없음', () => {
  expect(canDeleteCustomer('tm')).toBe(false);
  // 삭제 = admin/director 한정(CUSTOMER_DELETE_ROLES). tm 은 FE·RLS(customers_admin_all) 이중 차단.
  expect(CUSTOMER_DELETE_ROLES).not.toContain('tm');
});

// ── AC-3: 기존 역할 권한 회귀 0 (admin/manager/director/coordinator 등 무변경) ──────────────
test('AC-3 기존 역할 수정 권한 회귀 0', () => {
  // 수정 권한 보유 역할(추출 전 인라인 로직 = isStaffUnlockRole ∪ {staff,part_lead})은 그대로 true.
  const EDIT_TRUE: UserRole[] = [
    'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'staff', 'part_lead',
  ];
  for (const role of EDIT_TRUE) {
    expect(canEditCustomer(role), `${role} 은 수정 권한 유지(회귀 금지)`).toBe(true);
  }
  // tm ADDITIVE 로 추가된 것 외 EDIT_ROLES 구성 불변(추가는 tm 하나뿐).
  expect([...CUSTOMER_EDIT_ROLES].sort()).toEqual([...EDIT_TRUE, 'tm'].sort());
});

test('AC-3 삭제 권한 회귀 0 (admin/director 만, 나머지 전부 false)', () => {
  expect(canDeleteCustomer('admin')).toBe(true);
  expect(canDeleteCustomer('director')).toBe(true);
  for (const role of ['manager', 'coordinator', 'consultant', 'therapist', 'staff', 'part_lead', 'tm'] as UserRole[]) {
    expect(canDeleteCustomer(role), `${role} 은 삭제 권한 없음(무변경)`).toBe(false);
  }
});

// ── null/undefined 안전 기본값(방어) ────────────────────────────────────────────────────
test('null/undefined role 은 수정·삭제 모두 false', () => {
  expect(canEditCustomer(null)).toBe(false);
  expect(canEditCustomer(undefined)).toBe(false);
  expect(canDeleteCustomer(null)).toBe(false);
  expect(canDeleteCustomer(undefined)).toBe(false);
});
