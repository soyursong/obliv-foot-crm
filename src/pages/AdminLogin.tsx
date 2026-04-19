import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ROLES = [
  { value: 'tm', label: 'TM (전화예약)' },
  { value: 'coordinator', label: '코디네이터' },
  { value: 'consultant', label: '상담실장' },
  { value: 'technician', label: '시술자' },
];

export default function AdminLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Register state
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regRole, setRegRole] = useState('coordinator');
  const [regSuccess, setRegSuccess] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    // Check approval status
    if (authData.user) {
      const { data: profile } = await (supabase.from('user_profiles') as any)
        .select('approved, role')
        .eq('id', authData.user.id)
        .single();
      if (profile && !profile.approved && profile.role !== 'admin') {
        await supabase.auth.signOut();
        setError('관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.');
        setLoading(false);
        return;
      }
    }
    navigate('/admin/dashboard');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { data: { name: regName, role: regRole } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Insert user_profiles (approved=false, awaiting admin approval)
    if (data.user) {
      await (supabase.from('user_profiles') as any).insert({
        id: data.user.id,
        email: regEmail,
        name: regName,
        role: regRole,
        approved: false,
      });
    }

    setLoading(false);
    setRegSuccess(true);
  };

  if (mode === 'register') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">오블리브 Ose</h1>
            <p className="text-muted-foreground mt-1">직원 등록</p>
          </div>

          {regSuccess ? (
            <div className="text-center space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <p className="text-sm text-green-700 font-medium">등록 완료!</p>
                <p className="text-xs text-green-600 mt-1">관리자 승인 후 로그인할 수 있습니다.</p>
              </div>
              <Button variant="outline" onClick={() => { setMode('login'); setRegSuccess(false); }} className="w-full">
                로그인으로 돌아가기
              </Button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">이름 <span className="text-destructive">*</span></label>
                <Input value={regName} onChange={(e) => setRegName(e.target.value)} required className="h-12" placeholder="홍길동" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">이메일 <span className="text-destructive">*</span></label>
                <Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required className="h-12" placeholder="name@medibuilder.com" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">비밀번호 <span className="text-destructive">*</span></label>
                <Input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required className="h-12" placeholder="6자 이상" minLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">직책 <span className="text-destructive">*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map(r => (
                    <button key={r.value} type="button" onClick={() => setRegRole(r.value)}
                      className={`h-10 rounded-lg border text-sm font-medium transition-colors ${regRole === r.value ? 'border-accent bg-accent/10 text-accent' : 'border-input bg-background hover:bg-muted'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading || !regName.trim() || !regEmail.trim() || !regPassword} className="w-full h-12 bg-accent text-accent-foreground">
                {loading ? '등록 중...' : '등록하기'}
              </Button>
              <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-muted-foreground hover:text-foreground">
                이미 계정이 있으신가요? 로그인
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">오블리브 Ose</h1>
          <p className="text-muted-foreground mt-1">Staff Login</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-1.5">이메일</label>
            <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-foreground mb-1.5">비밀번호</label>
            <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90">
            {loading ? '...' : '로그인'}
          </Button>
          <button type="button" onClick={() => setMode('register')} className="w-full text-sm text-muted-foreground hover:text-foreground">
            회원가입
          </button>
        </form>
      </div>
    </div>
  );
}
