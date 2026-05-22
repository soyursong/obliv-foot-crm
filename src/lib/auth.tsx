import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserProfile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: UserProfile | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<UserProfile | null>(null);

  // T-20260522-foot-SSN-SESSION-KILL: 명시적 로그아웃 중 플래그
  // SIGNED_OUT이 명시적 signOut()에서 온 것인지, SDK 내부 토큰 갱신 실패에서 온 것인지 구분
  const explicitSignOutRef = React.useRef(false);

  const loadProfile = React.useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', s.user.id)
        .maybeSingle();
      setProfile((data as UserProfile) ?? null);
    } catch {
      // 네트워크 오류 등으로 프로필 조회 실패 시 null 처리 — 로딩 블록 방지
      setProfile(null);
    }
  }, []);

  const refresh = React.useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session);
  }, [loadProfile]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        await loadProfile(data.session);
      } finally {
        // try/finally 보장: loadProfile 예외 발생해도 loading 해제
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      // T-20260522-foot-SSN-SESSION-KILL: SIGNED_OUT 디바운스 복구 로직
      //
      // 문제: rrn_encrypt RPC 호출 시 JWT 만료 → PostgREST 401 반환 →
      //       SDK 내부 토큰 갱신 실패 → SIGNED_OUT 즉시 발화 → 세션 소실
      //
      // 수정: 명시적 signOut()이 아닌 SIGNED_OUT 이벤트는 150ms 후 재확인.
      //       토큰 갱신 race condition(다른 탭 or 백그라운드 갱신 완료)을 허용.
      //       150ms 후에도 세션이 없으면 정상적으로 로그아웃 처리.
      if (_event === 'SIGNED_OUT' && !explicitSignOutRef.current) {
        await new Promise((r) => setTimeout(r, 150));
        const { data } = await supabase.auth.getSession();
        const recoveredSession = data.session ?? null;
        setSession(recoveredSession);
        void loadProfile(recoveredSession);
        return;
      }
      setSession(s);
      void loadProfile(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = React.useCallback(async () => {
    // T-20260522-foot-SSN-SESSION-KILL: 명시적 로그아웃 플래그 설정
    // 이 플래그가 있으면 onAuthStateChange의 SIGNED_OUT 디바운스를 건너뜀
    explicitSignOutRef.current = true;
    try {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
    } finally {
      explicitSignOutRef.current = false;
    }
  }, []);

  const value: AuthState = { loading, session, profile, refresh, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
