/**
 * T-20260819-foot-CHARTPHRASE-EDIT-DIRECTOR-ONLY
 * 상용구(고객차트) 편집 권한 = 대표원장 tier 전용 (서비스관리>상용구관리>상용구(고객차트) 탭)
 *
 * 요청 (문지은 대표원장 U0ALGAAAJAV, #foot C0ATE5P6JTH, MSG-20260819-221100-7er7):
 *   "진료차트(고객차트)에서 쓰는 자주 쓰는 문구(상용구)의 수정·추가 권한을 대표원장님만 할 수 있도록."
 *   - customer_chart 상용구 등록·수정·삭제 = 대표원장 tier 만
 *   - 직원(치료사·데스크)·봉직의 = 읽기전용(조회·선택[진료차트 삽입]은 정상, 편집만 차단)
 *
 * 구현 모델 (경로 A — ROLE-MATRIX-3TIER-RBAC 재사용):
 *   - customer_chart 편집 게이트 = canEditCustomerChartPhrase(profile) = canEditClinicMgmt 위임(대표원장 tier).
 *     · has_ops_authority === true → 편집 O (대표원장 + 추후 어드민원장: flag=true 자동 권한)
 *     · admin                       → 편집 O (시스템 슈퍼유저 escape — ★lock-out 가드)
 *     · director (flag無)           → 편집 O (MUNJIEUN-CLINICMGMT-LOCKOUT stopgap escape; flag landing 후 환원)
 *     · manager                     → 편집 X (운영 role-implied 이나 의료-인접 surface 라 read-only)
 *     · 그 외 직원(coordinator/therapist/...) → 편집 X (read-only, AC-1)
 *   - restrictive-only: 기존 canEditStaffAreaPhrase(7역할) → 대표원장 tier 로 좁힘. 대표원장 기존권한 무변경(AC-3).
 *   - 특정 유저 하드코딩 금지 — role/flag 기반. 형제 OPINIONPHRASE-EDIT-DIRECTOR-ONLY 와 동형 tier.
 *
 * ★db_change=false (FE-only): director/admin DB write 는 admin_write_phrase_templates({admin,manager,director},
 *   all-type)로 旣허용 → lock-out-in-disguise 아님. staff DB write 잔존 → API 직접우회 false-read-only 가능(AC-4).
 *
 * 브라우저 통합 시나리오(역할별 인증계정)는 역배정 apply 후 라이브 검증 → 여기서는 permissions.ts 헬퍼 직접 검증.
 *
 * 실행: npx playwright test T-20260819-foot-CHARTPHRASE-EDIT-DIRECTOR-ONLY.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  canEditCustomerChartPhrase,
  canEditClinicMgmt,
  canEditStaffAreaPhrase,
} from '../../src/lib/permissions';

const P = {
  director_chief:   { role: 'director' as const, has_ops_authority: true },     // 대표원장(문지은) — 편집 O
  admin_director:   { role: 'director' as const, has_ops_authority: true },     // 추후 어드민원장(flag 부여) — 편집 O
  doctor_assoc:     { role: 'director' as const, has_ops_authority: false },    // 봉직의(일반원장) — STOPGAP escape 로 현재 O
  staff_coord:      { role: 'coordinator' as const, has_ops_authority: false }, // 일반직원(데스크) — 편집 X
  staff_therapist:  { role: 'therapist' as const, has_ops_authority: false },   // 치료사 — 편집 X
  staff_manager:    { role: 'manager' as const, has_ops_authority: false },     // manager — 의료-인접 surface read-only
  admin_transition: { role: 'admin' as const, has_ops_authority: false },       // ★전환기 문지은(역배정 전 admin)
  admin_system:     { role: 'admin' as const, has_ops_authority: false },       // system/test admin
};

test.describe('T-20260819-foot-CHARTPHRASE-EDIT-DIRECTOR-ONLY — 상용구(고객차트) 편집 게이트', () => {
  // AC-1: 대표원장 tier 만 편집 가능
  test('대표원장(director+flag) → 고객차트 상용구 편집 O', () => {
    expect(canEditCustomerChartPhrase(P.director_chief)).toBe(true);
  });

  test('추후 어드민원장(flag=true 부여) → 편집 O (확장성·하드코딩 無)', () => {
    expect(canEditCustomerChartPhrase(P.admin_director)).toBe(true);
  });

  // AC-1: 직원(치료사·데스크)·manager → 편집 차단(read-only)
  test('일반직원(coordinator/therapist) → 고객차트 상용구 편집 X (AC-1)', () => {
    expect(canEditCustomerChartPhrase(P.staff_coord)).toBe(false);
    expect(canEditCustomerChartPhrase(P.staff_therapist)).toBe(false);
  });

  test('manager → 편집 X (의료-인접 surface, read-only)', () => {
    expect(canEditCustomerChartPhrase(P.staff_manager)).toBe(false);
  });

  // ★lock-out 회귀가드
  test('★lock-out 가드: 전환기 문지은(admin, flag無) → 편집 O (admin escape)', () => {
    expect(canEditCustomerChartPhrase(P.admin_transition)).toBe(true);
  });

  test('★lock-out 가드: 대표원장(director, swap 후 flag無) → 편집 O (director STOPGAP escape)', () => {
    expect(canEditCustomerChartPhrase(P.doctor_assoc)).toBe(true);
  });

  test('system/test admin → 편집 O (슈퍼유저 escape, 무회귀)', () => {
    expect(canEditCustomerChartPhrase(P.admin_system)).toBe(true);
  });

  test('profile null/undefined → 편집 X (안전 기본값 fail-closed)', () => {
    expect(canEditCustomerChartPhrase(null)).toBe(false);
    expect(canEditCustomerChartPhrase(undefined)).toBe(false);
  });

  // AC-3: 대표원장 tier 정의는 canEditClinicMgmt(진료관리)와 1:1 — 형제 게이트 정합(SSOT 위임)
  test('AC-3 SSOT 위임: canEditCustomerChartPhrase == canEditClinicMgmt (전 표본 동치)', () => {
    for (const p of Object.values(P)) {
      expect(canEditCustomerChartPhrase(p)).toBe(canEditClinicMgmt(p));
    }
    expect(canEditCustomerChartPhrase(null)).toBe(canEditClinicMgmt(null));
  });

  // restrictive-only 회귀가드: 기존 canEditStaffAreaPhrase(7역할, director 제외)와 다른 tier 임을 명시.
  //   직원(therapist)은 이전엔 편집 O였으나 본 게이트로 read-only 로 좁혀짐(신규 제약).
  //   대표원장(director)은 이전엔 편집 X였으나 본 게이트로 편집 O(요청 반영). = 축이 뒤집힘(restrictive-only 편집 대상 이동).
  test('restrictive-only: staff-area 게이트와 tier 분리(치료사 편집 회수 / 대표원장 편집 부여)', () => {
    // 치료사: staff-area 에선 편집 O(기존) → customer_chart 대표원장 게이트에선 편집 X(신규 제약)
    expect(canEditStaffAreaPhrase(P.staff_therapist.role)).toBe(true);
    expect(canEditCustomerChartPhrase(P.staff_therapist)).toBe(false);
    // 대표원장(director): staff-area 에선 편집 X(제외) → customer_chart 대표원장 게이트에선 편집 O
    expect(canEditStaffAreaPhrase(P.director_chief.role)).toBe(false);
    expect(canEditCustomerChartPhrase(P.director_chief)).toBe(true);
  });

  // pen_chart(펜차트, 직원영역) 게이트는 무변경 — customer_chart 만 좁힘(scope 격리 확인)
  test('scope 격리: pen_chart 직원영역 게이트(canEditStaffAreaPhrase) 무변경', () => {
    // 직원 7역할은 여전히 pen_chart 편집 O(회귀 0)
    expect(canEditStaffAreaPhrase('coordinator')).toBe(true);
    expect(canEditStaffAreaPhrase('therapist')).toBe(true);
    expect(canEditStaffAreaPhrase('staff')).toBe(true);
  });
});
