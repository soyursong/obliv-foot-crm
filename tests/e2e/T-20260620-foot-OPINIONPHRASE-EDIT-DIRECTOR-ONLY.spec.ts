/**
 * T-20260620-foot-OPINIONPHRASE-EDIT-DIRECTOR-ONLY
 * 소견서 상용구(서비스관리>진료관리) 편집 권한 = 어드민의사(대표원장)만
 *
 * 요청 (문지은 대표원장 U0ALGAAAJAV, #foot C0ATE5P6JTH, MSG-20260620-023304-oyu3):
 *   "소견서 상용구는 서비스관리>진료관리에서 어드민의사(대표원장)만 가능해야함 (추후 어드민원장은 추가될 수 있음)"
 *
 * 구현 모델 (ROLE-MATRIX hasOpsAuthority primitive 재사용):
 *   - 편집(추가/수정/삭제/저장/CSV업로드) 게이트 = canEditClinicMgmt(profile)
 *     · has_ops_authority === true → 편집 O (대표원장 + 추후 어드민원장: flag=true 부여로 자동 권한)
 *     · admin                       → 편집 O (시스템 슈퍼유저 escape — ★lock-out 가드)
 *     · director (flag無)           → 편집 O (MUNJIEUN-CLINICMGMT-LOCKOUT stopgap escape; flag landing 후 환원)
 *     · manager                     → 편집 X (운영 role-implied 이나 의료 surface 라 read-only)
 *     · 그 외 직원                  → 편집 X (read-only)
 *   - 특정 유저 하드코딩 금지 — 전적으로 role-flag 기반. 추후 어드민원장 추가 시 has_ops_authority=true 부여로 자동 획득.
 *
 * ★lock-out-safe: 역배정 전(전원 admin)/flag 미적재 상태에서도 admin·director escape 로 대표원장 미잠김.
 *
 * 브라우저 통합 시나리오(역할별 인증계정)는 역배정 apply 후 라이브 검증 → 여기서는 permissions.ts 헬퍼 직접 검증.
 *
 * 실행: npx playwright test T-20260620-foot-OPINIONPHRASE-EDIT-DIRECTOR-ONLY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { canEditClinicMgmt } from '../../src/lib/permissions';

// 소견서 상용구 편집 = canEditClinicMgmt 로 구현 → 동일 표본 프로필로 검증.
const P = {
  director_chief:   { role: 'director' as const, has_ops_authority: true },   // 어드민의사(대표원장) — 편집 O
  admin_director:   { role: 'director' as const, has_ops_authority: true },   // 추후 '어드민원장'(flag 부여) — 편집 O (확장성)
  doctor_assoc:     { role: 'director' as const, has_ops_authority: false },  // 봉직의(일반원장) — STOPGAP escape 로 현재 O
  staff_coord:      { role: 'coordinator' as const, has_ops_authority: false }, // 일반직원 — 편집 X
  staff_therapist:  { role: 'therapist' as const, has_ops_authority: false },   // 일반직원 — 편집 X
  staff_manager:    { role: 'manager' as const, has_ops_authority: false },     // manager — 의료 surface 라 read-only
  admin_transition: { role: 'admin' as const, has_ops_authority: false },       // ★전환기 문지은(역배정 전 admin)
  admin_system:     { role: 'admin' as const, has_ops_authority: false },       // system/test admin
};

test.describe('T-20260620-foot-OPINIONPHRASE-EDIT-DIRECTOR-ONLY — 소견서 상용구 편집 게이트', () => {
  // 시나리오 1: 어드민의사(대표원장) — 편집 가능
  test('어드민의사(대표원장, director+flag) → 소견서 상용구 편집 O', () => {
    expect(canEditClinicMgmt(P.director_chief)).toBe(true);
  });

  // 확장성: 추후 '어드민원장'(has_ops_authority=true 부여) → 하드코딩 없이 자동 편집 권한
  test('추후 어드민원장(flag=true 부여) → 소견서 상용구 편집 O (확장성·하드코딩 無)', () => {
    expect(canEditClinicMgmt(P.admin_director)).toBe(true);
  });

  // 시나리오 2: 일반직원/일반원장(manager 포함) — 편집 차단(read-only)
  test('일반직원(coordinator/therapist) → 소견서 상용구 편집 X', () => {
    expect(canEditClinicMgmt(P.staff_coord)).toBe(false);
    expect(canEditClinicMgmt(P.staff_therapist)).toBe(false);
  });

  test('manager → 소견서 상용구 편집 X (의료 surface, read-only)', () => {
    expect(canEditClinicMgmt(P.staff_manager)).toBe(false);
  });

  // 시나리오 3: lock-out 회귀가드
  test('★lock-out 가드: 전환기 문지은(admin, flag無) → 편집 O (admin escape)', () => {
    expect(canEditClinicMgmt(P.admin_transition)).toBe(true);
  });

  test('★lock-out 가드: 대표원장(director, swap 후 flag無) → 편집 O (director STOPGAP escape)', () => {
    expect(canEditClinicMgmt(P.doctor_assoc)).toBe(true);
  });

  test('system/test admin → 편집 O (슈퍼유저 escape, 무회귀)', () => {
    expect(canEditClinicMgmt(P.admin_system)).toBe(true);
  });

  // 누락/빈 프로필 방어
  test('profile null/undefined → 편집 X (안전 기본값)', () => {
    expect(canEditClinicMgmt(null)).toBe(false);
    expect(canEditClinicMgmt(undefined)).toBe(false);
  });
});
