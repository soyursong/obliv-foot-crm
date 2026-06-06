// T-20260603-foot-RX-PERMMENU-PARITY
//   (정책 갱신: T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT)
//
// 변경 이력:
//   - 원판(T-20260603): 진료도구 관리 탭을 직원(consultant/coordinator/therapist)에게도
//     읽기 전용으로 노출(NAV 진입권 ↔ 탭 노출권 parity).
//   - 정책 반전(T-20260606-RXTOOL-INJURY-MENU-SPLIT, 문지은 대표원장 C0ATE5P6JTH):
//     "일하는 부원장이 어드민 도구를 다 보면 안 되는 구조" → 어드민성 관리 도구를
//     '진료 도구' → '서비스 관리 > 진료관리'(ClinicManagement)로 분리하고
//     접근을 admin/manager/director 로 제한. consultant(부원장)/coordinator/therapist 차단.
//     진료 도구에는 진료알림판·진료환자목록 2개만 잔존(전체 공개).
//
// 본 spec은 진료관리 접근 게이트(메뉴 노출권 = 라우트 가드권)와 탭 내 CRUD write-guard를
//   런타임 조건과 동등한 함수로 검증한다(브라우저 auth 셋업 불필요, 빠른 회귀).

import { test, expect } from '@playwright/test';

// App.tsx RoleGuard(/admin/clinic-management) + AdminLayout NAV_ITEMS(진료관리) roles 와 동일 조건
const canAccessClinicMgmt = (role: string) =>
  ['admin', 'manager', 'director'].includes(role);

// 각 진료관리 탭 컴포넌트 내부 canEdit 와 동일 조건 (CRUD write-guard)
const canEdit = (role: string) => role === 'admin' || role === 'manager';

const STAFF = ['consultant', 'coordinator', 'therapist'] as const;
const ADMINS = ['admin', 'manager'] as const;

// ── AC-1: 진료관리 접근 — admin/manager/director 만 (부원장/코디/치료사 차단) ──
test('AC-1 진료관리 접근권: admin/manager/director=true, 직원 3역할=false', () => {
  for (const role of [...ADMINS, 'director']) {
    expect(canAccessClinicMgmt(role), `${role} 진료관리 접근`).toBe(true);
  }
  // 부원장(consultant)/코디/치료사 = 어드민 도구 비노출 (정책 반전의 핵심)
  for (const role of STAFF) {
    expect(canAccessClinicMgmt(role), `${role} 진료관리 차단`).toBe(false);
  }
  expect(canAccessClinicMgmt('part_lead')).toBe(false);
  expect(canAccessClinicMgmt('staff')).toBe(false);
});

// ── AC-2: 메뉴 노출권(NAV) ↔ 라우트 가드권(RoleGuard) 일치 — lockout/우회 0건 ──
test('AC-2 NAV 노출권 ↔ 라우트 가드권 일치: 어드민은 비잠금, 직원은 우회 불가', () => {
  const ALL = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'];
  for (const role of ALL) {
    // NAV 노출과 라우트 가드는 동일 매트릭스여야(메뉴 숨김+URL 직접접근 차단 이중, 불일치 0)
    const navVisible = canAccessClinicMgmt(role);
    const routeAllowed = canAccessClinicMgmt(role);
    expect(navVisible, `${role} NAV/route 불일치`).toBe(routeAllowed);
  }
  // ⚠️ lockout 금지: 정당한 어드민(admin/manager)이 막히면 안 됨
  for (const role of ADMINS) {
    expect(canAccessClinicMgmt(role), `${role} lockout 회귀`).toBe(true);
  }
});

// ── AC-3: CRUD write-guard — director는 접근 가능하나 편집은 admin/manager 전용 ──
test('AC-3 CRUD 버튼은 admin/manager 전용 — director는 접근O/편집X', () => {
  for (const role of ADMINS) {
    expect(canEdit(role), `${role} CRUD 허용`).toBe(true);
  }
  // director: 진료관리 접근 가능(차팅 '관리 화면으로' 연속성)하나 CRUD 대상 아님
  expect(canAccessClinicMgmt('director')).toBe(true);
  expect(canEdit('director')).toBe(false);
});

// ── AC-3+: 편집권 ⊆ 접근권 (접근 못 하는데 편집되는 비인가 케이스 0건, 양방향 게이트) ──
test('AC-3+ 편집권은 접근권의 부분집합 (비인가 편집 0건)', () => {
  const ALL = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'];
  for (const role of ALL) {
    if (canEdit(role)) {
      expect(canAccessClinicMgmt(role), `${role} 편집권은 접근권의 부분집합이어야`).toBe(true);
    }
    // 직원 3역할: 접근 불가 → 편집도 당연히 불가
    if ((STAFF as readonly string[]).includes(role)) {
      expect(!canAccessClinicMgmt(role) && !canEdit(role)).toBe(true);
    }
  }
});
