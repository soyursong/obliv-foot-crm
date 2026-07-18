import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserRole } from '@/lib/types';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'consultant', label: '상담실장' },
  { value: 'coordinator', label: '코디' },
  { value: 'therapist', label: '관리사' },
  { value: 'technician', label: '치료사' },
  // T-20260610-foot-STAFF-ROLE-TM-ADD AC1/AC5: 자기등록(회원가입) 직책에 'TM' 추가.
  // user_profiles.role CHECK 가 이미 'tm' 허용(20260513000040_contract_align_roles.sql) → 마이그레이션 불요.
  { value: 'tm', label: 'TM' },
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

    // [T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX / women 동형 승계, adopted=B]
    //   프로필 최초생성은 auth.users 표준 트리거(on_auth_user_created → public.handle_new_user())가
    //   signUp 트랜잭션 내에서 NEW.id 로 직접 수행한다(approved=false 서버강제, role=자기신고 화이트리스트,
    //   clinic_id=jongno-foot 서버파생). FE 직접 INSERT 는 제거 — signUp 직후 아직 anon 세션이라
    //   GRANT(6/29 PII lockdown)/RLS(0515 authenticated-only) 이중차단으로 실패했음.
    //   name/role 은 options.data(raw_user_meta_data)로 전달되어 트리거가 반영한다.
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
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
