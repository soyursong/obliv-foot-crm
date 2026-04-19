import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getSelectedClinic } from '@/lib/clinic';
import { format, addDays, subDays, startOfWeek, endOfWeek, eachDayOfInterval, startOfMonth, endOfMonth, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';

interface Staff { id: string; name: string; role: string; active: boolean; }
interface RoomAssignment { id: string; room_type: string; room_number: number; staff_id: string; work_date: string; }
interface StaffRevenue { staff_id: string; total: number; count: number; }
interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  clinic_id: string | null;
  clinic_name: string | null;
  active: boolean | null;
  approved: boolean | null;
  created_at: string;
}
interface ClinicOption { id: string; name: string; }

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

// 계정 관리 role 탭 · 라벨
const ACCOUNT_ROLE_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'admin', label: '관리자' },
  { key: 'manager', label: '상담실장' },
  { key: 'technician', label: '시술자' },
  { key: 'tm', label: 'TM' },
  { key: 'consultant', label: '상담사' },
];
const ROLE_LABEL: Record<string, string> = {
  admin: '관리자',
  manager: '상담실장',
  technician: '시술자',
  tm: 'TM',
  consultant: '상담사',
};
const ROLE_OPTIONS = ['admin', 'manager', 'technician', 'tm', 'consultant'];

