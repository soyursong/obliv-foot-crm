import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfWeek, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import {
  closeTimeFor,
  generateSlots,
  isOpenDay,
  openTimeFor,
  WEEK_DAYS_KO,
} from '@/lib/schedule';
import { VISIT_TYPE_KO } from '@/lib/status';
import { maskPhoneTail } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Clinic, Customer, Reservation, Service, VisitType } from '@/lib/types';

const STATUS_STYLE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
  checked_in: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  noshow: 'bg-red-100 text-red-700 border-red-200',
};

const VISIT_TYPE_STYLE: Record<VisitType, string> = {
  new: 'border-l-[3px] border-l-blue-500 bg-blue-50/60',
  returning: 'border-l-[3px] border-l-emerald-500 bg-emerald-50/60',
  experience: 'border-l-[3px] border-l-amber-500 bg-amber-50/60',
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  noshow: '노쇼',
};

interface ReservationDraft {
  date: string;
  time: string;
  name: string;
  phone: string;
  visit_type: VisitType;
  memo: string;
  existingId?: string;
  service_id?: string | null;
  customer_id?: string | null;
}

type ViewMode = 'week' | 'day';

export default function Reservations() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  const [editor, setEditor] = useState<ReservationDraft | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [noshowByCustomer, setNoshowByCustomer] = useState<Record<string, number>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  const weekDays = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => addDays(weekStart, i)), // 월~토만
    [weekStart],
  );

  const fetchWeek = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const startStr = viewMode === 'week'
      ? format(weekDays[0], 'yyyy-MM-dd')
      : format(selectedDay, 'yyyy-MM-dd');
    const endStr = viewMode === 'week'
      ? format(weekDays[weekDays.length - 1], 'yyyy-MM-dd')
      : startStr;
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('clinic_id', clinic.id)
      .gte('reservation_date', startStr)
      .lte('reservation_date', endStr)
      .order('reservation_time', { ascending: true });
    if (error) {
      toast.error('예약 목록 로딩 실패');
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Reservation[];

    // Auto noshow: past confirmed reservations
    const today = format(new Date(), 'yyyy-MM-dd');
    const pastConfirmed = list.filter(
      (r) => r.status === 'confirmed' && r.reservation_date < today,
    );
    if (pastConfirmed.length > 0) {
      await supabase
        .from('reservations')
        .update({ status: 'noshow' })
        .in('id', pastConfirmed.map((r) => r.id));
      for (const r of pastConfirmed) r.status = 'noshow';
    }

    setRows(list);
    setLoading(false);

    // 노쇼 이력 집계
    const customerIds = Array.from(
      new Set(list.map((r) => r.customer_id).filter((x): x is string => !!x)),
    );
    if (customerIds.length > 0) {
      const { data: nsData } = await supabase
        .from('reservations')
        .select('customer_id')
        .in('customer_id', customerIds)
        .eq('status', 'noshow');
      const counts: Record<string, number> = {};
      for (const row of nsData ?? []) {
        const id = (row as { customer_id: string | null }).customer_id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
      setNoshowByCustomer(counts);
    } else {
      setNoshowByCustomer({});
    }
  }, [clinic, weekDays, viewMode, selectedDay]);

  useEffect(() => {
    fetchWeek();
  }, [fetchWeek]);

  // Realtime
  useEffect(() => {
    if (!clinic) return;
    const ch = supabase
      .channel(`reservations_${clinic.id}_${format(weekStart, 'yyyyMMdd')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => fetchWeek(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [clinic, weekStart, fetchWeek]);

  const slotsFor = useCallback(
    (d: Date): string[] => {
      if (!clinic) return [];
      return generateSlots(openTimeFor(clinic), closeTimeFor(d, clinic), clinic.slot_interval);
    },
    [clinic],
  );

  const resvByKey = useMemo(() => {
    const map: Record<string, Reservation[]> = {};
    for (const r of rows) {
      const key = `${r.reservation_date}_${r.reservation_time.slice(0, 5)}`;
      (map[key] ??= []).push(r);
    }
    return map;
  }, [rows]);

  const slotActiveCount = useCallback(
    (dateStr: string, time: string) => {
      const list = resvByKey[`${dateStr}_${time}`] ?? [];
      return list.filter((r) => r.status !== 'cancelled').length;
    },
    [resvByKey],
  );

  const isSlotFull = useCallback(
    (dateStr: string, time: string) => {
      if (!clinic) return false;
      return slotActiveCount(dateStr, time) >= clinic.max_per_slot;
    },
    [clinic, slotActiveCount],
  );

  const openNewSlot = (d: Date, time: string) => {
    setEditor({
      date: format(d, 'yyyy-MM-dd'),
      time,
      name: '',
      phone: '',
      visit_type: 'returning',
      memo: '',
    });
  };

  const openEdit = (r: Reservation) => {
    setEditor({
      existingId: r.id,
      date: r.reservation_date,
      time: r.reservation_time.slice(0, 5),
      name: r.customer_name ?? '',
      phone: r.customer_phone ?? '',
      visit_type: r.visit_type,
      memo: r.memo ?? '',
    });
    setDetail(null);
  };

  const batchCheckIn = async (confirmed: Reservation[]) => {
    if (!clinic || confirmed.length === 0) return;
    if (!window.confirm(`${confirmed.length}건의 예약을 일괄 체크인하시겠습니까?`)) return;
    const payload = confirmed.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customer_name ?? '',
      customer_phone: r.customer_phone,
      visit_type: r.visit_type,
      reservation_date: r.reservation_date,
    }));
    const { data, error } = await supabase.rpc('batch_checkin', {
      p_clinic_id: clinic.id,
      p_reservations: payload,
    });
    if (error) {
      toast.error(`일괄 체크인 실패: ${error.message}`);
      return;
    }
    const result = data as { success: number; skipped: number };
    const msg = result.skipped > 0
      ? `${result.success}건 체크인, ${result.skipped}건 중복 스킵`
      : `${result.success}건 일괄 체크인 완료`;
    toast.success(msg);
    fetchWeek();
  };

  const reschedule = async (reservationId: string, newDate: string, newTime: string) => {
    if (!clinic) return;
    const r = rows.find((x) => x.id === reservationId);
    if (!r || r.status !== 'confirmed') return;
    if (r.reservation_date === newDate && r.reservation_time.slice(0, 5) === newTime) return;

    const activeCount = slotActiveCount(newDate, newTime);
    if (activeCount >= clinic.max_per_slot) {
      toast.error(`이 시간대는 마감입니다 (${activeCount}/${clinic.max_per_slot})`);
      return;
    }

    const oldData = { date: r.reservation_date, time: r.reservation_time.slice(0, 5) };
    const newData = { date: newDate, time: newTime };

    const { error } = await supabase
      .from('reservations')
      .update({ reservation_date: newDate, reservation_time: newTime })
      .eq('id', reservationId);
    if (error) { toast.error(`이동 실패: ${error.message}`); return; }

    await supabase.from('reservation_logs').insert({
      reservation_id: reservationId,
      clinic_id: clinic.id,
      action: 'reschedule',
      old_data: oldData,
      new_data: newData,
    });

    toast.success(`${r.customer_name} 예약 이동: ${oldData.date} ${oldData.time} → ${newData.date} ${newData.time}`);
    fetchWeek();
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (e: React.DragEvent, dateStr: string, time: string) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (id) reschedule(id, dateStr, time);
    setDraggedId(null);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart((w) => addDays(w, -7));
              else setSelectedDay((d) => addDays(d, -1));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[200px] text-center text-sm font-medium">
            {viewMode === 'week'
              ? `${format(weekDays[0], 'yyyy년 M월 d일', { locale: ko })} ~ ${format(weekDays[5], 'M월 d일')}`
              : format(selectedDay, 'yyyy년 M월 d일 (EEE)', { locale: ko })
            }
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart((w) => addDays(w, 7));
              else setSelectedDay((d) => addDays(d, 1));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
              else setSelectedDay(new Date());
            }}
          >
            {viewMode === 'week' ? '이번 주' : '오늘'}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <button
              onClick={() => setViewMode('day')}
              className={cn('px-3 py-1 text-xs font-medium transition', viewMode === 'day' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
            >
              일간
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={cn('px-3 py-1 text-xs font-medium transition', viewMode === 'week' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
            >
              주간
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60">
              <tr>
                <th className="w-20 border-b border-r py-2 text-xs font-medium text-muted-foreground">
                  시간
                </th>
                {(viewMode === 'week' ? weekDays : [selectedDay]).map((d, i) => (
                  <th
                    key={d.toISOString()}
                    className={cn(
                      'border-b border-r p-2 text-left text-xs font-medium',
                      !isOpenDay(d) && 'bg-gray-50 text-muted-foreground',
                      isSameDay(d, new Date()) && 'bg-teal-50 text-teal-700',
                    )}
                  >
                    {WEEK_DAYS_KO[i]} {format(d, 'M/d')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clinic &&
                generateSlots(clinic.open_time, clinic.close_time, clinic.slot_interval).map(
                  (time) => (
                    <tr key={time}>
                      <td className="w-20 border-b border-r py-1.5 text-center text-xs font-medium text-muted-foreground">
                        {time}
                      </td>
                      {(viewMode === 'week' ? weekDays : [selectedDay]).map((d) => {
                        const allowed = slotsFor(d).includes(time);
                        const dateStr = format(d, 'yyyy-MM-dd');
                        const key = `${dateStr}_${time}`;
                        const list = resvByKey[key] ?? [];
                        const full = isSlotFull(dateStr, time);
                        const activeCount = slotActiveCount(dateStr, time);
                        const cellKey = `${dateStr}_${time}`;
                        const isDragOver = dropTarget === cellKey;
                        return (
                          <td
                            key={d.toISOString() + time}
                            className={cn(
                              'h-12 border-b border-r p-1 align-top transition-colors',
                              !allowed && 'bg-gray-50',
                              full && !isDragOver && 'bg-red-50',
                              isDragOver && allowed && !full && 'bg-teal-50 ring-2 ring-inset ring-teal-400',
                              isDragOver && full && 'bg-red-100 ring-2 ring-inset ring-red-400',
                            )}
                            onDragOver={(e) => { if (allowed) { e.preventDefault(); setDropTarget(cellKey); } }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => { if (allowed) handleDrop(e, dateStr, time); }}
                          >
                            {allowed && (
                              <div className="flex h-full w-full flex-col gap-0.5 rounded text-left">

                                {list.map((r) => (
                                  <div
                                    key={r.id}
                                    draggable={r.status === 'confirmed'}
                                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, r.id); }}
                                    onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDetail(r);
                                    }}
                                    className={cn(
                                      'rounded border px-1.5 py-0.5 text-xs leading-tight',
                                      r.status === 'confirmed' && 'cursor-grab active:cursor-grabbing',
                                      draggedId === r.id && 'opacity-40',
                                      STATUS_STYLE[r.status],
                                      VISIT_TYPE_STYLE[r.visit_type],
                                    )}
                                  >
                                    <div className="flex items-center gap-1">
                                      <span className="font-semibold">{r.customer_name}</span>
                                      {r.customer_id && noshowByCustomer[r.customer_id] ? (
                                        <Badge variant="destructive" className="h-4 px-1 text-xs">
                                          노쇼 {noshowByCustomer[r.customer_id]}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="text-xs opacity-80 flex items-center gap-1">
                                      <span className={cn(
                                        'inline-block h-1.5 w-1.5 rounded-full',
                                        r.visit_type === 'new' ? 'bg-blue-500' : 'bg-emerald-500',
                                      )} />
                                      {VISIT_TYPE_KO[r.visit_type]} · {STATUS_LABEL[r.status]}
                                    </div>
                                  </div>
                                ))}
                                {(() => {
                                  const confirmed = list.filter((r) => r.status === 'confirmed');
                                  return confirmed.length > 0 ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        batchCheckIn(confirmed);
                                      }}
                                      className="w-full mt-0.5 rounded bg-teal-50 border border-teal-200 px-1 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100 transition"
                                    >
                                      일괄 배치 ({confirmed.length})
                                    </button>
                                  ) : null;
                                })()}
                                {!full ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openNewSlot(d, time); }}
                                    className={cn(
                                      'flex items-center justify-center rounded border border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600 transition',
                                      list.length === 0 ? 'flex-1 min-h-[24px]' : 'h-5 w-full mt-0.5',
                                    )}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                ) : list.length === 0 ? (
                                  <span className="m-auto text-xs font-medium text-red-500">마감</span>
                                ) : null}
                                {clinic && activeCount > 0 && (
                                  <span className={cn(
                                    'mt-auto self-end text-[10px] tabular-nums',
                                    full ? 'text-red-500 font-medium' : 'text-muted-foreground',
                                  )}>
                                    {activeCount}/{clinic.max_per_slot}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ),
                )}
            </tbody>
          </table>
        )}
      </div>

      <ReservationEditor
        draft={editor}
        clinicId={clinic?.id}
        maxPerSlot={clinic?.max_per_slot ?? 5}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          fetchWeek();
        }}
      />

      <ReservationDetail
        reservation={detail}
        noshowCount={
          detail?.customer_id ? noshowByCustomer[detail.customer_id] ?? 0 : 0
        }
        onClose={() => setDetail(null)}
        onEdit={openEdit}
        onChanged={() => {
          setDetail(null);
          fetchWeek();
        }}
      />
    </div>
  );
}

function ReservationEditor({
  draft,
  clinicId,
  maxPerSlot,
  onClose,
  onSaved,
}: {
  draft: ReservationDraft | null;
  clinicId: string | undefined;
  maxPerSlot: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<ReservationDraft | null>(draft);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    setState(draft);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearch(false);
  }, [draft]);

  useEffect(() => {
    if (!clinicId) return;
    supabase
      .from('services')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setServices((data ?? []) as Service[]));
  }, [clinicId]);

  if (!state) return null;

  const update = <K extends keyof ReservationDraft>(k: K, v: ReservationDraft[K]) =>
    setState((s) => (s ? { ...s, [k]: v } : s));

  const searchCustomer = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim() || !clinicId) { setSearchResults([]); return; }
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('clinic_id', clinicId)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setSearchResults((data ?? []) as Customer[]);
    setShowSearch(true);
  };

  const selectCustomer = (c: Customer) => {
    setState((s) => s ? { ...s, name: c.name, phone: c.phone, customer_id: c.id, visit_type: 'returning' } : s);
    setShowSearch(false);
    setSearchQuery('');
    toast.info(`${c.name}님 선택`);
  };

  const handlePhoneBlur = async () => {
    if (!state.phone.trim() || !clinicId) return;
    const { data } = await supabase
      .from('customers')
      .select('id, name, visit_type')
      .eq('clinic_id', clinicId)
      .eq('phone', state.phone.trim())
      .maybeSingle();
    if (data) {
      setState((s) =>
        s
          ? {
              ...s,
              name: s.name || (data.name as string),
              customer_id: data.id as string,
              visit_type: s.visit_type === 'new' ? 'returning' : s.visit_type,
            }
          : s,
      );
      toast.info(`${data.name}님 - 기존 고객`);
    }
  };

  const save = async () => {
    if (!clinicId || !state) return;
    setSubmitting(true);

    if (!state.existingId) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('reservation_date', state.date)
        .eq('reservation_time', state.time)
        .neq('status', 'cancelled');
      if ((count ?? 0) >= maxPerSlot) {
        toast.error(`이 시간대는 마감입니다 (${count}/${maxPerSlot})`);
        setSubmitting(false);
        return;
      }
    }

    let customerId: string | null = state.customer_id ?? null;

    if (!state.existingId && customerId) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('reservation_date', state.date)
        .neq('status', 'cancelled');
      if ((count ?? 0) > 0) {
        if (!window.confirm(`${state.name}님은 이미 ${state.date}에 예약이 있습니다. 계속하시겠습니까?`)) {
          setSubmitting(false);
          return;
        }
      }
    }

    if (!customerId && state.phone.trim()) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', state.phone.trim())
        .maybeSingle();
      if (existing) customerId = existing.id as string;
      else {
        const { data: created, error } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: state.name.trim(),
            phone: state.phone.trim(),
            visit_type: state.visit_type === 'new' ? 'new' : 'returning',
          })
          .select('id')
          .single();
        if (error) {
          toast.error(error.code === '23505' ? '이미 등록된 전화번호입니다' : `고객 생성 실패: ${error.message}`);
          setSubmitting(false);
          return;
        }
        customerId = (created as { id: string }).id;
      }
    }

    const payload = {
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: state.name.trim(),
      customer_phone: state.phone.trim() || null,
      reservation_date: state.date,
      reservation_time: state.time,
      visit_type: state.visit_type,
      service_id: state.service_id || null,
      memo: state.memo.trim() || null,
    };

    const { error } = state.existingId
      ? await supabase.from('reservations').update(payload).eq('id', state.existingId)
      : await supabase.from('reservations').insert({ ...payload, status: 'confirmed' });

    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      setSubmitting(false);
      return;
    }
    toast.success(state.existingId ? '수정됨' : '예약 등록');
    setSubmitting(false);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.existingId ? '예약 수정' : '예약 등록'} · {state.date} {state.time}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!state.existingId && (
            <div className="space-y-1.5 relative">
              <Label>고객 검색</Label>
              <Input
                value={searchQuery}
                onChange={(e) => searchCustomer(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowSearch(true)}
                placeholder="이름 또는 전화번호 검색"
              />
              {showSearch && searchResults.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-md max-h-40 overflow-auto">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition text-left"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {state.customer_id && (
                <div className="text-xs text-teal-700">기존 고객 연결됨</div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <Input
              value={state.phone}
              onChange={(e) => update('phone', e.target.value)}
              onBlur={handlePhoneBlur}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>이름</Label>
            <Input value={state.name} onChange={(e) => update('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['new', 'returning', 'experience'] as VisitType[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update('visit_type', v)}
                  className={cn(
                    'h-9 rounded-md border text-sm font-medium',
                    state.visit_type === v
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {VISIT_TYPE_KO[v]}
                </button>
              ))}
            </div>
          </div>
          {services.length > 0 && (
            <div className="space-y-1.5">
              <Label>서비스</Label>
              <select
                value={state.service_id ?? ''}
                onChange={(e) => update('service_id', e.target.value || null)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">선택 안 함</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_min}분)
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={state.memo} onChange={(e) => update('memo', e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button disabled={submitting || !state.name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReservationLog {
  id: string;
  action: string;
  old_data: Record<string, string> | null;
  new_data: Record<string, string> | null;
  created_at: string;
}

function ReservationDetail({
  reservation,
  noshowCount,
  onClose,
  onEdit,
  onChanged,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ReservationLog[]>([]);

  useEffect(() => {
    if (!reservation) { setLogs([]); return; }
    supabase
      .from('reservation_logs')
      .select('id, action, old_data, new_data, created_at')
      .eq('reservation_id', reservation.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setLogs((data ?? []) as ReservationLog[]));
  }, [reservation]);

  if (!reservation) return null;

  const setStatus = async (status: Reservation['status']) => {
    setBusy(true);
    const { error } = await supabase
      .from('reservations')
      .update({ status })
      .eq('id', reservation.id);
    if (error) {
      toast.error(`업데이트 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'status_change',
      old_data: { status: reservation.status },
      new_data: { status },
    });
    setBusy(false);
    toast.success(`상태 변경: ${STATUS_LABEL[status]}`);
    onChanged();
  };

  const convertToCheckIn = async () => {
    setBusy(true);
    const { data: existing } = await supabase
      .from('check_ins')
      .select('id')
      .eq('reservation_id', reservation.id)
      .maybeSingle();
    if (existing) {
      toast.info('이미 이 예약으로 체크인이 생성되어 있습니다');
      setBusy(false);
      return;
    }
    const { data: queueData, error: qErr } = await supabase.rpc('next_queue_number', {
      p_clinic_id: reservation.clinic_id,
      p_date: reservation.reservation_date,
    });
    if (qErr) {
      toast.error(`대기번호 생성 실패: ${qErr.message}`);
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('check_ins').insert({
      clinic_id: reservation.clinic_id,
      customer_id: reservation.customer_id,
      reservation_id: reservation.id,
      customer_name: reservation.customer_name ?? '',
      customer_phone: reservation.customer_phone,
      visit_type: reservation.visit_type,
      status: 'registered',
      queue_number: queueData as number,
    });
    if (error) {
      toast.error(`체크인 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    await supabase
      .from('reservations')
      .update({ status: 'checked_in' })
      .eq('id', reservation.id);
    toast.success('체크인 완료');
    setBusy(false);
    onChanged();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reservation.customer_name} · {reservation.reservation_date}{' '}
            {reservation.reservation_time.slice(0, 5)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="teal">{VISIT_TYPE_KO[reservation.visit_type]}</Badge>
            <Badge>{STATUS_LABEL[reservation.status]}</Badge>
            {noshowCount > 0 && <Badge variant="destructive">노쇼 {noshowCount}회</Badge>}
          </div>
          {reservation.customer_phone && (
            <div className="text-muted-foreground">
              {reservation.customer_phone} (뒤 4자리 ···{maskPhoneTail(reservation.customer_phone)})
            </div>
          )}
          {reservation.memo && (
            <div className="rounded border bg-muted/30 p-2 whitespace-pre-wrap">
              {reservation.memo}
            </div>
          )}
          {logs.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <div className="text-xs font-medium text-muted-foreground">변경 이력</div>
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{format(new Date(l.created_at), 'MM/dd HH:mm')}</span>
                  <span>
                    {l.action === 'reschedule'
                      ? `일정 변경: ${l.old_data?.date} ${l.old_data?.time} → ${l.new_data?.date} ${l.new_data?.time}`
                      : l.action === 'status_change'
                        ? `상태: ${STATUS_LABEL[(l.old_data?.status as Reservation['status']) ?? 'confirmed']} → ${STATUS_LABEL[(l.new_data?.status as Reservation['status']) ?? 'confirmed']}`
                        : l.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(reservation)}>
            수정
          </Button>
          {reservation.status === 'confirmed' && (
            <>
              <Button size="sm" disabled={busy} onClick={convertToCheckIn}>
                체크인 전환
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                if (window.confirm(`${reservation.customer_name}님을 노쇼 처리하시겠습니까?`)) setStatus('noshow');
              }}>
                노쇼
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${reservation.customer_name}님 예약을 취소하시겠습니까?`)) setStatus('cancelled');
                }}
              >
                취소
              </Button>
            </>
          )}
          {(reservation.status === 'cancelled' || reservation.status === 'noshow') && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`${reservation.customer_name}님 예약을 복원하시겠습니까?`)) setStatus('confirmed');
              }}
            >
              복원
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

