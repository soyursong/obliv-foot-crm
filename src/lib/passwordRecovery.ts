/**
 * passwordRecovery — 비밀번호 재설정(recovery) 딥링크 순수 로직 SSOT
 * T-20260729-foot-PWRESET-FE-RECOVERY-DEEPLINK-HANDLER
 *
 * 배경: Supabase recovery 메일 링크는 verify 후 site_url(redirect_to) 루트로 리다이렉트하며,
 *   URL hash 에 recovery 토큰(#access_token=...&type=recovery) 또는 만료/오류
 *   (#error=access_denied&error_code=otp_expired...) 를 담아 착지한다. supabase-js 는 hash 를
 *   파싱해 세션을 세팅하고 `PASSWORD_RECOVERY` 이벤트를 발화하지만, 이를 수신해 재설정 폼을
 *   렌더하는 화면/핸들러가 없어 루트(/admin)로 그대로 흡수되던 것이 원 defect.
 *
 * 이 모듈은 그 판정·검증 로직을 순수 함수로 분리해(브라우저 없이 단언 가능) drift 를 막는다.
 *   - detectRecoveryFromHash: 착지 hash 분류(recovery 토큰 / 만료·오류 / 무관)
 *   - validateNewPassword: 새 비밀번호 정책(ChangePasswordDialog 와 동일 SSOT)
 *   - classifyUpdateUserError: updateUser 실패 메시지 → 화면 분기(만료/동일/일반)
 */

export interface RecoveryHashClass {
  /** recovery 토큰이 담겨 재설정 폼을 렌더해야 하는 착지 */
  recovery: boolean;
  /** 만료·재사용·손상된 링크(오류 hash) → "다시 요청" 안내 화면 */
  expired: boolean;
}

/**
 * 착지 URL hash 를 분류한다. (window.location.hash 형태: "#a=b&c=d" 또는 "")
 * supabase-js 가 hash 를 소거하기 전, 모듈 로드 시점에 동기 캡처한 값을 넘겨 사용한다.
 */
export function detectRecoveryFromHash(hash: string | null | undefined): RecoveryHashClass {
  const h = (hash ?? '').replace(/^#/, '');
  if (!h) return { recovery: false, expired: false };
  const params = new URLSearchParams(h);
  const type = params.get('type');
  const err = params.get('error') ?? params.get('error_code') ?? params.get('error_description');

  // 오류 hash: 만료(otp_expired)·access_denied·손상 → 재요청 안내.
  //   recovery 링크 만료가 대표 사례지만, 착지 루트에서의 auth 오류 hash 는 일괄 재요청 유도로 처리.
  if (err) {
    return { recovery: false, expired: true };
  }
  // 정상 recovery 토큰 착지.
  if (type === 'recovery') {
    return { recovery: true, expired: false };
  }
  return { recovery: false, expired: false };
}

/**
 * 새 비밀번호 정책: 최소 8자 + 영문 1자 이상 + 숫자 1자 이상.
 * ChangePasswordDialog.validatePassword 와 동일 규칙(SSOT 정합) — 통과 시 null, 위반 시 안내문.
 */
export function validateNewPassword(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 최소 8자 이상이어야 합니다.';
  if (!/[a-zA-Z]/.test(pw)) return '영문자를 1자 이상 포함해야 합니다.';
  if (!/[0-9]/.test(pw)) return '숫자를 1자 이상 포함해야 합니다.';
  return null;
}

export type UpdateUserErrorClass = 'expired' | 'same' | 'generic';

/**
 * updateUser({ password }) 실패 메시지를 화면 분기용으로 분류한다.
 *   - expired: recovery 세션 만료/무효(JWT·session·token 소실) → 만료 안내 화면으로 전환(무한로딩/백지 금지)
 *   - same:    기존과 동일 비밀번호 거부 → 폼 유지 + 안내
 *   - generic: 그 외 → 폼 유지 + 원문 병기 재시도 안내
 */
export function classifyUpdateUserError(message: string | null | undefined): UpdateUserErrorClass {
  const m = (message ?? '').toLowerCase();
  if (
    m.includes('session') ||
    m.includes('jwt') ||
    m.includes('expired') ||
    m.includes('token') ||
    m.includes('auth session missing')
  ) {
    return 'expired';
  }
  if (m.includes('should be different') || m.includes('same as') || m.includes('same password')) {
    return 'same';
  }
  return 'generic';
}
