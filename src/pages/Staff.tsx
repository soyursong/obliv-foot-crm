import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Plus, UserCog, DoorOpen } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import type { Clinic, Room, Staff, StaffRole } from '@/lib/types';
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
        </TabsList>
        <TabsContent value="staff">{clinic && <StaffTab clinic={clinic} />}</TabsContent>
        <TabsContent value="rooms">{clinic && <RoomTab clinic={clinic} />}</TabsContent>
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
function RoomTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());

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

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['room_assignments', clinic.id, date] });

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
      const { error } = await supabase
        .from('room_assignments')
        .update({ staff_id: staffId, staff_name: staff?.name ?? null })
        .eq('id', existing.id);
      if (error) {
        toast.error(`배정 실패: ${error.message}`);
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
      await supabase.from('room_assignments').delete().eq('clinic_id', clinic.id).eq('date', date);
    }
    const { error: insErr } = await supabase.from('room_assignments').insert(inserts);
    if (insErr) { toast.error(`복사 실패: ${insErr.message}`); return; }
    toast.success(`${prevDate} 배정 복사 완료 (${inserts.length}건)`);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label>날짜</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button variant="outline" size="sm" onClick={copyPrevDay}>
            전날 복사
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          배정 인원 {assignments.length} / 활성 공간 {rooms.length}
        </div>
      </div>

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
                      <div
                        key={room.id}
                        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="w-16 shrink-0 font-medium">{room.name}</span>
                        <select
                          className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                          value={assigned?.staff_id ?? ''}
                          onChange={(e) => handleAssign(room, e.target.value)}
                        >
                          <option value="">— 미배정 —</option>
                          {staffList.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {ROLE_LABEL[s.role]}
                            </option>
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
    </div>
  );
}
