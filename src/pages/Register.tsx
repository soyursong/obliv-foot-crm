import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserRole } from '@/lib/types';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'consultant', label: '상담실장' },
  { value: 'coordinator', label: '코디' },
  { value: 'therapist', label: '관리사' },
  { value: 'technician', label: '치료사' },
  { value: 'manager', label: '매니저' },
];

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('coordinator');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      const clinic = await getClinic().catch(() => null);
      const { error: profileError } = await supabase.from('user_profiles').insert({
        id: data.user.id,
        email,
        name,
        role,
        clinic_id: clinic?.id ?? null,
        approved: false,
      });
      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    setSuccess(true);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold text-teal-700">등록 완료</h1>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            관리자 승인 후 로그인하실 수 있습니다.
          </div>
          <Button variant="outline" onClick={() => navigate('/login')} className="w-full">
            로그인으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-teal-700">직원 등록</h1>
          <p className="mt-1 text-sm text-muted-foreground">오블리브 풋센터 CRM</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-background p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="reg-name">이름</Label>
            <Input
              id="reg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-11"
              placeholder="홍길동"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-email">이메일</Label>
            <Input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">비밀번호</Label>
            <Input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11"
              placeholder="6자 이상"
            />
          </div>
          <div className="space-y-1.5">
            <Label>직책</Label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`h-10 rounded-md border text-sm font-medium transition ${
                    role === r.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input bg-background hover:bg-muted'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading || !name.trim() || !email.trim() || !password} className="h-11 w-full">
            {loading ? '등록 중...' : '등록'}
          </Button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            이미 계정이 있으신가요? 로그인
          </button>
        </form>
      </div>
    </div>
  );
}
