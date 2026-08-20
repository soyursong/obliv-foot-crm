/**
 * authRecoveryBus.ts — data-plane 인증오류(401) → 재로그인 유도 경량 pub/sub (순수 코어)
 *
 * 티켓: T-20260820-foot-CONSULT-READ-SILENT401-BANNER-RELOGIN-FIX
 *
 * refresh401Bus(재시도 "진행중" transient 신호) 와 역할이 겹치지 않는다:
 *   · refresh401Bus  = "자동 재시도 중" (해소되면 조용히 사라짐, 사용자 조치 불요).
 *   · authRecoveryBus = "재인증 필요" (만료/anon 401 → 자동복구 실패 시 **사용자 재로그인 필요**).
 *
 * 상태 모델:
 *   - needsReauth: data-plane read 가 인증오류(isAuthReadError)로 실패했고 아직 미해소.
 *     AuthErrorBanner 가 구독 → 우선 silent refreshSession 시도(훅), 실패 시 재로그인 배너 노출.
 *
 * 무패키지(모듈 스코프 리스너 집합 + 불변 스냅샷). React 의존 없음.
 */

/** 재인증(refreshSession) 성공 시 페이지가 데이터를 재조회하도록 알리는 전역 window 이벤트명. */
export const AUTH_RECOVERED_EVENT = 'foot:auth-recovered';

export interface AuthRecoveryState {
  /** data-plane read 인증오류 감지·미해소 상태. */
  needsReauth: boolean;
}

let state: AuthRecoveryState = { needsReauth: false };
const listeners = new Set<(s: AuthRecoveryState) => void>();

function emit(): void {
  const snapshot: AuthRecoveryState = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* 구독자 예외 격리 */
    }
  });
}

export function getAuthRecoveryState(): AuthRecoveryState {
  return { ...state };
}

export function subscribeAuthRecovery(fn: (s: AuthRecoveryState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * data-plane read 인증오류 보고 — load() 등에서 isAuthReadError 판정 시 호출.
 * 명단 blank 는 호출측이 (setter 스킵으로) 막고, 이 함수는 재인증 UX 만 트리거한다.
 */
export function reportAuthReadError(): void {
  if (state.needsReauth) return; // 중복 억제(배너 flicker 방지)
  state = { needsReauth: true };
  emit();
}

/** 재인증 해소(refreshSession 성공 또는 재로그인 완료) — 배너 소멸. */
export function clearAuthReadError(): void {
  if (!state.needsReauth) return;
  state = { needsReauth: false };
  emit();
}

/** 테스트/디버그용 리셋. 프로덕션 경로 미사용. */
export function __resetAuthRecoveryBus(): void {
  state = { needsReauth: false };
  emit();
}
