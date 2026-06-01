import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, startOfWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast } from '@/lib/toast';
import { Plus, UserCog, DoorOpen, ChevronLeft, ChevronRight, Pencil, Trash2, CalendarDays, Settings, X, PowerOff, Power } from 'lucide-react';
import { DutyRosterTab } from '@/components/DutyRosterTab';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getClinic, clearClinicCache } from '@/lib/clinic';
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

import { STAFF_ROLE_LABEL as ROLE_LABEL, STAFF_ROLE_ORDER as ROLE_ORDER } from '@/lib/status';

type Role = StaffRole;

// T-20260515-foot-SPACE-ASSIGN-REVAMP AC-10: 원장실 → 원장실 C5
const ROOM_TYPE_LABEL: Record<Room['room_type'], string> = {
  treatment: '치료실',
  laser: '레이저실',
  consultation: '상담실',
  examination: '원장실 C5',
  heated_laser: '가열성레이저',
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

// todayStr 함수 제거 — 컴포넌트 내부 const todayStr 로 통일 (shadow 충돌 방지)

export default function StaffPage() {
  const [tab, setTab] = useState('duty');
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  const { data: clinic, refetch: refetchClinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: getClinic,
  });

  return (
    <div className="h-full overflow-auto space-y-4 p-4 md:p-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="duty">
            <CalendarDays className="mr-1 h-4 w-4" /> 근무캘린더
          </TabsTrigger>
          <TabsTrigger value="staff">
            <UserCog className="mr-1 h-4 w-4" /> 직원
          </TabsTrigger>
          <TabsTrigger value="rooms">
            <DoorOpen className="mr-1 h-4 w-4" /> 공간 배정
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="settings">
              <Settings className="mr-1 h-4 w-4" /> 클리닉 설정
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="duty">{clinic && <DutyRosterTab clinic={clinic} />}</TabsContent>
        <TabsContent value="staff">{clinic && <StaffTab clinic={clinic} />}</TabsContent>
        <TabsContent value="rooms">{clinic && <RoomTab clinic={clinic} />}</TabsContent>
        {isAdmin && (
          <TabsContent value="settings">
            {clinic && <ClinicSettingsTab clinic={clinic} onSaved={refetchClinic} />}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ============================================================
// 직원 탭
// ============================================================
function StaffTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  // admin 또는 manager 권한 모두 직원 관리 가능
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  const [openCreate, setOpenCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editTarget, setEditTarget] = useState<Staff | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Staff | null>(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);

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

  /** 활성화는 즉시 실행, 비활성화는 확인 다이얼로그 */
  const handleToggleActive = async (s: Staff) => {
    if (!s.active) {
      // 활성화 — 즉시 실행
      const { error } = await supabase.from('staff').update({ active: true }).eq('id', s.id);
      if (error) { toast.error(`활성화 실패: ${error.message}`); return; }
      toast.success(`${s.name} 활성화됨`);
      refresh();
    } else {
      // 비활성화 — 확인 다이얼로그 표시
      setDeactivateTarget(s);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivateBusy(true);
    const { error } = await supabase.from('staff').update({ active: false }).eq('id', deactivateTarget.id);
    setDeactivateBusy(false);
    if (error) { toast.error(`비활성화 실패: ${error.message}`); return; }
    toast.success(`${deactivateTarget.name} 비활성화됨`);
    setDeactivateTarget(null);
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
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    !s.active ? 'bg-muted/30 opacity-70' : 'bg-card'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${!s.active ? 'text-muted-foreground' : ''}`}>{s.name}</span>
                    {!s.active && (
                      <Badge variant="destructive" className="text-xs">
                        비활성
                      </Badge>
                    )}
                  </div>
                  {isAdmin ? (
                    <div className="flex items-center gap-1">
                      {s.active && (
                        <Button
                          size="xs"
                          variant="ghost"
                          title="정보 수정"
                          onClick={() => setEditTarget(s)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant={s.active ? 'destructive' : 'default'}
                        title={s.active ? '직원 비활성화(삭제)' : '직원 활성화'}
                        onClick={() => handleToggleActive(s)}
                        className={s.active ? 'gap-1' : ''}
                      >
                        {s.active ? (
                          <>
                            <Trash2 className="h-3 w-3" />
                            삭제
                          </>
                        ) : '활성화'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 비활성화 확인 다이얼로그 */}
      <Dialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && !deactivateBusy && setDeactivateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>직원 삭제(비활성화) 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">{deactivateTarget?.name}</span>{' '}
              직원을 비활성화하시겠습니까?
            </p>
            <p className="text-muted-foreground">
              비활성화된 직원은 공간 배정 목록에서 제외됩니다. 계정이 연동된 경우 로그인도 차단됩니다.
              나중에 다시 활성화할 수 있습니다.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deactivateBusy}
              onClick={() => setDeactivateTarget(null)}
            >
              취소
            </Button>
            <Button variant="destructive" disabled={deactivateBusy} onClick={confirmDeactivate} className="gap-1">
              <Trash2 className="h-4 w-4" />
              {deactivateBusy ? '처리 중…' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateStaffDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        clinicId={clinic.id}
        onCreated={refresh}
      />

      <EditStaffDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={refresh}
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
// 직원 정보 수정 다이얼로그 (admin 전용)
// ============================================================
function EditStaffDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Staff | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('therapist');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setRole(target.role);
    }
  }, [target]);

  const save = async () => {
    if (!target) return;
    if (!name.trim()) {
      toast.error('이름을 입력하세요');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('staff')
      .update({ name: name.trim(), role })
      .eq('id', target.id);
    setSaving(false);
    if (error) {
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    toast.success('수정됨');
    onClose();
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>직원 정보 수정 · {target?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>이름</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
            />
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
          <Button variant="outline" disabled={saving} onClick={onClose}>
            취소
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '저장'}
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

/** T-20260523-foot-SPACE-DASH-AUTOSYNC Feature B: 당일 방 비활성화 상태 */
interface DailyRoomStatus {
  id: string;
  clinic_id: string;
  date: string;
  room_name: string;
  is_active: boolean;
}

function RoomTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const [roomView, setRoomView] = useState<RoomViewMode>('daily');
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  // AC-1/AC-3 T-20260515-foot-SPACE-ASSIGN-REVAMP: 로컬 배정 변경 버퍼
  const [pending, setPending] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1: 방 비활성화 토글 처리 중 맵
  const [togglingRoom, setTogglingRoom] = useState<string | null>(null);

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

  // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1: 당일 방 비활성화 상태 로드
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const { data: dailyRoomStatuses = [], refetch: refetchRoomStatuses } = useQuery<DailyRoomStatus[]>({
    queryKey: ['daily_room_status', clinic.id, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_room_status')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('date', todayStr);
      if (error) throw error;
      return (data ?? []) as DailyRoomStatus[];
    },
  });

  /** 방 이름 → 비활성 여부 맵 (is_active=false인 항목만 비활성) */
  const inactiveRoomNames = useMemo(() => {
    const s = new Set<string>();
    for (const row of dailyRoomStatuses) {
      if (!row.is_active) s.add(row.room_name);
    }
    return s;
  }, [dailyRoomStatuses]);

  /** AC-B1: 방 비활성화 토글 핸들러 */
  const handleRoomToggle = async (roomName: string) => {
    setTogglingRoom(roomName);
    const existing = dailyRoomStatuses.find(r => r.room_name === roomName);
    const currentlyInactive = existing && !existing.is_active;
    try {
      if (currentlyInactive) {
        // 재활성화: 행 삭제 (없음 = 활성 기본)
        await supabase.from('daily_room_status').delete().eq('id', existing.id);
        toast.success(`${roomName} 활성화됨`);
      } else {
        // 비활성화: upsert (당일 한정)
        const { error } = await supabase.from('daily_room_status').upsert({
          ...(existing ? { id: existing.id } : {}),
          clinic_id: clinic.id,
          date: todayStr,
          room_name: roomName,
          is_active: false,
        }, { onConflict: 'clinic_id,date,room_name' });
        if (error) throw error;
        toast.success(`${roomName} 비활성화됨 (당일 한정)`);
      }
      qc.invalidateQueries({ queryKey: ['daily_room_status', clinic.id, todayStr] });
      await refetchRoomStatuses();
    } catch (err) {
      toast.error(`토글 실패: ${(err as Error).message}`);
    } finally {
      setTogglingRoom(null);
    }
  };

  // T-20260508-foot-ROOM-STAFF-LINK: 공간 유형별 허용 역할 매핑
  const { data: roomRoleMappings = [] } = useQuery<{ room_type: string; allowed_role: string }[]>({
    queryKey: ['room_role_mapping', clinic.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('room_role_mapping')
        .select('room_type, allowed_role')
        .eq('clinic_id', clinic.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** room_type → 허용 StaffRole[] 맵. 미설정 시 빈 배열 (전체 직원 노출) */
  const roomTypeAllowedRoles = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of roomRoleMappings) {
      (map[row.room_type] ??= []).push(row.allowed_role);
    }
    return map;
  }, [roomRoleMappings]);

  /**
   * 공간 유형에 따라 배정 가능한 직원 반환
   * AC-8 T-20260515-foot-SPACE-ASSIGN-REVAMP:
   * 레이저실은 room_role_mapping 미설정 시 technician(장비명) 역할만 기본값으로 동적 조회.
   * 현장에서 직원>[장비명] 탭에 항목 추가 → 레이저실 드롭다운에 즉시 반영됨.
   */
  const getFilteredStaff = (roomType: string): Staff[] => {
    const allowed = roomTypeAllowedRoles[roomType];
    if (!allowed || allowed.length === 0) {
      // AC-8: 레이저실은 mapping 미설정 시 장비명(technician) 역할 기본
      if (roomType === 'laser') return staffList.filter(s => s.role === 'technician');
      return staffList;
    }
    return staffList.filter(s => allowed.includes(s.role));
  };

  // AC-1 T-20260515: 마지막 저장된 스냅샷 로드 (날짜 무관)
  // T-20260523-foot-SPACE-DASH-SYNC 정정 2026-05-24: MAX(created_at) 기준 (saved_at 프록시, 전날 하드코딩 금지)
  // T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (회귀 복구):
  //   기존 "MAX(created_at) 날짜의 row만 로드"는 당일(today) 부분 저장이 1건이라도 생기면
  //   그 부분 스냅샷이 직전 풀 스냅샷 carry-over를 통째로 가려 "리셋"처럼 보이는 결함이 있었다.
  //   → baseline(today 이전 최신 날짜의 풀 스냅샷) + today(부분) 를 room_name 기준 머지한다.
  //     today 행이 있으면 해당 방은 today 우선, 없으면 baseline carry-over 유지.
  //   데이터 무손실: 어떤 행도 삭제/변경하지 않고 읽기 머지만 수행.
  const { data: assignmentBundle } = useQuery<{
    rows: RoomAssignmentRow[];
    hasToday: boolean;
    baselineDate: string | null;
  }>({
    queryKey: ['room_assignments_latest', clinic.id, todayStr],
    queryFn: async () => {
      // 1) 당일(today) 행
      const { data: todayRows, error: todayErr } = await supabase
        .from('room_assignments')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('date', todayStr);
      if (todayErr) throw todayErr;

      // 2) baseline: today 이전 가장 최근 날짜의 스냅샷 (풀 carry-over 기준)
      const { data: priorMax } = await supabase
        .from('room_assignments')
        .select('date')
        .eq('clinic_id', clinic.id)
        .lt('date', todayStr)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      let baselineRows: RoomAssignmentRow[] = [];
      if (priorMax?.date) {
        const { data, error } = await supabase
          .from('room_assignments')
          .select('*')
          .eq('clinic_id', clinic.id)
          .eq('date', priorMax.date);
        if (error) throw error;
        baselineRows = (data ?? []) as RoomAssignmentRow[];
      }

      // 3) 머지: baseline 먼저 깔고 today 로 덮어쓰기 (room_name 기준, today 우선)
      const byRoom = new Map<string, RoomAssignmentRow>();
      for (const r of baselineRows) byRoom.set(r.room_name, r);
      for (const r of (todayRows ?? []) as RoomAssignmentRow[]) byRoom.set(r.room_name, r);

      return {
        rows: Array.from(byRoom.values()),
        hasToday: (todayRows ?? []).length > 0,
        baselineDate: priorMax?.date ?? null,
      };
    },
  });

  const assignments = useMemo(() => assignmentBundle?.rows ?? [], [assignmentBundle]);

  // "마지막 저장" 라벨: 당일 저장이 있으면 today, 없으면 carry-over 기준 baseline 날짜
  const lastSavedDate = assignmentBundle
    ? (assignmentBundle.hasToday ? todayStr : assignmentBundle.baselineDate)
    : null;

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
      heated_laser: [],
    };
    for (const r of rooms) map[r.room_type].push(r);
    return map;
  }, [rooms]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room_assignments_latest', clinic.id] });
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

  // AC-3 T-20260515: 배정 변경 → 로컬 버퍼에만 기록 (즉시 저장 X)
  const handlePendingChange = (roomName: string, staffId: string) => {
    setPending(prev => ({ ...prev, [roomName]: staffId }));
    setIsDirty(true);
  };

  // pending 우선, 없으면 서버 상태
  const getEffectiveStaffId = (roomName: string): string => {
    if (roomName in pending) return pending[roomName];
    return assignmentByRoom.get(roomName)?.staff_id ?? '';
  };

  // AC-3 T-20260515: [저장] 버튼 — 오늘 날짜로 전체 스냅샷 저장
  // T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN, 회귀 근본 수정):
  //   기존: 비원자적 DELETE → INSERT. DELETE 성공 후 INSERT 가 (네트워크/일시 오류로) 실패하면
  //         today 행이 통째로 비워진 채 남아 → 재진입 시 직전날 carry-over 만 표시 = "리셋" 회귀.
  //         또한 DELETE 가 RLS 로 0-row silent(error null) 가능 → 반만 적용/혼란.
  //   수정: save_room_assignments RPC 단일 트랜잭션으로 DELETE+INSERT 원자 처리.
  //         INSERT 실패 시 DELETE 롤백 → today 보존(데이터 무손실). 권한/오류는 RPC 가 명시적
  //         에러로 반환 → 아래에서 항상 실패 토스트 노출 (silent 금지, AC-저장-2).
  const handleSave = async () => {
    setSaving(true);
    try {
      const today = todayStr; // const todayStr = format(new Date(), 'yyyy-MM-dd') — 컴포넌트 스코프

      // 머지된 effective 세트 전체를 payload 로 구성 (배정된 방만)
      const payload = rooms
        .map(room => {
          const staffId = getEffectiveStaffId(room.name);
          if (!staffId) return null;
          const staff = staffList.find(s => s.id === staffId);
          return {
            room_name: room.name,
            room_type: room.room_type,
            staff_id: staffId,
            staff_name: staff?.name ?? null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const { data: savedCount, error } = await supabase.rpc('save_room_assignments', {
        p_clinic_id: clinic.id,
        p_date: today,
        p_assignments: payload,
      });

      if (error) {
        toast.error(`저장 실패: ${error.message}`);
        return;
      }

      toast.success(`공간배정 저장됨 (${savedCount ?? payload.length}건)`);
      setPending({});
      setIsDirty(false);
      refresh();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          {roomView === 'daily' ? (
            <div className="flex items-center gap-3">
              {/* AC-1 T-20260515: 마지막 저장 날짜 표시 */}
              <span className="text-sm text-muted-foreground">
                {lastSavedDate ? `마지막 저장: ${lastSavedDate}` : '저장된 배정 없음'}
              </span>
              {/* AC-3 T-20260515: [저장] 버튼 */}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                variant={isDirty ? 'default' : 'outline'}
                className={isDirty ? 'bg-teal-600 hover:bg-teal-700 text-white' : ''}
              >
                {saving ? '저장 중…' : isDirty ? '저장 *' : '저장'}
              </Button>
            </div>
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
              배정 {rooms.filter(r => getEffectiveStaffId(r.name)).length} / 공간 {rooms.length}
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
                      // AC-6: C5 보라색 테두리 + "원장실" 라벨
                      const isC5 = room.name === 'C5' && room.room_type === 'treatment';
                      // AC-9: 레이저실은 "장비 선택" placeholder
                      const isLaser = room.room_type === 'laser';
                      // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1/B2: 비활성 방 판정
                      const isInactive = inactiveRoomNames.has(room.name);
                      const isToggling = togglingRoom === room.name;
                      return (
                        <div
                          key={room.id}
                          data-testid={`room-row-${room.name}`}
                          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                            isC5 && !isInactive ? 'border-2 border-purple-400 bg-card'
                            : isInactive ? 'border border-gray-200 bg-gray-50 opacity-60'
                            : 'border bg-card'
                          }`}
                        >
                          <div className="w-20 shrink-0">
                            {/* AC-B2: 비활성 방 취소선 */}
                            <span className={`font-medium ${isInactive ? 'line-through text-gray-400' : ''}`}>
                              {room.name}
                            </span>
                            {isC5 && !isInactive && (
                              <span className="ml-1 text-xs text-purple-600">원장실</span>
                            )}
                            {/* AC-B2: 비활성 배지 */}
                            {isInactive && (
                              <span className="ml-1 text-xs text-gray-400 font-normal">비활성</span>
                            )}
                          </div>
                          <select
                            className={`h-8 flex-1 rounded-md border px-2 text-sm ${
                              isInactive ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-background'
                            }`}
                            value={isInactive ? '' : getEffectiveStaffId(room.name)}
                            onChange={(e) => !isInactive && handlePendingChange(room.name, e.target.value)}
                            disabled={isInactive}
                            title={isInactive ? '비활성 방 — 배정 불가' : (
                              roomTypeAllowedRoles[room.room_type]?.length
                                ? `배정 가능: ${roomTypeAllowedRoles[room.room_type].map(r => ROLE_LABEL[r as Staff['role']] ?? r).join(', ')}`
                                : '전체 직원 배정 가능'
                            )}
                          >
                            {/* AC-9: 레이저실 placeholder = 장비 선택 */}
                            <option value="">{isInactive ? '— 비활성 —' : isLaser ? '— 장비 선택 —' : '— 미배정 —'}</option>
                            {!isInactive && getFilteredStaff(room.room_type).map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          {/* AC-B1: 비활성화 토글 버튼 */}
                          <button
                            type="button"
                            data-testid={`room-toggle-${room.name}`}
                            onClick={() => handleRoomToggle(room.name)}
                            disabled={isToggling}
                            title={isInactive ? `${room.name} 활성화` : `${room.name} 비활성화 (당일 한정)`}
                            className={`shrink-0 rounded p-1 transition-colors ${
                              isInactive
                                ? 'text-gray-400 hover:text-teal-600 hover:bg-teal-50'
                                : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                            } disabled:opacity-40`}
                          >
                            {isInactive ? (
                              <Power className="h-3.5 w-3.5" />
                            ) : (
                              <PowerOff className="h-3.5 w-3.5" />
                            )}
                          </button>
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
                            title={roomTypeAllowedRoles[room.room_type]?.length
                              ? `배정 가능: ${roomTypeAllowedRoles[room.room_type].map(r => ROLE_LABEL[r as Staff['role']] ?? r).join(', ')}`
                              : undefined}
                          >
                            <option value="">—</option>
                            {getFilteredStaff(room.room_type).map((s) => (
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
// 클리닉 설정 탭 — T-20260502-foot-LASER-TIME-UNIT
// ============================================================

// T-20260504-foot-TREATMENT-SIMPLIFY: 10분 추가, 12분 제거 (현장 요청)
const DEFAULT_LASER_TIME_UNITS = [10, 15, 20, 30];
const LASER_TIME_PRESETS = [10, 12, 15, 18, 20, 25, 30, 40, 45, 60];

function ClinicSettingsTab({ clinic, onSaved }: { clinic: Clinic; onSaved: () => void }) {
  const qc = useQueryClient();

  // 현재 설정된 레이저 시간 단위 목록
  const [units, setUnits] = useState<number[]>(
    clinic.laser_time_units?.length ? [...clinic.laser_time_units] : [...DEFAULT_LASER_TIME_UNITS],
  );
  const [customInput, setCustomInput] = useState('');
  const [saving, setSaving] = useState(false);

  // clinic prop 변경 시 동기화
  useEffect(() => {
    if (clinic.laser_time_units?.length) {
      setUnits([...clinic.laser_time_units]);
    }
  }, [clinic.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleUnit = (min: number) => {
    setUnits((prev) =>
      prev.includes(min) ? prev.filter((u) => u !== min) : [...prev, min].sort((a, b) => a - b),
    );
  };

  const addCustom = () => {
    const val = parseInt(customInput, 10);
    if (!val || val < 1 || val > 180) {
      toast.error('1~180 사이 숫자를 입력하세요');
      return;
    }
    if (!units.includes(val)) {
      setUnits((prev) => [...prev, val].sort((a, b) => a - b));
    }
    setCustomInput('');
  };

  const save = async () => {
    if (units.length === 0) {
      toast.error('최소 1개 이상의 시간 단위를 선택하세요');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('clinics')
      .update({ laser_time_units: units })
      .eq('id', clinic.id);
    setSaving(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    // clinic 캐시 초기화 (React Query + 모듈 레벨)
    clearClinicCache();
    qc.invalidateQueries({ queryKey: ['clinic'] });
    toast.success('레이저 시간 단위 저장됨');
    onSaved();
  };

  const reset = () => {
    setUnits([...DEFAULT_LASER_TIME_UNITS]);
  };

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4 text-teal-600" />
            레이저 시간 단위 설정
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            체크인 상세 화면에서 레이저 시간 선택 시 표시되는 버튼 목록을 설정합니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 프리셋 토글 */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">시간 단위 선택</Label>
            <div className="flex flex-wrap gap-2">
              {LASER_TIME_PRESETS.map((min) => {
                const active = units.includes(min);
                return (
                  <button
                    key={min}
                    type="button"
                    onClick={() => toggleUnit(min)}
                    className={`min-w-[56px] h-10 rounded-lg border text-sm font-medium transition ${
                      active
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-input hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {min}분
                  </button>
                );
              })}
            </div>
          </div>

          {/* 직접 입력 */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">직접 추가</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={180}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="분 입력"
                className="w-28 h-9"
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              />
              <span className="text-xs text-muted-foreground">분</span>
              <Button size="sm" variant="outline" onClick={addCustom}>추가</Button>
            </div>
          </div>

          {/* 현재 선택된 단위 */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">현재 설정된 단위</Label>
            {units.length === 0 ? (
              <div className="text-xs text-muted-foreground">선택된 단위가 없습니다</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {units.map((min) => (
                  <span
                    key={min}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-800"
                  >
                    {min}분
                    <button
                      type="button"
                      onClick={() => setUnits((prev) => prev.filter((u) => u !== min))}
                      className="text-teal-500 hover:text-teal-800 transition"
                      title="제거"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={save} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white">
              {saving ? '저장 중…' : '저장'}
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              기본값으로
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
