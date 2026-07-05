import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const navigate = useNavigate();
  const { refresh, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    if (authData.user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('approved, role')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profile && !profile.approved && profile.role !== 'admin') {
        // T-20260705-foot-LOGIN-SIGNOUT-DEADLOCK (AC-1) — women 20538d8a 완치법 이식:
        //   ★ raw supabase.auth.signOut() 직접 호출 금지 — women과 바이트-동일 데드락 기전.
        //     raw 호출은 explicitSignOutRef를 세팅하지 않아, AuthProvider(src/lib/auth.tsx)의
        //     SIGNED_OUT 핸들러가 콜백 내부에서 `await supabase.auth.refreshSession()`을 재호출 →
        //     supabase-js 내부 락 데드락 → signOut await 영구 hang → 후속 setError/setLoading 미실행 →
        //     미승인 사용자 로그인 거부 화면이 영구 정지(폼 재활성 실패).
        //   → wrapped signOut()(useAuth, explicitSignOutRef 경유로 refreshSession 디바운스 skip) 사용.
        //   ★ 이중 방어: 타임아웃 가드(Promise.race 2s)로 signOut 지연·실패와 무관하게 거부 UX 복귀 보장.
        try {
          await Promise.race([
            signOut(),
            new Promise<void>((resolve) => setTimeout(resolve, 2000)),
          ]);
        } catch {
          // signOut 실패해도 거부 결과는 확정 → 에러 안내·폼 재활성은 계속 진행.
        }
        setError('관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.');
        setLoading(false);
        return;
      }
    }
    await refresh();
    toast.success('로그인 되었습니다');
    navigate('/admin');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-teal-700">오블리브 풋센터</h1>
          <p className="mt-1 text-sm text-muted-foreground">종로점 CRM</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-background p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="h-11 w-full">
            {loading ? '로그인 중...' : '로그인'}
          </Button>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            계정이 없으신가요? 회원가입
          </button>
        </form>
      </div>
    </div>
  );
}
