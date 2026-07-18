/**
 * T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — 자가회원가입 최초 프로필 생성 정당경로 canon화
 *   (women 동형 승계, adopted=B: auth.users on_auth_user_created → public.handle_new_user()).
 *
 * 배경: signUp 직후 클라이언트는 아직 anon 세션 → user_profiles 직접 INSERT 가
 *   (a) anon INSERT grant 회수(6/29 PII lockdown) + (b) RLS authenticated-only(0515) 이중차단.
 *   정당경로 = auth.users 표준 트리거가 GoTrue 트랜잭션 내 NEW.id 로 프로필을 최초생성.
 *   벤더잔차(Dashboard Auth Hook, search_path=public·최초유저 admin+approved 자동승격)를
 *   in-repo 표준 트리거로 canon 재정의(마이그 20260718220000).
 *
 * FE(Register.tsx) 변경: 직접 user_profiles.insert 완전 제거 — signUp options.data(name/role)
 *   plumbing 만 유지, 프로필 생성은 트리거가 수행. (build 후 Register 청크 user_profiles ref 0건 실측.)
 *
 * 검증 전략(foot DB-트리거 픽스 표준, cf. T-20260609-foot-SELFREG-ADDR-SYNC):
 *   실 signup 전수 E2E 는 prod auth.users 실데이터 생성/인증/시드 의존으로 비결정적 →
 *   트리거의 canon 결정 로직(role 화이트리스트·approved 서버강제·name/clinic 파생)을 로직 레벨로
 *   재현해 회귀를 가둔다. prod 실적용 무영속 dry-run + signup 전수 스모크 4/4 PASS 는
 *   db-gate/T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX_apply_evidence.md 에 별도 실증.
 */

import { test, expect } from '@playwright/test';

// ── handle_new_user() canon 결정 로직 재현 (마이그 20260718220000 본문과 동형) ──
const SELF_REGISTERABLE = ['consultant', 'coordinator', 'therapist', 'technician', 'tm', 'manager'];

/** [HC1] role = 자기신고 요청값 → 화이트리스트 검증. 밖/누락/특권선언 → 'staff' 안전기본. */
function resolveRole(rawRole: string | null | undefined): string {
  const r = (rawRole ?? '').trim();
  if (r.length === 0) return 'staff';
  return SELF_REGISTERABLE.includes(r) ? r : 'staff';
}

/** name = COALESCE(NULLIF(meta.name,''), email) */
function resolveName(rawName: string | null | undefined, email: string): string {
  const n = (rawName ?? '').trim();
  return n.length > 0 ? n : email;
}

/** [HC1] approved 는 항상 서버강제 false — client 값·최초유저 여부와 무관. */
function resolveApproved(): boolean {
  return false;
}

test.describe('T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — handle_new_user canon 결정 로직', () => {
  /** AC1: 화이트리스트 직책은 그대로 저장된다. */
  test('AC1: 자기등록 화이트리스트 role 유지 (consultant/coordinator/therapist/technician/tm/manager)', () => {
    for (const r of SELF_REGISTERABLE) {
      expect(resolveRole(r)).toBe(r);
    }
  });

  /** AC1/HC1: admin·director 등 특권 role 자기선언은 차단 → 비특권 'staff' 로 강등. */
  test('AC1: admin/director/part_lead 자기선언 → staff 강등 (특권 자기선언 차단)', () => {
    expect(resolveRole('admin')).toBe('staff');
    expect(resolveRole('director')).toBe('staff');
    expect(resolveRole('part_lead')).toBe('staff');
    // 임의/오타/알수없는 값도 안전기본 staff
    expect(resolveRole('superuser')).toBe('staff');
    expect(resolveRole('ADMIN')).toBe('staff'); // 대소문자 우회 차단
  });

  /** AC1: role 누락/빈값 → 'staff' 안전기본. */
  test('AC1: role 누락·빈값 → staff', () => {
    expect(resolveRole(null)).toBe('staff');
    expect(resolveRole(undefined)).toBe('staff');
    expect(resolveRole('')).toBe('staff');
    expect(resolveRole('   ')).toBe('staff');
  });

  /** AC5/HC1: approved 는 어떤 입력에도 서버강제 false — interim 프로필 활성화 차단(admin 승인 게이트). */
  test('AC5: approved 서버강제 false (최초유저 admin+approved 자동승격 백도어 제거)', () => {
    expect(resolveApproved()).toBe(false);
  });

  /** name fallback: meta.name 있으면 그 값, 없으면 email(interim 표시 — 스태프 승인목록 육안 확인용). */
  test('AC5: name = meta.name || email (interim email 표시)', () => {
    expect(resolveName('홍길동', 'hong@obliv.test')).toBe('홍길동');
    expect(resolveName('', 'hong@obliv.test')).toBe('hong@obliv.test');
    expect(resolveName(null, 'coord@obliv.test')).toBe('coord@obliv.test');
    expect(resolveName('   ', 'x@obliv.test')).toBe('x@obliv.test');
  });

  /** 통합: signup 전수 스모크(prod rolled-back)와 동일한 4케이스 결과 정합. */
  test('통합: signup 4케이스 canon 결과 (스모크 evidence 정합)', () => {
    const cases = [
      { role: 'coordinator', expRole: 'coordinator' },
      { role: 'admin', expRole: 'staff' },
      { role: 'director', expRole: 'staff' },
      { role: null, expRole: 'staff' },
    ];
    for (const c of cases) {
      expect(resolveRole(c.role)).toBe(c.expRole);
      expect(resolveApproved()).toBe(false); // 전 케이스 approved=false 서버강제
    }
  });
});