export default function AdminStaff() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [treatmentRooms, setTreatmentRooms] = useState(15);
  const [consultationRooms, setConsultationRooms] = useState(3);
  const [staffList, setStaffList] = useState<Staff[]>([]);

  // Schedule view
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [consultAssignments, setConsultAssignments] = useState<RoomAssignment[]>([]);

  // Revenue view
  const [revenueMonth, setRevenueMonth] = useState(() => new Date());
  const [staffRevenues, setStaffRevenues] = useState<StaffRevenue[]>([]);
  const [consultantRevenues, setConsultantRevenues] = useState<StaffRevenue[]>([]);

  // Modals
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('technician');
  const [assignModal, setAssignModal] = useState<{ room: number; date: string; type: 'treatment' | 'consultation' } | null>(null);
  const [editStaff, setEditStaff] = useState<Staff | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffRole, setEditStaffRole] = useState('');

  // 계정 관리 (Q-8 대응, 2026-04-11)
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [clinicOptions, setClinicOptions] = useState<ClinicOption[]>([]);
  const [editAccount, setEditAccount] = useState<UserAccount | null>(null);
  const [editAccountName, setEditAccountName] = useState('');
  const [editAccountRole, setEditAccountRole] = useState('');
  const [editAccountClinicId, setEditAccountClinicId] = useState<string>('');
  const [editAccountApproved, setEditAccountApproved] = useState(true);
  const [editAccountActive, setEditAccountActive] = useState(true);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwValue, setResetPwValue] = useState('qweiop1!');

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  const fetchStaff = useCallback(async (cId: string) => {
    const { data } = await supabase.from('staff').select('*').eq('clinic_id', cId).order('name');
    if (data) setStaffList(data as Staff[]);
  }, []);

  // 계정 관리용 fetch
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const { data, error } = await (supabase as any).rpc('admin_list_user_profiles');
    if (error) {
      toast({ title: '계정 조회 실패', description: error.message, variant: 'destructive' });
      setAccounts([]);
    } else if (data) {
      setAccounts(data as UserAccount[]);
    }
    setAccountsLoading(false);
  }, [toast]);

  const fetchClinicOptions = useCallback(async () => {
    const { data } = await supabase.from('clinics').select('id, name').order('name');
    if (data) setClinicOptions(data as ClinicOption[]);
  }, []);

  const fetchAssignments = useCallback(async (cId: string, start: Date, end: Date) => {
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    const { data } = await supabase.from('room_assignments')
      .select('*').eq('clinic_id', cId).eq('room_type', 'treatment')
      .gte('work_date', startStr).lte('work_date', endStr);
    if (data) setAssignments(data as RoomAssignment[]);
    const { data: cData } = await supabase.from('room_assignments')
      .select('*').eq('clinic_id', cId).eq('room_type', 'consultation')
      .gte('work_date', startStr).lte('work_date', endStr);
    if (cData) setConsultAssignments(cData as RoomAssignment[]);
  }, []);

  const fetchRevenue = useCallback(async (cId: string, month: Date) => {
    const mStart = format(startOfMonth(month), 'yyyy-MM-dd');
    const mEnd = format(endOfMonth(month), 'yyyy-MM-dd');

    // Get check_ins with staff_id that are done, in this month
    const { data: ciData } = await supabase.from('check_ins')
      .select('id, staff_id')
      .eq('clinic_id', cId).eq('status', 'done')
      .not('staff_id', 'is', null)
      .gte('created_date', mStart).lte('created_date', mEnd);

    if (!ciData || ciData.length === 0) { setStaffRevenues([]); return; }

    const ciIds = ciData.map((c: any) => c.id);
    const { data: payData } = await supabase.from('payments').select('check_in_id, amount').in('check_in_id', ciIds);

    // Aggregate by staff
    const map: Record<string, { total: number; count: number }> = {};
    (ciData as any[]).forEach((ci) => {
      if (!ci.staff_id) return;
      const pay = (payData || []).find((p: any) => p.check_in_id === ci.id);
      if (!map[ci.staff_id]) map[ci.staff_id] = { total: 0, count: 0 };
      map[ci.staff_id].count++;
      if (pay) map[ci.staff_id].total += (pay as any).amount;
    });

    setStaffRevenues(Object.entries(map).map(([staff_id, v]) => ({ staff_id, ...v })));

    // Consultant revenue (consultant_id)
    const { data: conCI } = await supabase.from('check_ins')
      .select('id, consultant_id')
      .eq('clinic_id', cId).eq('status', 'done')
      .not('consultant_id', 'is', null)
      .gte('created_date', mStart).lte('created_date', mEnd);
    if (!conCI || conCI.length === 0) { setConsultantRevenues([]); return; }
    const conIds = conCI.map((c: any) => c.id);
    const { data: conPayData } = await supabase.from('payments').select('check_in_id, amount').in('check_in_id', conIds);
    const conMap: Record<string, { total: number; count: number }> = {};
    (conCI as any[]).forEach((ci) => {
      if (!ci.consultant_id) return;
      const pay = (conPayData || []).find((p: any) => p.check_in_id === ci.id);
      if (!conMap[ci.consultant_id]) conMap[ci.consultant_id] = { total: 0, count: 0 };
      conMap[ci.consultant_id].count++;
      if (pay) conMap[ci.consultant_id].total += (pay as any).amount;
    });
    setConsultantRevenues(Object.entries(conMap).map(([staff_id, v]) => ({ staff_id, ...v })));
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      const clinic = await getSelectedClinic();
      if (clinic) {
        setClinicId(clinic.id); setClinicName(clinic.name);
        if (clinic.treatment_rooms) setTreatmentRooms(clinic.treatment_rooms);
        if (clinic.consultation_rooms) setConsultationRooms(clinic.consultation_rooms);
      }
    };
    init();
  }, [navigate]);

  useEffect(() => {
    if (clinicId) {
      fetchStaff(clinicId);
      fetchAssignments(clinicId, weekStart, weekEnd);
      fetchRevenue(clinicId, revenueMonth);
    }
  }, [clinicId, weekStart, weekEnd, revenueMonth, fetchStaff, fetchAssignments, fetchRevenue]);

  // 계정 관리: 초기 로드 (clinic 선택과 무관 — 전체 계정)
  useEffect(() => {
    fetchAccounts();
    fetchClinicOptions();
  }, [fetchAccounts, fetchClinicOptions]);

  const openEditAccount = (acc: UserAccount) => {
    setEditAccount(acc);
    setEditAccountName(acc.name);
    setEditAccountRole(acc.role);
    setEditAccountClinicId(acc.clinic_id || '');
    setEditAccountApproved(acc.approved !== false);
    setEditAccountActive(acc.active !== false);
  };

  const handleSaveAccount = async () => {
    if (!editAccount) return;
    const { error } = await (supabase as any).rpc('admin_update_user_profile', {
      target_id: editAccount.id,
      new_name: editAccountName.trim(),
      new_role: editAccountRole,
      new_clinic_id: editAccountClinicId || null,
      new_approved: editAccountApproved,
      new_active: editAccountActive,
    });
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '계정 정보 저장 완료' });
    setEditAccount(null);
    fetchAccounts();
  };

  const handleResetPassword = async () => {
    if (!editAccount) return;
    if (!resetPwValue.trim() || resetPwValue.length < 6) {
      toast({ title: '비밀번호 6자 이상', variant: 'destructive' });
      return;
    }
    const { error } = await (supabase as any).rpc('admin_reset_user_password', {
      target_id: editAccount.id,
      new_password: resetPwValue,
    });
    if (error) {
      toast({ title: '비번 초기화 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `${editAccount.name} 비번 초기화 완료`, description: `새 비번: ${resetPwValue}` });
    setResetPwOpen(false);
    setResetPwValue('qweiop1!');
  };

  const filteredAccounts = useMemo(
    () => accountFilter === 'all' ? accounts : accounts.filter(a => a.role === accountFilter),
    [accounts, accountFilter]
  );
  const accountCountByRole = useCallback(
    (r: string) => r === 'all' ? accounts.length : accounts.filter(a => a.role === r).length,
    [accounts]
  );

  const handleAddStaff = async () => {
    if (!newStaffName.trim() || !clinicId) {
      if (!clinicId) toast({ title: '등록 실패', description: '클리닉 정보를 불러오지 못했습니다. 새로고침 해주세요.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('staff').insert({ clinic_id: clinicId, name: newStaffName.trim(), role: newStaffRole });
    if (error) { toast({ title: '등록 실패', description: error.message, variant: 'destructive' }); return; }
    setNewStaffName(''); setNewStaffRole('technician'); setAddStaffOpen(false);
    fetchStaff(clinicId);
    toast({ title: '직원 등록 완료' });
  };

  const handleAssign = async (staffId: string) => {
    if (!assignModal || !clinicId) {
      if (!clinicId) toast({ title: '배정 실패', description: '클리닉 정보를 불러오지 못했습니다. 새로고침 해주세요.', variant: 'destructive' });
      return;
    }
    const { room, date, type } = assignModal;
    const list = type === 'treatment' ? assignments : consultAssignments;

    const existing = list.find(a => a.room_number === room && a.work_date === date);
    if (existing) {
      const { error } = await supabase.from('room_assignments').update({ staff_id: staffId }).eq('id', existing.id);
      if (error) { toast({ title: '배정 변경 실패', description: error.message, variant: 'destructive' }); return; }
    } else {
      const { error } = await supabase.from('room_assignments').insert({
        clinic_id: clinicId, room_type: type, room_number: room, staff_id: staffId, work_date: date,
      });
      if (error) { toast({ title: '배정 실패', description: error.message, variant: 'destructive' }); return; }
    }
    setAssignModal(null);
    fetchAssignments(clinicId, weekStart, weekEnd);
    toast({ title: '배정 완료' });
  };

  const handleUnassign = async (room: number, date: string, type: 'treatment' | 'consultation' = 'treatment') => {
    const list = type === 'treatment' ? assignments : consultAssignments;
    const existing = list.find(a => a.room_number === room && a.work_date === date);
    if (existing) {
      const { error } = await supabase.from('room_assignments').delete().eq('id', existing.id);
      if (error) { toast({ title: '배정 해제 실패', description: error.message, variant: 'destructive' }); return; }
      fetchAssignments(clinicId, weekStart, weekEnd);
    }
  };

  const getAssignment = (room: number, date: string, type: 'treatment' | 'consultation' = 'treatment') => {
    const list = type === 'treatment' ? assignments : consultAssignments;
    const a = list.find(x => x.room_number === room && x.work_date === date);
    if (!a) return null;
    const staff = staffList.find(s => s.id === a.staff_id);
    return staff ? staff.name : '?';
  };

  // Memoize staff name lookup map for O(1) access
  const staffNameMap = useMemo(() => {
    const m = new Map<string, string>();
    staffList.forEach(s => m.set(s.id, s.name));
    return m;
  }, [staffList]);
  const getStaffName = (id: string) => staffNameMap.get(id) || '?';

  // Pre-sort revenue arrays to avoid sorting in JSX on each render
  const sortedStaffRevenues = useMemo(
    () => [...staffRevenues].sort((a, b) => b.total - a.total),
    [staffRevenues]
  );
  const sortedConsultantRevenues = useMemo(
    () => [...consultantRevenues].sort((a, b) => b.total - a.total),
    [consultantRevenues]
  );
  const staffRevTotals = useMemo(
    () => ({ count: staffRevenues.reduce((s, r) => s + r.count, 0), total: staffRevenues.reduce((s, r) => s + r.total, 0) }),
    [staffRevenues]
  );
  const consultRevTotals = useMemo(
    () => ({ count: consultantRevenues.reduce((s, r) => s + r.count, 0), total: consultantRevenues.reduce((s, r) => s + r.total, 0) }),
    [consultantRevenues]
  );

  const weekLabel = `${format(weekStart, 'M/d')} ~ ${format(weekEnd, 'M/d')}`;
  const monthLabel = format(revenueMonth, 'yyyy년 M월');

  return (
    <AdminLayout clinicName={clinicName} activeTab="staff">
      <div className="p-6 max-w-6xl mx-auto space-y-8">
        {/* 계정 관리 (로그인 계정 = user_profiles) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold">계정 관리</h2>
              <p className="text-xs text-muted-foreground mt-0.5">로그인 계정 · 권한 · 소속 · 비밀번호 초기화</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/admin/register')}>+ 신규 계정 추가</Button>
          </div>

          {/* Role 필터 탭 */}
          <div className="flex gap-1 mb-3 flex-wrap">
            {ACCOUNT_ROLE_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setAccountFilter(tab.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                  accountFilter === tab.key
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-card hover:bg-muted'
                }`}
              >
                {tab.label} <span className="opacity-70">({accountCountByRole(tab.key)})</span>
              </button>
            ))}
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">이름</TableHead>
                  <TableHead className="w-[80px]">역할</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead className="w-[140px]">소속</TableHead>
                  <TableHead className="w-[60px] text-center">승인</TableHead>
                  <TableHead className="w-[60px] text-center">활성</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountsLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">불러오는 중…</TableCell></TableRow>
                ) : filteredAccounts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">계정이 없습니다</TableCell></TableRow>
                ) : filteredAccounts.map(acc => (
                  <TableRow
                    key={acc.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openEditAccount(acc)}
                  >
                    <TableCell className="font-medium">{acc.name}</TableCell>
                    <TableCell>
                      <span className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{ROLE_LABEL[acc.role] || acc.role}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{acc.email}</TableCell>
                    <TableCell className="text-xs">
                      {acc.clinic_name || <span className="text-destructive">미연결</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {acc.approved ? <span className="text-green-600">✓</span> : <span className="text-destructive">×</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {acc.active !== false ? <span className="text-green-600">✓</span> : <span className="text-muted-foreground">×</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Staff List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">시술 선생님 관리</h2>
            <Button size="sm" className="bg-accent text-accent-foreground" onClick={() => setAddStaffOpen(true)}>+ 직원 추가</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {staffList.filter(s => s.active).map((s) => (
              <div key={s.id} className="bg-card border rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-muted" onClick={() => { setEditStaff(s); setEditStaffName(s.name); setEditStaffRole(s.role); }}>
                {s.name} <span className="text-[10px] text-muted-foreground ml-1">{s.role === 'technician' ? '시술' : s.role === 'counselor' ? '상담' : s.role === 'coordinator' ? '코디' : s.role}</span>
              </div>
            ))}
            {staffList.filter(s => s.active).length === 0 && <p className="text-sm text-muted-foreground">등록된 직원이 없습니다</p>}
          </div>
        </div>

        {/* Weekly Schedule Grid */}
        {/* 김태영 #1: 시술방/상담실 개수 수정 UI - 대시보드와 동기화 */}
        <div className="bg-card rounded-xl border p-4 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-sm font-bold">시술방/상담실 개수 설정 ({clinicName})</h3>
            <div className="flex items-center gap-3">
              <label className="text-xs flex items-center gap-2">시술방 <Input type="number" min={1} max={50} value={treatmentRooms} onChange={(e) => setTreatmentRooms(Math.max(1, Number(e.target.value)))} className="h-7 w-16 text-xs" /></label>
              <label className="text-xs flex items-center gap-2">상담실 <Input type="number" min={1} max={20} value={consultationRooms} onChange={(e) => setConsultationRooms(Math.max(1, Number(e.target.value)))} className="h-7 w-16 text-xs" /></label>
              <Button size="sm" className="h-7 text-xs" onClick={async () => {
                if (!clinicId) return;
                const { error } = await (supabase as any).from('clinics').update({ treatment_rooms: treatmentRooms, consultation_rooms: consultationRooms }).eq('id', clinicId);
                if (error) toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
                else toast({ title: '저장됨', description: '대시보드에 반영됩니다 (새로고침 필요)' });
              }}>저장</Button>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">주간 근무 배정</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(subDays(weekStart, 7))}><ChevronLeft className="h-3 w-3" /></Button>
              <span className="text-sm font-medium">{weekLabel}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-3 w-3" /></Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>이번주</Button>
            </div>
          </div>

          <div className="bg-card rounded-xl border overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left w-16 sticky left-0 bg-card z-10">시술실</th>
                  {weekDays.map((day, i) => {
                    const isT = isToday(day);
                    return (
                      <th key={i} className={`px-2 py-2 text-center min-w-[90px] ${isT ? 'bg-accent/10' : ''}`}>
                        <div>{DAY_LABELS[i]}</div>
                        <div className={isT ? 'text-accent font-bold' : 'text-muted-foreground'}>{format(day, 'M/d')}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: treatmentRooms }, (_, i) => i + 1).map((room) => (
                  <tr key={room} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium sticky left-0 bg-card z-10">{room}번</td>
                    {weekDays.map((day, di) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const staffName = getAssignment(room, dateStr, 'treatment');
                      const isT = isToday(day);
                      return (
                        <td key={di} className={`px-1 py-1 text-center ${isT ? 'bg-accent/5' : ''}`}>
                          {staffName ? (
                            <div className="flex items-center justify-center gap-1">
                              <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-medium">{staffName}</span>
                              <button onClick={() => handleUnassign(room, dateStr, 'treatment')} className="text-[10px] text-muted-foreground hover:text-destructive">×</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAssignModal({ room, date: dateStr, type: 'treatment' })}
                              className="text-muted-foreground/40 hover:text-accent text-[10px]"
                            >+</button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* KTY-WEEKLY-ROOM-ADD: 시술실 방 추가 버튼 */}
                <tr className="border-b border-border/50">
                  <td colSpan={weekDays.length + 1} className="px-2 py-1 text-center">
                    <button onClick={async () => {
                      const next = treatmentRooms + 1;
                      setTreatmentRooms(next);
                      if (clinicId) await (supabase as any).from('clinics').update({ treatment_rooms: next }).eq('id', clinicId);
                    }} className="text-[10px] text-muted-foreground hover:text-accent">+ 시술방 추가</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Consultation Room Grid */}
        <div>
          <h2 className="text-lg font-bold mb-3">상담실 배정</h2>
          <div className="bg-card rounded-xl border overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left w-16 sticky left-0 bg-card z-10">상담실</th>
                  {weekDays.map((day, i) => {
                    const isT = isToday(day);
                    return (
                      <th key={i} className={`px-2 py-2 text-center min-w-[90px] ${isT ? 'bg-accent/10' : ''}`}>
                        <div>{DAY_LABELS[i]}</div>
                        <div className={isT ? 'text-accent font-bold' : 'text-muted-foreground'}>{format(day, 'M/d')}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: consultationRooms }, (_, i) => i + 1).map((room) => (
                  <tr key={room} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium sticky left-0 bg-card z-10">{room}번</td>
                    {weekDays.map((day, di) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const staffName = getAssignment(room, dateStr, 'consultation');
                      const isT = isToday(day);
                      return (
                        <td key={di} className={`px-1 py-1 text-center ${isT ? 'bg-accent/5' : ''}`}>
                          {staffName ? (
                            <div className="flex items-center justify-center gap-1">
                              <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-medium">{staffName}</span>
                              <button onClick={() => handleUnassign(room, dateStr, 'consultation')} className="text-[10px] text-muted-foreground hover:text-destructive">×</button>
                            </div>
                          ) : (
                            <button onClick={() => setAssignModal({ room, date: dateStr, type: 'consultation' })} className="text-muted-foreground/40 hover:text-accent text-[10px]">+</button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* KTY-WEEKLY-ROOM-ADD: 상담실 방 추가 버튼 */}
                <tr className="border-b border-border/50">
                  <td colSpan={weekDays.length + 1} className="px-2 py-1 text-center">
                    <button onClick={async () => {
                      const next = consultationRooms + 1;
                      setConsultationRooms(next);
                      if (clinicId) await (supabase as any).from('clinics').update({ consultation_rooms: next }).eq('id', clinicId);
                    }} className="text-[10px] text-muted-foreground hover:text-accent">+ 상담실 추가</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Revenue */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">월별 매출 (선생님별)</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setRevenueMonth(new Date(revenueMonth.getFullYear(), revenueMonth.getMonth() - 1))}><ChevronLeft className="h-3 w-3" /></Button>
              <span className="text-sm font-medium">{monthLabel}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setRevenueMonth(new Date(revenueMonth.getFullYear(), revenueMonth.getMonth() + 1))}><ChevronRight className="h-3 w-3" /></Button>
            </div>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>선생님</TableHead>
                  <TableHead className="text-center">시술 건수</TableHead>
                  <TableHead className="text-right">매출</TableHead>
                  <TableHead className="text-right">건당 평균</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStaffRevenues.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">데이터 없음</TableCell></TableRow>
                ) : (
                  <>
                    {sortedStaffRevenues.map((sr) => (
                        <TableRow key={sr.staff_id}>
                          <TableCell className="font-medium">{getStaffName(sr.staff_id)}</TableCell>
                          <TableCell className="text-center">{sr.count}건</TableCell>
                          <TableCell className="text-right font-medium">{sr.total.toLocaleString()}원</TableCell>
                          <TableCell className="text-right text-muted-foreground">{sr.count > 0 ? Math.round(sr.total / sr.count).toLocaleString() : 0}원</TableCell>
                        </TableRow>
                      ))}
                    <TableRow className="border-t-2">
                      <TableCell className="font-bold">합계</TableCell>
                      <TableCell className="text-center font-bold">{staffRevTotals.count}건</TableCell>
                      <TableCell className="text-right font-bold">{staffRevTotals.total.toLocaleString()}원</TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Consultant Revenue */}
        <div>
          <h2 className="text-lg font-bold mb-3">월별 매출 (상담실장별)</h2>
          <div className="bg-card rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>상담실장</TableHead>
                  <TableHead className="text-center">상담 건수</TableHead>
                  <TableHead className="text-right">매출</TableHead>
                  <TableHead className="text-right">건당 평균</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedConsultantRevenues.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">데이터 없음</TableCell></TableRow>
                ) : (
                  <>
                    {sortedConsultantRevenues.map((sr) => (
                      <TableRow key={sr.staff_id}>
                        <TableCell className="font-medium">{getStaffName(sr.staff_id)}</TableCell>
                        <TableCell className="text-center">{sr.count}건</TableCell>
                        <TableCell className="text-right font-medium">{sr.total.toLocaleString()}원</TableCell>
                        <TableCell className="text-right text-muted-foreground">{sr.count > 0 ? Math.round(sr.total / sr.count).toLocaleString() : 0}원</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="font-bold">합계</TableCell>
                      <TableCell className="text-center font-bold">{consultRevTotals.count}건</TableCell>
                      <TableCell className="text-right font-bold">{consultRevTotals.total.toLocaleString()}원</TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
      <Dialog open={addStaffOpen} onOpenChange={setAddStaffOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>직원 추가</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} placeholder="이름" onKeyDown={(e) => { if (e.key === 'Enter') handleAddStaff(); }} />
            <select value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="technician">시술사</option>
              <option value="counselor">상담사</option>
              <option value="coordinator">코디</option>
            </select>
            <Button className="w-full bg-accent text-accent-foreground" onClick={handleAddStaff} disabled={!newStaffName.trim()}>등록</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Modal */}
      <Dialog open={!!editStaff} onOpenChange={(v) => { if (!v) setEditStaff(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>직원 수정</DialogTitle></DialogHeader>
          {editStaff && (
            <div className="space-y-4">
              <Input value={editStaffName} onChange={(e) => setEditStaffName(e.target.value)} placeholder="이름" />
              <select value={editStaffRole} onChange={(e) => setEditStaffRole(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="technician">시술사</option>
                <option value="counselor">상담사</option>
                <option value="coordinator">코디</option>
              </select>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={async () => {
                  await supabase.from('staff').update({ name: editStaffName.trim(), role: editStaffRole }).eq('id', editStaff.id);
                  setEditStaff(null); fetchStaff(clinicId); toast({ title: '수정 완료' });
                }} disabled={!editStaffName.trim()}>저장</Button>
                <Button variant="destructive" className="flex-1" onClick={async () => {
                  if (!window.confirm(`${editStaff.name} 직원을 비활성화하시겠습니까?`)) return;
                  await supabase.from('staff').update({ active: false }).eq('id', editStaff.id);
                  setEditStaff(null); fetchStaff(clinicId); toast({ title: '비활성화 완료' });
                }}>비활성화</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Account Modal (계정 관리) */}
      <Dialog open={!!editAccount} onOpenChange={(v) => { if (!v) { setEditAccount(null); setResetPwOpen(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>계정 수정{editAccount && ` · ${editAccount.name}`}</DialogTitle></DialogHeader>
          {editAccount && !resetPwOpen && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">이메일 (수정 불가)</label>
                <Input value={editAccount.email} disabled className="mt-1 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">이름</label>
                <Input value={editAccountName} onChange={(e) => setEditAccountName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">역할</label>
                <select
                  value={editAccountRole}
                  onChange={(e) => setEditAccountRole(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">소속 지점</label>
                <select
                  value={editAccountClinicId}
                  onChange={(e) => setEditAccountClinicId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
                >
                  <option value="">— 미연결 —</option>
                  {clinicOptions.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAccountApproved} onChange={(e) => setEditAccountApproved(e.target.checked)} />
                  승인
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editAccountActive} onChange={(e) => setEditAccountActive(e.target.checked)} />
                  활성
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 bg-accent text-accent-foreground" onClick={handleSaveAccount} disabled={!editAccountName.trim()}>저장</Button>
                <Button variant="outline" onClick={() => setResetPwOpen(true)}>비번 초기화</Button>
              </div>
            </div>
          )}
          {editAccount && resetPwOpen && (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">{editAccount.name}</span>의 비밀번호를 새로 설정합니다.
              </p>
              <div>
                <label className="text-xs text-muted-foreground">새 비밀번호 (6자 이상)</label>
                <Input value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div className="text-xs text-muted-foreground">
                저장하면 즉시 적용되고 기존 세션은 무효화됩니다.
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setResetPwOpen(false); setResetPwValue('qweiop1!'); }}>취소</Button>
                <Button className="flex-1 bg-destructive text-destructive-foreground" onClick={handleResetPassword}>초기화 실행</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Staff Modal */}
      <Dialog open={!!assignModal} onOpenChange={(v) => { if (!v) setAssignModal(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{assignModal ? `${assignModal.type === 'consultation' ? '상담' : '시술'} ${assignModal.room}번 · ${assignModal.date}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            {staffList.filter(s => s.active).map((s) => (
              <button key={s.id} className="w-full text-left px-3 py-2.5 hover:bg-muted rounded-lg text-sm font-medium" onClick={() => handleAssign(s.id)}>
                {s.name}
              </button>
            ))}
            {staffList.filter(s => s.active).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">직원을 먼저 등록해주세요</p>}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
