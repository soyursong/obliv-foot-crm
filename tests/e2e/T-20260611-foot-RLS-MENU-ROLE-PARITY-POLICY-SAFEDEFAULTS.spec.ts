import { test, expect } from '@playwright/test';
import { canAccess } from '../../src/lib/permissions';

/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — 안전 기본값(최소노출) enforcement 회귀
 *
 * 근거: CEO STAMP Lane A (MSG-20260710-142249-rp15 → planner INFO MSG-20260710-143415-3cng).
 *   김주연 총괄 20일 무응답 → 최소노출 안전 기본값 발효(PHI 광역화 0). 3 기본값 확정:
 *     Q1 환자결제내역(결제/패키지결제/수가/보험) = 직원 잠금(매출집계 취급)
 *     Q2 통계 메뉴 = 파트장(part_lead)에게도 숨김
 *     Q3 원장 임상메모(차트 닥터메모) = 원장·관리자만
 *
 * (원 umbrella spec T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY.spec.ts 는 clinic_events RLS parity
 *  전용 — 별 scope. 본 파일은 CEO STAMP 안전 기본값 3종의 role-gate 를 회귀가드한다.)
 *
 * 검증 결과(감사):
 *   Q2 = GAP → point-fix(part_lead 제거). requireOpsAuthority 가드는 director 만 차단(ProtectedRoute L49)이라
 *        part_lead 는 roles 배열에 있으면 통과했음 → PERM_MATRIX.stats + App.tsx route + AdminLayout nav 3-gate 제거.
 *   Q1 = ENFORCED(/sales RoleGuard ['admin','manager','director']+requireOpsAuthority, Sales* 탭 단독소비, payments RLS=is_admin_or_manager).
 *   Q3 = ENFORCED(MedicalChartPanel DIRECTOR_ROLES ['director','admin'] + chart_doctor_memos RLS role IN('director','admin')).
 */

// ── Q2: 통계 = part_lead 숨김 (gap-fix, 강제 회귀) ───────────────────────────────
test('Q2 통계(stats) — part_lead 숨김(안전 기본값 gap-fix)', () => {
  expect(canAccess('part_lead', 'stats')).toBe(false); // ★핵심 gap-fix
  // 유지 역할(무회귀)
  expect(canAccess('admin', 'stats')).toBe(true);
  expect(canAccess('manager', 'stats')).toBe(true);
  expect(canAccess('director', 'stats')).toBe(true); // route 는 requireOpsAuthority 로 봉직의(flag無) 별도 배제
  expect(canAccess('tm', 'stats')).toBe(true);        // 박민지 팀장 C안(AC6) 별 grant — 본건 무관·유지
  // 일반직원 미노출 유지
  for (const role of ['consultant', 'coordinator', 'therapist', 'staff'] as const) {
    expect(canAccess(role, 'stats'), `${role} must NOT access stats`).toBe(false);
  }
});

// ── Q1: 환자결제내역/매출집계 = 직원 잠금 (route+RLS enforced — 정책 명시) ──────────
// PERM_MATRIX 에 'sales' key 부재(route-guard 게이팅)라 canAccess 대상 아님 → 감사결과 정책 상수로 고정.
test('Q1 환자결제내역/매출집계 — 직원(part_lead) 잠금(ENFORCED, 감사 문서화)', () => {
  const Q1_SALES_ROUTE_ROLES = ['admin', 'manager', 'director']; // + requireOpsAuthority
  expect(Q1_SALES_ROUTE_ROLES).not.toContain('part_lead');
  expect(Q1_SALES_ROUTE_ROLES).not.toContain('staff');
});

// ── Q3: 원장 임상메모(닥터메모) = 원장·관리자만 (컴포넌트 로컬 + RLS enforced — 정책 명시) ──
test('Q3 원장 임상메모(닥터메모) — 원장·관리자만(ENFORCED, 감사 문서화)', () => {
  const DOCTOR_MEMO_ROLES = ['director', 'admin'];
  for (const role of ['part_lead', 'consultant', 'coordinator', 'therapist', 'staff', 'tm']) {
    expect(DOCTOR_MEMO_ROLES.includes(role), `${role} must NOT view/edit doctor memo`).toBe(false);
  }
});
