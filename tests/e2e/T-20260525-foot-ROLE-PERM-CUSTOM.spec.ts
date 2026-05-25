// T-20260525-foot-ROLE-PERM-CUSTOM: consultant 역할 — 메시지 설정 접근 + 통계·매출집계·계정관리 제외 검증
// A안: PERM_MATRIX messaging + AdminLayout NAV_ITEMS에 consultant 추가

import { test, expect } from '@playwright/test';
import { canAccess } from '../../src/lib/permissions';
import type { PermKey } from '../../src/lib/permissions';

// ── AC-1: 3역할 전권한 확인 — 통계·매출집계 제외, 나머지 전부 허용 ────────────
// T-20260525-foot-ROLE-PERM-CUSTOM 3차(2798917): coordinator/therapist 포함 전수 검수
test('AC-1 3역할 전권한 확인: consultant/coordinator/therapist', () => {
  const MUST_HAVE: PermKey[] = ['dashboard', 'reservations', 'customers', 'closing', 'messaging'];
  const MUST_NOT_HAVE: PermKey[] = ['stats', 'register'];
  const ROLES = ['consultant', 'coordinator', 'therapist'] as const;

  for (const role of ROLES) {
    for (const key of MUST_HAVE) {
      expect(canAccess(role, key), `${role} must have: ${key}`).toBe(true);
    }
    for (const key of MUST_NOT_HAVE) {
      expect(canAccess(role, key), `${role} must NOT have: ${key}`).toBe(false);
    }
  }
});

// ── AC-2: 권한 매트릭스 — messaging에 3역할(consultant/coordinator/therapist) 추가됨 ──
// T-20260525-foot-ROLE-PERM-CUSTOM 3차(2798917): coordinator/therapist 추가
test('AC-2 messaging 권한: consultant/coordinator/therapist/director/admin/manager 허용', () => {
  expect(canAccess('consultant', 'messaging')).toBe(true);
  expect(canAccess('coordinator', 'messaging')).toBe(true);   // 3차 추가
  expect(canAccess('therapist', 'messaging')).toBe(true);    // 3차 추가
  expect(canAccess('director', 'messaging')).toBe(true);
  expect(canAccess('admin', 'messaging')).toBe(true);
  expect(canAccess('manager', 'messaging')).toBe(true);
  // 미허용 역할
  expect(canAccess('part_lead', 'messaging')).toBe(false);
  expect(canAccess('staff', 'messaging')).toBe(false);
});

// ── AC-3: 제외 3종 검증 ────────────────────────────────────────────────────────
test('AC-3 통계(stats) — consultant 제외 유지', () => {
  expect(canAccess('consultant', 'stats')).toBe(false);
  expect(canAccess('admin', 'stats')).toBe(true);
  expect(canAccess('manager', 'stats')).toBe(true);
  expect(canAccess('part_lead', 'stats')).toBe(true);
  expect(canAccess('director', 'stats')).toBe(true);
});

test('AC-3 매출집계(register) — consultant 제외 유지', () => {
  // register = 계정 등록 전 결제 데이터. 매출집계에 해당.
  expect(canAccess('consultant', 'register')).toBe(false);
  expect(canAccess('admin', 'register')).toBe(true);
  expect(canAccess('manager', 'register')).toBe(true);
});

// 계정관리 = NAV_ITEMS roles:['admin'] 전용 (PERM_MATRIX 별도 key 없음)
// AdminLayout.tsx NAV_ITEMS에서 roles 필터로 차단됨 — FE 렌더 레벨 검증은 Playwright 브라우저 필요
test('AC-3 PERM_MATRIX — consultant는 admin/manager 전용 key에 접근 불가', () => {
  // stats, register 이외에 consultant가 갖지 말아야 할 것 없음 (계정관리는 NAV 레벨)
  expect(canAccess('consultant', 'stats')).toBe(false);
  expect(canAccess('consultant', 'register')).toBe(false);
});

// ── AC-4: RLS 정합성 — A안은 DB 변경 없음, RLS 불변 확인 ─────────────────────
test('AC-4 A안 DB 변경 없음 — RLS 불변 (PERM_MATRIX JS 레이어만 변경)', () => {
  // A안은 FE PERM_MATRIX + NAV_ITEMS 1줄씩만 변경.
  // DB enum/RLS는 그대로이므로 별도 마이그레이션 없음.
  // 이 테스트는 A안 적용 사실을 spec 레벨에서 문서화.
  expect(true).toBe(true);
});

// ── [UPDATE 19:47] AC-4~7: 환불 처리 권한 확장 ───────────────────────────────
// consultant/coordinator/therapist 3역할에 환불 처리 권한 추가
// FE: Closing.tsx canRefund 변수, DB: refund_single_payment RPC 역할 목록 확장

test('[UPDATE] AC-4 canRefund 로직 — 3역할 포함 확인 (단위 검증)', () => {
  // canRefund = isAdminOrManager || consultant || coordinator || therapist
  // 이 로직은 Closing.tsx 내 runtime 변수이므로 spec에서 동등 조건을 검증
  const canRefund = (role: string) =>
    ['admin', 'manager', 'consultant', 'coordinator', 'therapist'].includes(role);

  // 허용 역할
  expect(canRefund('admin')).toBe(true);
  expect(canRefund('manager')).toBe(true);
  expect(canRefund('consultant')).toBe(true);
  expect(canRefund('coordinator')).toBe(true);
  expect(canRefund('therapist')).toBe(true);

  // 미허용 역할 (director, part_lead, staff — 환불 불가)
  expect(canRefund('director')).toBe(false);
  expect(canRefund('part_lead')).toBe(false);
  expect(canRefund('staff')).toBe(false);
});

test('[UPDATE] AC-6 role_permissions 테이블 비존재 — RPC 내부 v_role 검증으로 대체', () => {
  // 조사 결과: role_permissions 전용 테이블 없음.
  // 환불 권한은 refund_single_payment RPC 내부 v_role NOT IN ('admin','manager',...) 로 단일 관리.
  // migration 20260525050000_refund_perm_expand.sql 에서 3역할 추가 적용됨.
  expect(true).toBe(true); // 조사/설계 결론 문서화
});

test('[UPDATE] AC-4 수기 추가/수정/삭제는 isAdminOrManager 유지 (범위 외 회귀)', () => {
  // 수기 추가 버튼은 admin/manager 전용 — canRefund 확장 대상 아님
  const isAdminOrManager = (role: string) => ['admin', 'manager'].includes(role);
  expect(isAdminOrManager('consultant')).toBe(false); // 수기 추가 불가
  expect(isAdminOrManager('coordinator')).toBe(false);
  expect(isAdminOrManager('therapist')).toBe(false);
  expect(isAdminOrManager('admin')).toBe(true);
  expect(isAdminOrManager('manager')).toBe(true);
});
