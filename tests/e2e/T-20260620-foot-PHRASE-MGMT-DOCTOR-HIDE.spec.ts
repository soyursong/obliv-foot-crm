// T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE — 서비스관리>상용구관리 메뉴 봉직의 비노출(대표원장 유지) 게이트 검증
//   확정 스펙(김주연 총괄 slack ts 1781924207.232909 = 옵션2/A안): 봉직의/일반의사만 비노출, 대표원장(director) 유지.
//   role 실측(2026-06-20 user_profiles): 의사 role = director 1명(문지은=대표원장)뿐, 봉직의 role 미존재.
//   → 봉직의 계정이 없으므로 role 게이트 단위 테스트 + 임시 role override(DOCTOR_ROLES 확장)로 hide 경로 검증.
//
// ROLE-PERM-CUSTOM.spec.ts 컨벤션: Playwright runner 로 순수 함수(권한 술어) 단위 검증(브라우저 불요).

import { test, expect } from '@playwright/test';
import { canViewPhraseMgmt, DOCTOR_ROLES } from '../../src/lib/permissions';
import type { UserRole } from '../../src/lib/permissions';

// ── 시나리오 1: 대표원장 — 상용구관리 접근 유지 (★핵심 가드: 오전 lock-out incident 재현 방지) ──
test('AC-2/시나리오1: 대표원장(director)은 has_ops_authority 유무와 무관하게 상용구관리 노출 유지', () => {
  // 현재 prod 현실: 문지은 = role='director', has_ops_authority 컬럼 미적재(=undefined) → 반드시 노출
  expect(canViewPhraseMgmt({ role: 'director' }), 'director(flag無=현 문지은) 노출').toBe(true);
  expect(canViewPhraseMgmt({ role: 'director', has_ops_authority: true }), 'director+ops 노출').toBe(true);
  expect(canViewPhraseMgmt({ role: 'director', has_ops_authority: false }), 'director+flag=false 도 노출(lock-out 금지)').toBe(true);
  // 문자열 role 직접 입력 호환
  expect(canViewPhraseMgmt('director')).toBe(true);
});

// ── 시나리오 3: 직원·기타 역할 무회귀 (AC-5) ──
test('AC-5/시나리오3: 전 직원(admin/manager/consultant/coordinator/therapist/staff/part_lead) 무회귀 노출', () => {
  const STAFF: UserRole[] = ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'staff', 'part_lead'];
  for (const role of STAFF) {
    expect(canViewPhraseMgmt({ role }), `${role} 무회귀 노출`).toBe(true);
    expect(canViewPhraseMgmt(role), `${role} (string) 무회귀 노출`).toBe(true);
  }
});

// ── 시나리오 2: 봉직의/일반의사(대표원장 아닌 의사 role) — 비노출 + 자동 적용(AC-1/AC-3/AC-4) ──
//   봉직의 계정/role 이 아직 없으므로 임시 role override 로 DOCTOR_ROLES 확장 → hide 경로 검증 후 원복.
test('AC-1/AC-4/시나리오2: 봉직의(대표원장 아닌 의사 role)는 상용구관리 비노출 — DOCTOR_ROLES 자동 적용', () => {
  const ASSOC: UserRole = 'associate_doctor'; // 향후 신설 봉직의 role 시뮬레이션
  expect(DOCTOR_ROLES.includes('director'), 'director 는 의사 role registry 에 존재(확장 지점)').toBe(true);
  // 사전: 미등록 role 은 (직원과 동일하게) 노출 — 봉직의 role 신설 전 상태
  expect(canViewPhraseMgmt({ role: ASSOC })).toBe(true);
  // 봉직의 role 신설 시뮬레이션: DOCTOR_ROLES 에 추가하면 즉시 비노출(개별 user 설정 X = AC-4 자동 적용)
  DOCTOR_ROLES.push(ASSOC);
  try {
    expect(canViewPhraseMgmt({ role: ASSOC }), '봉직의 비노출').toBe(false);
    // ★단, 봉직의라도 운영최고권한 flag 보유 시(= 대표원장 승격) escape 노출
    expect(canViewPhraseMgmt({ role: ASSOC, has_ops_authority: true }), '봉직의+ops escape').toBe(true);
    // ★대표원장(director)은 봉직의 role 추가 후에도 여전히 노출(격리 보장)
    expect(canViewPhraseMgmt({ role: 'director' }), 'director 격리 노출 유지').toBe(true);
  } finally {
    // 원복: 테스트 격리(전역 const 오염 방지)
    const i = DOCTOR_ROLES.indexOf(ASSOC);
    if (i >= 0) DOCTOR_ROLES.splice(i, 1);
  }
  // 원복 확인
  expect(DOCTOR_ROLES.includes(ASSOC)).toBe(false);
});

// ── 가드: null/undefined 안전 ──
test('가드: 미인증/role 부재 → 비노출(false)', () => {
  expect(canViewPhraseMgmt(null)).toBe(false);
  expect(canViewPhraseMgmt(undefined)).toBe(false);
  expect(canViewPhraseMgmt({ role: null })).toBe(false);
});
