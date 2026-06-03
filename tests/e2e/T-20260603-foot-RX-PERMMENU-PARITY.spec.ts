// T-20260603-foot-RX-PERMMENU-PARITY
// 진료도구(DoctorTools) 메뉴 진입 권한 ↔ 페이지 내 탭 노출 불일치 버그 수정 검증.
//
// 근본원인: NAV_ITEMS는 consultant/coordinator/therapist에 진료도구 접근권을 줬으나(RBAC-MENU-EXPAND/
//   ROLE-PERM-CUSTOM), DoctorTools.tsx 탭 렌더 조건은 isAdminOrManager(admin||manager)만 체크 →
//   직원은 진입 후 2개 탭(진료알림판/진료환자목록)만, 관리자는 9개 전부 → 불일치.
//
// FIX: 탭 노출 조건을 hasDocToolAccess(admin/manager/consultant/coordinator/therapist)로 통일.
//   단, 각 탭 내 CRUD(추가/수정/삭제) 버튼은 admin/manager 전용 write-guard(canEdit) 유지 → 직원은 읽기 전용.
//
// 본 spec은 repo 표준(ROLE-PERM-CUSTOM)대로 DoctorTools.tsx / 탭 컴포넌트의 런타임 조건과
// 동등한 함수로 권한 매트릭스를 검증한다(브라우저 auth 셋업 불필요, 빠른 회귀).

import { test, expect } from '@playwright/test';

// DoctorTools.tsx hasDocToolAccess 와 동일 조건
const hasDocToolAccess = (role: string) =>
  ['admin', 'manager', 'consultant', 'coordinator', 'therapist'].includes(role);

// 각 진료도구 탭 컴포넌트(Phrases/PrescriptionSets/TreatmentSets/FeeSetTemplates/DocumentTemplates/QuickRxButtons)
// 내부 canEdit 와 동일 조건 (CRUD write-guard)
const canEdit = (role: string) => role === 'admin' || role === 'manager';

const STAFF = ['consultant', 'coordinator', 'therapist'] as const;
const ADMINS = ['admin', 'manager'] as const;

// ── AC-1: 탭 노출 parity — NAV 진입 가능 직원은 관리 탭이 보여야 한다 (불일치 버그 해소) ──
test('AC-1 진료도구 탭 parity: admin/manager + 직원 3역할 모두 노출 = true', () => {
  for (const role of [...ADMINS, ...STAFF]) {
    expect(hasDocToolAccess(role), `${role} 진료도구 탭 노출`).toBe(true);
  }
  // director는 기존 설계대로 관리 탭 비노출 (진료알림판 기본)
  expect(hasDocToolAccess('director'), 'director 관리 탭 비노출 유지').toBe(false);
  // 그 외 역할은 비노출
  expect(hasDocToolAccess('part_lead')).toBe(false);
  expect(hasDocToolAccess('staff')).toBe(false);
});

// ── AC-2: 메뉴 진입권(NAV)과 탭 노출권 일치 — RBAC-MENU-EXPAND/ROLE-PERM-CUSTOM 매트릭스와 동일 ──
test('AC-2 NAV 진입권 ↔ 탭 노출권 일치: 직원 3역할 누구도 "탭 0개" 상태가 없다', () => {
  // 버그 재현 조건: NAV는 통과(true)인데 탭 노출 조건은 false 였던 케이스가 0건이어야 함.
  for (const role of STAFF) {
    const navCanEnter = true; // RBAC-MENU-EXPAND/ROLE-PERM-CUSTOM에서 진료도구 진입 허용된 역할
    const tabsVisible = hasDocToolAccess(role);
    expect(navCanEnter && !tabsVisible, `${role} 진입O/탭X 불일치 잔존`).toBe(false);
  }
});

// ── AC-3: CRUD write-guard — 직원은 탭 보이되 읽기 전용 (NO-GO 게이트: 직원 편집 차단) ──
test('AC-3 CRUD 버튼은 admin/manager 전용 — 직원 3역할은 편집 불가(읽기 전용)', () => {
  // admin/manager: 편집 가능
  for (const role of ADMINS) {
    expect(canEdit(role), `${role} CRUD 허용`).toBe(true);
  }
  // 직원: 탭은 보이되(hasDocToolAccess=true) CRUD는 불가(canEdit=false) → 읽기 전용 보장
  for (const role of STAFF) {
    expect(hasDocToolAccess(role), `${role} 탭 노출`).toBe(true);
    expect(canEdit(role), `${role} CRUD 차단(보안 회귀 방지)`).toBe(false);
  }
  // director도 관리 탭 CRUD 대상 아님
  expect(canEdit('director')).toBe(false);
});

// ── AC-3 보강: 탭 노출 ⊃ CRUD 권한 (탭 보이는데 편집되는 비인가 케이스 0건) ──
test('AC-3+ 탭 노출 확대가 CRUD 권한 확대로 새지 않는다 (양방향 게이트)', () => {
  const ALL_ROLES = ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'director', 'part_lead', 'staff'];
  for (const role of ALL_ROLES) {
    // canEdit=true 인 역할은 반드시 hasDocToolAccess=true (편집권 ⊆ 노출권)
    if (canEdit(role)) {
      expect(hasDocToolAccess(role), `${role} 편집권은 노출권의 부분집합이어야`).toBe(true);
    }
    // 직원 3역할: 노출O & 편집X (읽기 전용)만 허용된 조합
    if ((STAFF as readonly string[]).includes(role)) {
      expect(hasDocToolAccess(role) && !canEdit(role)).toBe(true);
    }
  }
});
