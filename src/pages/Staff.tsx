import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, startOfWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast } from 'sonner';
import { Plus, UserCog, DoorOpen, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import type { Clinic, Room, Staff, StaffRole } from '@/lib/types';
import { formatAmount } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Role = StaffRole;

const ROLE_LABEL: Record<Role, string> = {
  director: '원장',
  consultant: '상담실장',
  coordinator: '코디네이터',
  therapist: '치료사',
  technician: '관리사',
};

const ROLE_ORDER: Role[] = ['director', 'consultant', 'coordinator', 'therapist', 'technician'];

const ROOM_TYPE_LABEL: Record<Room['room_type'], string> = {
  treatment: '치료실',
  laser: '레이저실',
  consultation: '상담실',
  examination: '원장실',
};

const ROOM_TYPE_ORDER: Room['room_type'][] = ['treatment', 'laser', 'consultation', 'examination'];

interface RoomAssignmentRow {
  id: string;
  clinic_id: string;
  date: string;
  room_name: string;
  room_type: Room['room_type'];
  staff_id: string | null;
  staff_name: string | null;
}

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function StaffPage() {
  const [tab, setTab] = useState('staff');

  const { data: clinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: getClinic,
  });

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="staff">
            <UserCog className="mr-1 h-4 w-4" /> 직원
          </TabsTrigger>
          <TabsTrigger value="rooms">
            <DoorOpen className="mr-1 h-4 w-4" /> 공간 배정
          </TabsTrigger>
          <TabsTrigger value="performance">
            <TrendingUp className="mr-1 h-4 w-4" /> 월간 실적
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff">{clinic && <StaffTab clinic={clinic} />}</TabsContent>
        <TabsContent value="rooms">{clinic && <RoomTab clinic={clinic} />}</TabsContent>
        <TabsContent value="performance">{clinic && <PerformanceTab clinic={clinic} />}</TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// 직원 탭
// ============================================================
function StaffTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff', clinic.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('clinic_id', clinic.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  const grouped = useMemo(() => {
    const map: Record<Role, Staff[]> = {
      director: [],
      consultant: [],
      coordinator: [],
      therapist: [],
      technician: [],
    };
    for (const s of staffList) {
      if (!showInactive && !s.active) continue;
      map[s.role]?.push(s);
    }
    return map;
  }, [staffList, showInactive]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['staff', clinic.id] });

  const toggleActive = async (s: Staff) => {
    const { error } = await supabase
      .from('staff')
      .update({ active: !s.active })
      .eq('id', s.id);
    if (error) {
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    toast.success(s.active ? '비활성화' : '활성화');
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold">직원 관리</h3>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            비활성 포함
          </label>
        </div>
        <Button size="sm" onClick={() => setOpenCreate(true)}>
          <Plus className="mr-1 h-4 w-4" /> 신규 직원
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {ROLE_ORDER.map((role) => (
          <Card key={role}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{ROLE_LABEL[role]}</span>
                <Badge variant="outline">{grouped[role].length}명</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {grouped[role].length === 0 && (
                <div className="rounded-md border border-dashed py-3 text-center text-xs text-muted-foreground">
                  등록된 인원이 없습니다.
                </div>
              )}
              {grouped[role].map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {!s.active && (
                      <Badge variant="destructive" className="text-xs">
                        비활성
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant={s.active ? 'outline' : 'default'}
                    onClick={() => toggleActive(s)}
                  >
                    {s.active ? '비활성화' : '활성화'}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateStaffDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        clinicId={clinic.id}
        onCreated={refresh}
      />
    </div>
  );
}

function CreateStaffDialog({
  open,
  onOpenChange,
  clinicId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clinicId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('therapist');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setRole('therapist');
    }
  }, [open]);

  const save = async () => {
    if (!name.trim()) {
      toast.error('이름을 입력하세요');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('staff').insert({
      clinic_id: clinicId,
      name: name.trim(),
      role,
      active: true,
    });
    setSubmitting(false);
    if (error) {
      toast.error(`등록 실패: ${error.message}`);
      return;
    }
    toast.success('직원 등록');
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>신규 직원 등록</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </div>
          <div className="space-y-1">
            <Label>역할</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={save} disabled={submitting}>
            {submitting ? '저장중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 공간 배정 탭
// ============================================================
type RoomViewMode = 'daily' | 'weekly';

function RoomTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [roomView, setRoomView] = useState<RoomViewMode>('daily');
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const weekDays = useMemo(() => Array.from({ length: 6 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

  const { data: rooms = [] } = useQuery<Room[]>({
    queryKey: ['rooms', clinic.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Room[];
    },
  });

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff', clinic.id, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  const { data: assignments = [] } = useQuery<RoomAssignmentRow[]>({
    queryKey: ['room_assignments', clinic.id, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('room_assignments')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('date', date);
      if (error) throw error;
      return (data ?? []) as RoomAssignmentRow[];
    },
  });

  const weekStartStr = format(weekDays[0], 'yyyy-MM-dd');
  const weekEndStr = format(weekDays[5], 'yyyy-MM-dd');
  const { data: weekAssignments = [] } = useQuery<RoomAssignmentRow[]>({
    queryKey: ['room_assignments_week', clinic.id, weekStartStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('room_assignments')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr);
      if (error) throw error;
      return (data ?? []) as RoomAssignmentRow[];
    },
    enabled: roomView === 'weekly',
  });

  const weekAssignMap = useMemo(() => {
    const map: Record<string, RoomAssignmentRow> = {};
    for (const a of weekAssignments) map[`${a.date}_${a.room_name}`] = a;
    return map;
  }, [weekAssignments]);

  const assignmentByRoom = useMemo(() => {
    const map = new Map<string, RoomAssignmentRow>();
    for (const a of assignments) map.set(a.room_name, a);
    return map;
  }, [assignments]);

  const groupedRooms = useMemo(() => {
    const map: Record<Room['room_type'], Room[]> = {
      treatment: [],
      laser: [],
      consultation: [],
      examination: [],
    };
    for (const r of rooms) map[r.room_type].push(r);
    return map;
  }, [rooms]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room_assignments', clinic.id, date] });
    qc.invalidateQueries({ queryKey: ['room_assignments_week', clinic.id, weekStartStr] });
  };

  const handleWeekAssign = async (room: Room, dayStr: string, staffId: string) => {
    const key = `${dayStr}_${room.name}`;
    const existing = weekAssignMap[key];
    const staff = staffList.find((s) => s.id === staffId);

    if (!staffId) {
      if (existing) {
        await supabase.from('room_assignments').delete().eq('id', existing.id);
        refresh();
      }
      return;
    }
    if (existing) {
      await supabase.from('room_assignments').update({ staff_id: staffId, staff_name: staff?.name ?? null }).eq('id', existing.id);
    } else {
      await supabase.from('room_assignments').insert({
        clinic_id: clinic.id, date: dayStr, room_name: room.name, room_type: room.room_type,
        staff_id: staffId, staff_name: staff?.name ?? null,
      });
    }
    refresh();
  };

  const handleAssign = async (room: Room, staffId: string) => {
    const existing = assignmentByRoom.get(room.name);
    const staff = staffList.find((s) => s.id === staffId);

    if (!staffId) {
      // 미배정으로 설정 → 기존 행 삭제
      if (existing) {
        const { error } = await supabase
          .from('room_assignments')
          .delete()
          .eq('id', existing.id);
        if (error) {
          toast.error(`해제 실패: ${error.message}`);
          return;
        }
        toast.success(`${room.name} 배정 해제`);
        refresh();
      }
      return;
    }

    if (existing) {
      const { data: updated, error } = await supabase
        .from('room_assignments')
        .update({ staff_id: staffId, staff_name: staff?.name ?? null })
        .eq('id', existing.id)
        .select('id');
      if (error) {
        toast.error(`배정 실패: ${error.message}`);
        return;
      }
      // RLS denial 등으로 0행 영향 → silent 실패 가시화
      if (!updated || updated.length === 0) {
        toast.error('배정 변경 권한이 없습니다 (admin/manager만 가능)');
        return;
      }
    } else {
      const { error } = await supabase.from('room_assignments').insert({
        clinic_id: clinic.id,
        date,
        room_name: room.name,
        room_type: room.room_type,
        staff_id: staffId,
        staff_name: staff?.name ?? null,
      });
      if (error) {
        toast.error(`배정 실패: ${error.message}`);
        return;
      }
    }
    toast.success(`${room.name} → ${staff?.name ?? ''}`);
    refresh();
  };

  const copyPrevDay = async () => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const prevDate = prev.toISOString().slice(0, 10);
    const { data: prevAssigns, error } = await supabase
      .from('room_assignments')
      .select('room_name, room_type, staff_id, staff_name')
      .eq('clinic_id', clinic.id)
      .eq('date', prevDate);
    if (error || !prevAssigns?.length) {
      toast.error('전날 배정이 없습니다');
      return;
    }
    const inserts = prevAssigns.map((a) => ({
      clinic_id: clinic.id,
      date,
      room_name: a.room_name,
      room_type: a.room_type,
      staff_id: a.staff_id,
      staff_name: a.staff_name,
    }));
    if (assignments.length > 0) {
      if (!window.confirm(`${date}에 이미 ${assignments.length}건 배정이 있습니다. 덮어쓰시겠습니까?`)) return;
      await supabase.from('room_assignments').delete().eq('clinic_id', clinic.id).eq('date', date);
    }
    const { error: insErr } = await supabase.from('room_assignments').insert(inserts);
    if (insErr) { toast.error(`복사 실패: ${insErr.message}`); return; }
    toast.success(`${prevDate} 배정 복사 완료 (${inserts.length}건)`);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          {roomView === 'daily' ? (
            <>
              <div className="space-y-1">
                <Label>날짜</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
              </div>
              <Button variant="outline" size="sm" onClick={copyPrevDay}>전날 복사</Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[180px] text-center text-sm font-medium">
                {format(weekDays[0], 'M/d', { locale: ko })} ~ {format(weekDays[5], 'M/d')}
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
                이번 주
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <button onClick={() => setRoomView('daily')} className={`px-3 py-1 text-xs font-medium transition ${roomView === 'daily' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted'}`}>
              일간
            </button>
            <button onClick={() => setRoomView('weekly')} className={`px-3 py-1 text-xs font-medium transition ${roomView === 'weekly' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted'}`}>
              주간
            </button>
          </div>
          {roomView === 'daily' && (
            <span className="text-xs text-muted-foreground">
              배정 {assignments.length} / 공간 {rooms.length}
            </span>
          )}
        </div>
      </div>

      {roomView === 'daily' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ROOM_TYPE_ORDER.map((type) => {
            const list = groupedRooms[type];
            if (list.length === 0) return null;
            return (
              <Card key={type}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {ROOM_TYPE_LABEL[type]} <span className="text-muted-foreground">({list.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {list.map((room) => {
                      const assigned = assignmentByRoom.get(room.name);
                      return (
                        <div key={room.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                          <span className="w-16 shrink-0 font-medium">{room.name}</span>
                          <select
                            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                            value={assigned?.staff_id ?? ''}
                            onChange={(e) => handleAssign(room, e.target.value)}
                          >
                            <option value="">— 미배정 —</option>
                            {staffList.map((s) => (
                              <option key={s.id} value={s.id}>{s.name} · {ROLE_LABEL[s.role]}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border bg-background">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60">
              <tr>
                <th className="w-24 border-b border-r py-2 text-left px-2 text-xs font-medium text-muted-foreground">공간</th>
                {weekDays.map((d) => (
                  <th key={d.toISOString()} className="border-b border-r py-2 px-2 text-center text-xs font-medium">
                    {format(d, 'EEE M/d', { locale: ko })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROOM_TYPE_ORDER.flatMap((type) =>
                groupedRooms[type].map((room, ri) => (
                  <tr key={room.id} className={ri === 0 && type !== 'treatment' ? 'border-t-2' : ''}>
                    <td className="border-b border-r px-2 py-1.5 text-xs font-medium whitespace-nowrap">
                      <span className="text-muted-foreground">{ROOM_TYPE_LABEL[type]}</span>{' '}
                      {room.name}
                    </td>
                    {weekDays.map((d) => {
                      const dayStr = format(d, 'yyyy-MM-dd');
                      const a = weekAssignMap[`${dayStr}_${room.name}`];
                      return (
                        <td key={d.toISOString()} className="border-b border-r p-1">
                          <select
                            className="h-7 w-full rounded border bg-background px-1 text-xs"
                            value={a?.staff_id ?? ''}
                            onChange={(e) => handleWeekAssign(room, dayStr, e.target.value)}
                          >
                            <option value="">—</option>
                            {staffList.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 월간 실적 탭
// ============================================================
function PerformanceTab({ clinic }: { clinic: Clinic }) {
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [staffPerf, setStaffPerf] = useState<{ id: string; name: string; role: string; checkIns: number; revenue: number; roomDays: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const from = `${month}-01`;
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
    const to = format(lastDay, 'yyyy-MM-dd');

    const [staffRes, ciRes, payRes, raRes] = await Promise.all([
      supabase.from('staff').select('id, name, role').eq('clinic_id', clinic.id).eq('active', true),
      supabase.from('check_ins').select('id, consultant_id, therapist_id, technician_id').eq('clinic_id', clinic.id)
        .gte('checked_in_at', `${from}T00:00:00+09:00`).lte('checked_in_at', `${to}T23:59:59+09:00`),
      supabase.from('payments').select('amount, payment_type, check_in_id').eq('clinic_id', clinic.id)
        .gte('created_at', `${from}T00:00:00+09:00`).lte('created_at', `${to}T23:59:59+09:00`),
      supabase.from('room_assignments').select('staff_id').eq('clinic_id', clinic.id)
        .gte('date', from).lte('date', to),
    ]);

    const staffList = (staffRes.data ?? []) as { id: string; name: string; role: string }[];
    const checkIns = (ciRes.data ?? []) as { id: string; consultant_id: string | null; therapist_id: string | null; technician_id: string | null }[];
    const payments = (payRes.data ?? []) as { amount: number; payment_type: string; check_in_id: string | null }[];
    const roomAssigns = (raRes.data ?? []) as { staff_id: string | null }[];

    const ciToConsultant: Record<string, string> = {};
    for (const ci of checkIns) { if (ci.consultant_id) ciToConsultant[ci.id] = ci.consultant_id; }

    const counts: Record<string, number> = {};
    const revenues: Record<string, number> = {};
    const roomDays: Record<string, number> = {};

    for (const ci of checkIns) {
      for (const id of [ci.consultant_id, ci.therapist_id, ci.technician_id]) {
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    for (const p of payments) {
      if (!p.check_in_id) continue;
      const cid = ciToConsultant[p.check_in_id];
      if (cid) {
        const amt = p.payment_type === 'refund' ? -p.amount : p.amount;
        revenues[cid] = (revenues[cid] ?? 0) + amt;
      }
    }
    for (const ra of roomAssigns) {
      if (ra.staff_id) roomDays[ra.staff_id] = (roomDays[ra.staff_id] ?? 0) + 1;
    }

    setStaffPerf(staffList.map((s) => ({
      id: s.id, name: s.name, role: s.role,
      checkIns: counts[s.id] ?? 0,
      revenue: revenues[s.id] ?? 0,
      roomDays: roomDays[s.id] ?? 0,
    })).sort((a, b) => b.revenue - a.revenue || b.checkIns - a.checkIns));
    setLoading(false);
  }, [clinic.id, month]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = staffPerf.reduce((s, p) => s + p.revenue, 0);
  const totalCheckIns = staffPerf.reduce((s, p) => s + p.checkIns, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <Label>월</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        </div>
        <div className="flex gap-4 text-sm">
          <span>총 매출: <span className="font-bold">{formatAmount(totalRevenue)}</span></span>
          <span>총 건수: <span className="font-bold">{totalCheckIns}</span></span>
        </div>
      </div>
      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">로딩 중…</div>
          ) : staffPerf.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">데이터 없음</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">이름</th>
                    <th className="pb-2 font-medium">직책</th>
                    <th className="pb-2 font-medium text-right">담당 건수</th>
                    <th className="pb-2 font-medium text-right">배정 일수</th>
                    <th className="pb-2 font-medium text-right">매출 기여</th>
                    <th className="pb-2 font-medium text-right">비율</th>
                  </tr>
                </thead>
                <tbody>
                  {staffPerf.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{s.name}</td>
                      <td className="py-2 text-muted-foreground">{ROLE_LABEL[s.role as Role] ?? s.role}</td>
                      <td className="py-2 text-right tabular-nums">{s.checkIns}</td>
                      <td className="py-2 text-right tabular-nums">{s.roomDays}일</td>
                      <td className="py-2 text-right tabular-nums font-medium">{formatAmount(s.revenue)}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {totalRevenue > 0 ? `${Math.round((s.revenue / totalRevenue) * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
