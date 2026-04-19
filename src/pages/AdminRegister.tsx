import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getSelectedClinic } from '@/lib/clinic';
import AdminLayout from '@/components/AdminLayout';

const ROLES = [
  { value: 'admin', label: '관리자' },
  { value: 'manager', label: '상담실장' },
  { value: 'coordinator', label: '코디네이터' },
  { value: 'tm', label: 'TM (전화예약)' },
  { value: 'viewer', label: '뷰어 (읽기전용)' },
];

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  approved: boolean;
  created_at: string;
}

export default function AdminRegister() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('coordinator');
  const [submitting, setSubmitting] = useState(false);

  // User list
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }

      const clinic = await getSelectedClinic();
      if (clinic) { setClinicId(clinic.id); setClinicName(clinic.name); }

      // Check if current user is admin
      const { data: profile } = await (supabase.from('user_profiles') as any)
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || profile.role !== 'admin') {
        toast({ title: '접근 권한 없음', description: '관리자만 접근 가능합니다', variant: 'destructive' });
        navigate('/admin/dashboard');
        return;
      }

      setIsAdmin(true);
      setLoading(false);
      fetchUsers();
    };
    init();
  }, [navigate, toast]);

  const fetchUsers = async () => {
    const { data } = await (supabase.from('user_profiles') as any)
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setUsers(data as UserProfile[]);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password || password.length < 6) return;
    setSubmitting(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role } },
    });

    if (signUpError) {
      toast({ title: '등록 실패', description: signUpError.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    // Admin-created accounts are auto-approved
    if (data.user) {
      await (supabase.from('user_profiles') as any).insert({
        id: data.user.id,
        email,
        name: name.trim(),
        role,
        clinic_id: clinicId || null,
        active: true,
        approved: true,
      });
    }

    toast({ title: '직원 등록 완료', description: `${name} (${role})` });
    setEmail(''); setPassword(''); setName(''); setRole('coordinator');
    setSubmitting(false);
    fetchUsers();
  };

  const approveUser = async (user: UserProfile) => {
    await (supabase.from('user_profiles') as any)
      .update({ approved: true })
      .eq('id', user.id);
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, approved: true } : u));
    toast({ title: '승인 완료', description: user.name });
  };

  const rejectUser = async (user: UserProfile) => {
    if (!window.confirm(`${user.name} 계정을 거부하시겠습니까? (삭제됨)`)) return;
    await (supabase.from('user_profiles') as any).delete().eq('id', user.id);
    setUsers(prev => prev.filter(u => u.id !== user.id));
    toast({ title: '거부됨', description: user.name });
  };

  const toggleActive = async (user: UserProfile) => {
    await (supabase.from('user_profiles') as any)
      .update({ active: !user.active })
      .eq('id', user.id);
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !u.active } : u));
    toast({ title: user.active ? '비활성화' : '활성화', description: user.name });
  };

  const updateRole = async (userId: string, newRole: string) => {
    await (supabase.from('user_profiles') as any)
      .update({ role: newRole })
      .eq('id', userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    toast({ title: '역할 변경 완료' });
  };

  if (loading) return null;
  if (!isAdmin) return null;

  const pendingUsers = users.filter(u => !u.approved);
  const approvedUsers = users.filter(u => u.approved);

  return (
    <AdminLayout clinicName={clinicName} activeTab="staff">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        {/* Pending Approvals */}
        {pendingUsers.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
            <h2 className="text-lg font-bold mb-4 text-yellow-800">승인 대기 ({pendingUsers.length})</h2>
            <div className="space-y-2">
              {pendingUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-white border border-yellow-200">
                  <div>
                    <span className="font-medium">{u.name}</span>
                    <span className="text-sm text-muted-foreground ml-2">{u.email}</span>
                    <span className="text-xs text-yellow-600 ml-2">({ROLES.find(r => r.value === u.role)?.label || u.role})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => approveUser(u)} className="bg-green-600 text-white hover:bg-green-700 h-8 text-xs">
                      승인
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => rejectUser(u)} className="text-red-600 border-red-200 hover:bg-red-50 h-8 text-xs">
                      거부
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Register Form */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-bold mb-4">직원 계정 등록</h2>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">이름</label>
                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="홍길동" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">이메일</label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="name@clinic.com" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">비밀번호</label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="6자 이상" minLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">역할</label>
                <select value={role} onChange={e => setRole(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={submitting} className="bg-accent text-accent-foreground">
              {submitting ? '등록 중...' : '등록 (즉시 승인)'}
            </Button>
          </form>
        </div>

        {/* Approved User List */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-bold mb-4">승인된 계정 ({approvedUsers.length})</h2>
          <div className="space-y-2">
            {approvedUsers.map(u => (
              <div key={u.id} className={`flex items-center justify-between px-4 py-3 rounded-lg border ${u.active ? 'border-border' : 'border-border bg-muted/50 opacity-60'}`}>
                <div>
                  <span className="font-medium">{u.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">{u.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(u)} className="text-xs h-8">
                    {u.active ? '비활성화' : '활성화'}
                  </Button>
                </div>
              </div>
            ))}
            {approvedUsers.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">등록된 계정이 없습니다</p>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
