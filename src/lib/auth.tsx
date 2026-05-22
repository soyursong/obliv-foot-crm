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
      // T-20260522-foot-SSN-SESSION-KILL: SIGNED_OUT 디바운스 복구 로직 (v1)
      // T-20260522-foot-CUST-REG-LOGOUT: 150ms 단순 대기 → refreshSession() 적극 복구로 교체 (v2)
      //
      // 문제: rrn_encrypt RPC 호출 시 JWT 만료 → PostgREST 401 반환 →
      //       SDK 내부 토큰 갱신 실패 → SIGNED_OUT 즉시 발화 → 세션 소실
      //
      // v1 한계: 150ms 고정 대기는 SDK refresh가 150ms 이상 걸리거나
      //          네트워크 순단으로 refresh 자체가 실패하면 여전히 로그아웃.
      //
      // v2 수정: SIGNED_OUT 수신 시 refreshSession() 직접 재시도.
      //   ① refreshSession() 성공 → 세션 복구, 로그아웃 없음.
      //   ② refreshSession() 실패 (refresh token 만료 등) → 100ms 대기 후
      //      getSession()으로 다른 탭 갱신 결과 확인. 그래도 null이면 정상 로그아웃.
      //
      // 명시적 signOut()은 explicitSignOutRef.current=true로 이 블록 건너뜀.
      if (_event === 'SIGNED_OUT' && !explicitSignOutRef.current) {
        try {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData.session) {
            setSession(refreshData.session);
            void loadProfile(refreshData.session);
            return;
          }
        } catch {
          // refreshSession 예외 무시 — getSession() fallback으로 진행
        }
        // refresh 실패 시: 100ms 대기 후 다른 탭 갱신 결과 확인
        await new Promise((r) => setTimeout(r, 100));
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
