import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Check, KeyRound, Shield, UserPlus, UserX } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { Clinic, UserProfile, UserRole } from '@/lib/types';

// admin 세션 유지를 위해 persistSession:false 로 별도 client 사용 (signUp 이 현재 세션을 덮어쓰지 않도록)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const signupClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '관리자',
  manager: '매니저',
  consultant: '상담실장',
  coordinator: '코디네이터',
  therapist: '치료사',
  technician: '관리사',
  tm: 'TM',
  staff: '스태프',
};

const ROLES: UserRole[] = ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'technician', 'tm', 'staff'];

export default function Accounts() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('staff');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePw, setInvitePw] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('staff');
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('계정 목록 로딩 실패');
      setLoading(false);
      return;
    }
    setUsers((data ?? []) as UserProfile[]);
    setLoading(false);
  }, [clinic]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const toggleApproval = async (u: UserProfile) => {
    const next = !u.approved;
    if (!next && !window.confirm(`${u.name ?? u.email}의 승인을 취소하시겠습니까?`)) return;
    const { error } = await supabase
      .from('user_profiles')
      .update({ approved: next })
      .eq('id', u.id);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? '승인됨' : '승인 취소됨');
    fetchUsers();
  };

  const toggleActive = async (u: UserProfile) => {
    const next = !u.active;
    const action = next ? '활성화' : '비활성화';
    if (!next && !window.confirm(`${u.name ?? u.email}을(를) ${action}하시겠습니까?`)) return;
    const { error } = await supabase
      .from('user_profiles')
      .update({ active: next })
      .eq('id', u.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${action}됨`);
    fetchUsers();
  };

  const openEdit = (u: UserProfile) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditName(u.name ?? '');
  };

  const sendPasswordReset = async (u: UserProfile) => {
    if (!u.email) { toast.error('이메일이 없습니다'); return; }
    if (!window.confirm(`${u.email} 으로 비밀번호 재설정 메일을 보냅니다.`)) return;
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) { toast.error(`메일 전송 실패: ${error.message}`); return; }
    toast.success('재설정 메일 전송됨');
  };

  const inviteStaff = async () => {
    if (!clinic) { toast.error('clinic 정보 없음'); return; }
    const email = inviteEmail.trim().toLowerCase();
    const pw = invitePw.trim();
    const name = inviteName.trim();
    if (!email || !pw) { toast.error('이메일과 비밀번호를 입력하세요'); return; }
    if (pw.length < 8) { toast.error('비밀번호는 8자 이상'); return; }

    setInviteBusy(true);
    // admin 세션 유지를 위해 별도 client 로 signUp
    const { data, error } = await signupClient.auth.signUp({
      email,
      password: pw,
      options: { data: { name } },
    });
    if (error || !data.user) {
      setInviteBusy(false);
      toast.error(`계정 생성 실패: ${error?.message ?? 'unknown'}`);
      return;
    }
    // profile 업데이트 (trigger 가 profile row 생성. 즉시 승인/역할/clinic 지정)
    const { error: upErr } = await supabase
      .from('user_profiles')
      .upsert({
        id: data.user.id,
        email,
        name: name || null,
        role: inviteRole,
        clinic_id: clinic.id,
        approved: true,
        active: true,
      }, { onConflict: 'id' });
    setInviteBusy(false);
    if (upErr) { toast.error(`프로필 설정 실패: ${upErr.message}`); return; }
    toast.success(`${email} 등록 완료 (즉시 승인)`);
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePw('');
    setInviteName('');
    setInviteRole('staff');
    fetchUsers();
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setSaving(true);
    const { error } = await supabase
      .from('user_profiles')
      .update({ role: editRole, name: editName.trim() || null })
      .eq('id', editUser.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('수정됨');
    setEditUser(null);
    fetchUsers();
  };

  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved && u.active);
  const inactive = users.filter((u) => u.approved && !u.active);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">계정 관리</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{users.length}명</span>
          <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1">
            <UserPlus className="h-3.5 w-3.5" /> 직원 등록
          </Button>
        </div>
      </div>

      {pending.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-700">
              <Shield className="h-4 w-4" />
              승인 대기 ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pending.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">{u.name ?? '(이름 없음)'}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleApproval(u)}>
                      <Check className="mr-1 h-3.5 w-3.5" /> 승인
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">활성 계정 ({active.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">로딩 중…</div>
          ) : active.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">계정 없음</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">이름</th>
                    <th className="pb-2 font-medium">이메일</th>
                    <th className="pb-2 font-medium">역할</th>
                    <th className="pb-2 font-medium text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{u.name ?? '—'}</td>
                      <td className="py-2 text-muted-foreground">{u.email}</td>
                      <td className="py-2">
                        <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                            수정
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="비밀번호 재설정 메일 전송"
                            onClick={() => sendPasswordReset(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => toggleActive(u)}>
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {inactive.length > 0 && (
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">비활성 계정 ({inactive.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactive.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">{u.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.email} · {ROLE_LABEL[u.role]}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(u)}>
                    재활성화
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {inviteOpen && (
        <Dialog open onOpenChange={(o) => !o && !inviteBusy && setInviteOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>직원 계정 등록</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>이메일</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="staff@example.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>임시 비밀번호 (8자 이상)</Label>
                <Input
                  type="text"
                  value={invitePw}
                  onChange={(e) => setInvitePw(e.target.value)}
                  placeholder="직원이 로그인 후 변경"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>이름 (선택)</Label>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>역할</Label>
                <div className="grid grid-cols-4 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setInviteRole(r)}
                      className={`h-9 rounded-md border text-xs font-medium transition ${
                        inviteRole === r
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-input hover:bg-muted'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                관리자가 직접 생성한 계정은 즉시 승인 처리됩니다. 직원은 설정된 비밀번호로 로그인 후 변경하세요.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={inviteBusy} onClick={() => setInviteOpen(false)}>
                취소
              </Button>
              <Button disabled={inviteBusy} onClick={inviteStaff}>
                {inviteBusy ? '등록 중…' : '등록'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editUser && (
        <Dialog open onOpenChange={(o) => !o && setEditUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>계정 수정 · {editUser.name ?? editUser.email}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>이름</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>역할</Label>
                <div className="grid grid-cols-4 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setEditRole(r)}
                      className={`h-9 rounded-md border text-xs font-medium transition ${
                        editRole === r
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-input hover:bg-muted'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>이메일</Label>
                <Input value={editUser.email ?? ''} disabled className="bg-muted" />
              </div>
              <div className="flex items-center gap-2">
                <Label>승인 상태</Label>
                <Badge variant={editUser.approved ? 'teal' : 'destructive'}>
                  {editUser.approved ? '승인됨' : '미승인'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { toggleApproval(editUser); setEditUser(null); }}
                >
                  {editUser.approved ? '승인 취소' : '승인'}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditUser(null)}>
                취소
              </Button>
              <Button disabled={saving} onClick={saveEdit}>
                {saving ? '저장 중…' : '저장'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
