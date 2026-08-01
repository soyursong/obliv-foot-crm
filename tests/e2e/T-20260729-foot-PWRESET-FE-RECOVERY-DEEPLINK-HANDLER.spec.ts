import { test, expect } from '@playwright/test';
// recovery 딥링크 판정·검증 순수 로직 SSOT(App.RecoveryGate·ResetPassword 가 직접 소비 → drift 방지).
import {
  detectRecoveryFromHash,
  validateNewPassword,
  classifyUpdateUserError,
} from '../../src/lib/passwordRecovery';

/**
 * E2E(순수 단언) — T-20260729-foot-PWRESET-FE-RECOVERY-DEEPLINK-HANDLER
 *
 * 배경: recovery 메일 링크를 클릭해도 site_url 루트에 착지할 뿐 비밀번호 재설정 화면이 뜨지 않던
 *   defect(= PASSWORD_RECOVERY 핸들러/재설정 라우트 부재). App.RecoveryGate 가 착지 hash 를
 *   동기 캡처(detectRecoveryFromHash) + PASSWORD_RECOVERY 이벤트로 이중 감지해 ResetPassword 를
 *   렌더한다. 본 spec 은 그 판정·검증 로직을 현장 클릭 시나리오 3종에 대해 단언한다.
 *
 * repo 컨벤션: 브라우저 없이도 계약이 고정되도록 컴포넌트가 소비하는 순수 함수를 직접 import·단언한다.
 *   실제 recovery 토큰이 필요한 full-path 실측(메일 수신→클릭→재설정→로그인)은 AC#6 field confirm
 *   게이트(부모 T-20260729-foot-PWRESET-EMAIL-LINK-BLOCKED-DANGEROUS 통합)에서 테스트 계정으로 커버.
 */

// ── 시나리오 1: 정상 동선 (recovery 토큰 착지 → 재설정 폼 노출) ──
test('시나리오1: recovery 토큰 hash 착지 → recovery 모드(재설정 폼 렌더)', () => {
  const hash = '#access_token=eyJhbGc.abc.def&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery';
  const cls = detectRecoveryFromHash(hash);
  expect(cls.recovery).toBe(true);
  expect(cls.expired).toBe(false);
});

test('시나리오1: 새 비밀번호 정책 — 영문+숫자 8자 이상 통과, 위반 안내', () => {
  // 통과
  expect(validateNewPassword('abc12345')).toBeNull();
  // 8자 미만
  expect(validateNewPassword('ab12')).toContain('8자');
  // 영문 없음
  expect(validateNewPassword('12345678')).toContain('영문');
  // 숫자 없음
  expect(validateNewPassword('abcdefgh')).toContain('숫자');
});

// ── 시나리오 2: 엣지 케이스 (만료·재사용·손상 토큰 → 재요청 안내, 백지/무한로딩 금지) ──
test('시나리오2: 만료(otp_expired) 오류 hash → expired 모드(재요청 안내 화면)', () => {
  const hash =
    '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  const cls = detectRecoveryFromHash(hash);
  expect(cls.expired).toBe(true);
  expect(cls.recovery).toBe(false);
});

test('시나리오2: access_denied 오류 hash(코드만) → expired 모드', () => {
  const cls = detectRecoveryFromHash('#error=access_denied&error_code=403');
  expect(cls.expired).toBe(true);
  expect(cls.recovery).toBe(false);
});

test('시나리오2: updateUser 세션 만료/무효 오류 → expired 화면으로 강등(무한로딩·백지 금지)', () => {
  expect(classifyUpdateUserError('Auth session missing!')).toBe('expired');
  expect(classifyUpdateUserError('JWT expired')).toBe('expired');
  expect(classifyUpdateUserError('invalid or expired token')).toBe('expired');
});

test('시나리오2: updateUser 동일 비밀번호 거부 → 폼 유지(same), 그 외 → generic', () => {
  expect(classifyUpdateUserError('New password should be different from the old password.')).toBe('same');
  expect(classifyUpdateUserError('some unknown server error')).toBe('generic');
});

// ── 시나리오 3: 회귀 (recovery 토큰 없이 루트 진입 → 평소 화면, 재설정 폼 오노출 없음) ──
test('시나리오3: 토큰 없는 빈 hash → recovery/expired 모두 false(평소 Routes 렌더)', () => {
  const cls = detectRecoveryFromHash('');
  expect(cls.recovery).toBe(false);
  expect(cls.expired).toBe(false);
});

test('시나리오3: 무관한 hash(라우팅 fragment 등) → recovery/expired 모두 false', () => {
  expect(detectRecoveryFromHash('#/admin/reservations')).toEqual({ recovery: false, expired: false });
  expect(detectRecoveryFromHash('#section=1')).toEqual({ recovery: false, expired: false });
  expect(detectRecoveryFromHash(null)).toEqual({ recovery: false, expired: false });
  expect(detectRecoveryFromHash(undefined)).toEqual({ recovery: false, expired: false });
});

test('시나리오3: type=signup/magiclink 등 recovery 아닌 auth 토큰 → recovery 아님(재설정 폼 오노출 방지)', () => {
  const signup = '#access_token=a.b.c&type=signup';
  expect(detectRecoveryFromHash(signup).recovery).toBe(false);
  const magiclink = '#access_token=a.b.c&type=magiclink';
  expect(detectRecoveryFromHash(magiclink).recovery).toBe(false);
});
