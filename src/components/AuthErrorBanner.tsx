/**
 * AuthErrorBanner.tsx — data-plane 인증오류(401) 재로그인 유도 배너 (ticket (a)/(b))
 *
 * 티켓: T-20260820-foot-CONSULT-READ-SILENT401-BANNER-RELOGIN-FIX
 * 부모 RC: 31fb4f5b (角3 세션/토큰 만료 → read silent 401 → 배너없이 명단 empty)
 *
 * 역할(Refresh401Banner 와 분리 — dedup):
 *   · Refresh401Banner  = "자동 재시도 중"(transient, 조치 불요, teal/amber 진행 배너).
 *   · AuthErrorBanner    = "세션 만료 → 재인증 필요". 아래 순서로 동작:
 *       (b) needsReauth 감지 시 **우선 silent refreshSession() 1회 시도**(refresh401 인프라의
 *           expired/anon non-target 갭 봉합 훅). 성공 → `foot:auth-recovered` 이벤트로 재조회
 *           트리거 + 배너 소멸(사용자 무중단).
 *       (a) refreshSession 실패(리프레시 토큰까지 사망: 장기 idle·revoke·비번변경) → **재로그인
 *           배너 노출 + [다시 로그인] 버튼**. 클릭 시 signOut() → 로그인 화면.
 *
 * 규약: 차단 모달 금지(현장 업무 정지 방지) — 상단 고정 배너. teal 테마(풋 per-CRM).
 */
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import {
  AUTH_RECOVERED_EVENT,
  clearAuthReadError,
  getAuthRecoveryState,
  subscribeAuthRecovery,
} from '@/lib/resilience/authRecoveryBus';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

function useNeedsReauth(): boolean {
  return useSyncExternalStore(
    subscribeAuthRecovery,
    () => getAuthRecoveryState().needsReauth,
    () => getAuthRecoveryState().needsReauth,
  );
}

export default function AuthErrorBanner() {
  const needsReauth = useNeedsReauth();
  const { signOut } = useAuth();
  // 'idle' | 'recovering'(silent refresh 시도중) | 'relogin'(자동복구 실패 → 사용자 조치 필요)
  const [phase, setPhase] = React.useState<'idle' | 'recovering' | 'relogin'>('idle');
  const attemptingRef = React.useRef(false);

  React.useEffect(() => {
    if (!needsReauth) {
      // 해소됨 → 로컬 상태 초기화(다음 오류 대비).
      setPhase('idle');
      attemptingRef.current = false;
      return;
    }
    if (attemptingRef.current) return; // 재진입 방지(1회만 자동복구 시도)
    attemptingRef.current = true;
    setPhase('recovering');

    let cancelled = false;
    (async () => {
      try {
        // (b) 자동복구 훅 — access 토큰 만료라도 refresh 토큰이 살아있으면 여기서 새 세션 발급.
        const { data, error } = await supabase.auth.refreshSession();
        if (cancelled) return;
        if (data?.session && !error) {
          // 복구 성공 → 배너 소멸 + 페이지 재조회 트리거(명단 자동 복원, 사용자 무중단).
          clearAuthReadError();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(AUTH_RECOVERED_EVENT));
          }
          return;
        }
      } catch {
        /* refreshSession 예외 → 재로그인 경로로 낙하 */
      }
      if (!cancelled) setPhase('relogin'); // (a) 자동복구 실패 → 사용자 재로그인 유도
    })();

    return () => {
      cancelled = true;
    };
  }, [needsReauth]);

  if (!needsReauth || phase === 'idle') return null;

  const recovering = phase === 'recovering';

  return (
    <div
      data-testid="auth-error-banner"
      data-phase={phase}
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[220] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-center gap-3 rounded-lg border border-teal-300 bg-teal-50 px-4 py-3 text-teal-900 shadow-lg"
    >
      {recovering ? (
        <>
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal-400 border-t-transparent"
          />
          <span className="text-sm font-medium leading-snug">
            로그인 상태를 확인하는 중입니다…
          </span>
        </>
      ) : (
        <>
          <span className="text-sm font-medium leading-snug">
            로그인이 만료되었습니다. 새로고침으로는 복구되지 않으니 다시 로그인해 주세요.
          </span>
          <button
            type="button"
            data-testid="auth-error-relogin-btn"
            onClick={() => void signOut()}
            className="shrink-0 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
          >
            다시 로그인
          </button>
        </>
      )}
    </div>
  );
}
