import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, Shield, UserPlus, UserX } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
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
import type { Staff, UserProfile, UserRole } from '@/lib/types';
import { USER_ROLE_LABEL as ROLE_LABEL } from '@/lib/status';

// admin 세션 유지를 위해 persistSession:false 로 별도 client 사용 (signUp 이 현재 세션을 덮어쓰지 않도록)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const signupClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ROLES: UserRole[] = ['admin', 'manager', 'part_lead', 'consultant', 'coordinator', 'therapist', 'technician', 'tm', 'staff'];

// 임상직(staff 테이블 매핑 대상)
const CLINICAL_ROLES: UserRole[] = ['consultant', 'coordinator', 'therapist', 'technician'];

// 임시 비번 자동 생성 (영문대소+숫자+특수, 10자)
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digit = '23456789';
  const sym = '!@#$%';
  const all = upper + lower + digit + sym;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digit[Math.floor(Math.random() * digit.length)];
  pw += sym[Math.floor(Math.random() * sym.length)];
  for (let i = 0; i < 6; i++) pw += all[Math.floor(Math.random() * all.length)];
  // shuffle
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

export default function Accounts() {
  const clinic = useClinic();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
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
  const [inviteStaffId, setInviteStaffId] = useState<string>(''); // '' = auto/none
  const [inviteBusy, setInviteBusy] = useState(false);

  // 비번 리셋 모달
  const [resetUser, setResetUser] = useState<UserProfile | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null); // 성공 시 1회 노출

  const fetchUsers = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const [usersResp, staffResp] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .eq('clinic_id', clinic.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('staff')
        .select('*')
        .eq('clinic_id', clinic.id)
        .order('name', { ascending: true }),
    ]);
    if (usersResp.error) {
      toast.error('계정 목록 로딩 실패');
    } else {
      setUsers((usersResp.data ?? []) as UserProfile[]);
    }
    if (!staffResp.error) {
      setStaffList((staffResp.data ?? []) as Staff[]);
    }
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
    if (!next && !window.confirm(`${u.name ?? u.email}을(를) ${action}하시겠습니까? (staff 활성도 동기화됩니다)`)) return;
    const { error } = await supabase.rpc('admin_toggle_user_active', {
      target_user_id: u.id,
      set_active: next,
    });
    if (error) { toast.error(`${action} 실패: ${error.message}`); return; }
    toast.success(`${action}됨`);
    fetchUsers();
  };

  const openEdit = (u: UserProfile) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditName(u.name ?? '');
  };

  const openReset = (u: UserProfile) => {
    setResetUser(u);
    setResetPw('');
    setResetResult(null);
  };

  const submitReset = async () => {
    if (!resetUser) return;
    const pw = resetPw.trim();
    if (pw.length < 6) { toast.error('비밀번호 6자 이상'); return; }
    setResetBusy(true);
    const { error } = await supabase.rpc('admin_reset_user_password', {
      target_user_id: resetUser.id,
      new_password: pw,
    });
    setResetBusy(false);
    if (error) { toast.error(`초기화 실패: ${error.message}`); return; }
    setResetResult(pw);
    toast.success('비밀번호 초기화 완료');
  };

  const closeReset = () => {
    setResetUser(null);
    setResetPw('');
    setResetResult(null);
  };

  const copyResetPw = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult);
      toast.success('복사됨');
    } catch {
      toast.error('복사 실패 — 직접 선택해 복사하세요');
    }
  };

  const inviteStaff = async () => {
    if (!clinic) { toast.error('clinic 정보 없음'); return; }
    const email = inviteEmail.trim().toLowerCase();
    const pw = invitePw.trim();
    const name = inviteName.trim();
    if (!email || !pw) { toast.error('이메일과 비밀번호를 입력하세요'); return; }
    if (pw.length < 8) { toast.error('비밀번호는 8자 이상'); return; }
    if (!name) { toast.error('이름을 입력하세요'); return; }

    setInviteBusy(true);
    // 1) auth.users 생성 (admin 세션 유지를 위해 별도 client 로 signUp)
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

    // 2) user_profiles 등록 + staff 매핑/생성 (RPC 트랜잭션)
    const { error: rpcErr } = await supabase.rpc('admin_register_user', {
      target_user_id: data.user.id,
      email,
      name,
      role: inviteRole,
      approved: true,
      staff_id: inviteStaffId || null,
    });
    setInviteBusy(false);
    if (rpcErr) { toast.error(`프로필/staff 매핑 실패: ${rpcErr.message}`); return; }
    toast.success(`${email} 등록 완료 (즉시 승인)`);
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePw('');
    setInviteName('');
    setInviteRole('staff');
    setInviteStaffId('');
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

  // 등록 모달: 임상직일 때 매핑 가능한 staff (user_id NULL + active)
  const availableStaff = useMemo(() => {
    if (!CLINICAL_ROLES.includes(inviteRole)) return [];
    return staffList.filter((s) => !s.user_id && s.active && s.role === inviteRole);
  }, [staffList, inviteRole]);

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
                            title="비밀번호 초기화"
                            onClick={() => openReset(u)}
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
                <div className="flex items-center justify-between">
                  <Label>임시 비밀번호 (8자 이상)</Label>
                  <button
                    type="button"
                    className="text-xs text-teal-700 hover:underline"
                    onClick={() => setInvitePw(generateTempPassword())}
                  >
                    자동 생성
                  </button>
                </div>
                <Input
                  type="text"
                  value={invitePw}
                  onChange={(e) => setInvitePw(e.target.value)}
                  placeholder="직원이 로그인 후 변경"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>이름</Label>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>역할</Label>
                <div className="grid grid-cols-4 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => { setInviteRole(r); setInviteStaffId(''); }}
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
              {CLINICAL_ROLES.includes(inviteRole) && (
                <div className="space-y-1.5">
                  <Label>staff 매핑 (선택)</Label>
                  <select
                    value={inviteStaffId}
                    onChange={(e) => setInviteStaffId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">자동 매칭 (없으면 신규 staff 생성)</option>
                    {availableStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.role}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    임상직(상담/코디/치료/관리)은 staff 테이블과 연결됩니다. 미선택 시 동명·동역할 staff에 자동 매칭, 없으면 새 staff row를 생성합니다.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                관리자가 직접 생성한 계정은 즉시 승인됩니다. 직원은 설정된 비밀번호로 로그인 후 변경하세요.
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

      {resetUser && (
        <Dialog open onOpenChange={(o) => !o && !resetBusy && closeReset()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>비밀번호 초기화 · {resetUser.name ?? resetUser.email}</DialogTitle>
            </DialogHeader>
            {!resetResult ? (
              <>
                <div className="space-y-3">
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
                    설정한 비밀번호로 즉시 변경됩니다. 직원에게 안전한 채널로 전달 후 즉시 로그인 → 변경을 안내하세요.
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>새 비밀번호 (6자 이상)</Label>
                      <button
                        type="button"
                        className="text-xs text-teal-700 hover:underline"
                        onClick={() => setResetPw(generateTempPassword())}
                      >
                        자동 생성
                      </button>
                    </div>
                    <Input
                      type="text"
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                      placeholder="임시 비밀번호"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" disabled={resetBusy} onClick={closeReset}>
                    취소
                  </Button>
                  <Button disabled={resetBusy || resetPw.length < 6} onClick={submitReset}>
                    {resetBusy ? '초기화 중…' : '초기화'}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    초기화 완료. 아래 비밀번호를 직원에게 안전하게 전달하세요. <b>이 화면을 닫으면 다시 볼 수 없습니다.</b>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                    <code className="flex-1 select-all font-mono text-sm">{resetResult}</code>
                    <Button size="sm" variant="ghost" onClick={copyResetPw}>
                      <Copy className="mr-1 h-3.5 w-3.5" /> 복사
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={closeReset}>확인</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
