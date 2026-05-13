import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { addDays, format, parseISO, startOfWeek, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import {
  closeTimeFor,
  generateSlots,
  isOpenDay,
  openTimeFor,
  WEEK_DAYS_KO,
} from '@/lib/schedule';
import { VISIT_TYPE_KO } from '@/lib/status';
import { formatPhone, maskPhoneTail } from '@/lib/format';
import { cn } from '@/lib/utils';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import type { Reservation, VisitType } from '@/lib/types';

const STATUS_STYLE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
  checked_in: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  noshow: 'bg-red-100 text-red-700 border-red-200',
};

// 초진(파란) / 재진(초록) / 선체험(amber)
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
  booking_memo: string;  // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용
  visit_route?: string;  // AC-5: 초진/예약없이방문 방문경로 (customers.visit_route에 저장)
  existingId?: string;
  service_id?: string | null;
  customer_id?: string | null;
}

type ViewMode = 'week' | 'day';

export default function Reservations() {
  const location = useLocation();
  const { profile } = useAuth();
  const changedBy = profile?.id ?? null;
  const clinic = useClinic();
  const navStateConsumed = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  // T-20260514-foot-CHART-NO-VISIBLE: AC-2 예약관리 차트번호 컬럼 (customer_id → chart_number)
  const [resvChartMap, setResvChartMap] = useState<Map<string, string>>(new Map());

  const [editor, setEditor] = useState<ReservationDraft | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [noshowByCustomer, setNoshowByCustomer] = useState<Record<string, number>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const weekDays = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => addDays(weekStart, i)), // 월~토만
    [weekStart],
  );

  // 대시보드 예약하기 바로가기 → location.state.openReservationFor 처리
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (!clinic) return;
    const state = location.state as {
      openReservationFor?: {
        customer_id: string | null;
        name: string;
        phone: string;
        visit_type: VisitType;
      };
    } | null;
    if (!state?.openReservationFor) return;
    navStateConsumed.current = true;
    window.history.replaceState({}, '');
    const { name, phone, visit_type, customer_id } = state.openReservationFor;
    const today = format(new Date(), 'yyyy-MM-dd');
    setEditor({
      date: today,
      time: '10:00',
      name: name ?? '',
      phone: phone ?? '',
      visit_type,
      memo: '',
      booking_memo: '',
      visit_route: '',
      customer_id: customer_id ?? null,
    });
  }, [clinic, location.state]);

  // AC-7: 좌측 캘린더 날짜 클릭 → 해당 날짜 포함 주로 이동
  useEffect(() => {
    const state = location.state as { goToWeekOf?: string } | null;
    if (!state?.goToWeekOf) return;
    window.history.replaceState({}, '');
    const targetDate = parseISO(state.goToWeekOf);
    setWeekStart(startOfWeek(targetDate, { weekStartsOn: 1 }));
    setViewMode('week');
  }, [location.state]);

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

      // T-20260514-foot-CHART-NO-VISIBLE: AC-2 차트번호 컬럼용 사전 로드
      const { data: chartData } = await supabase
        .from('customers')
        .select('id, chart_number')
        .in('id', customerIds);
      const chartM = new Map<string, string>();
      for (const c of (chartData ?? []) as { id: string; chart_number: string | null }[]) {
        if (c.chart_number) chartM.set(c.id, c.chart_number);
      }
      setResvChartMap(chartM);
    } else {
      setNoshowByCustomer({});
      setResvChartMap(new Map());
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

  // AC-1: 시간당 초진 6건 + 재진 6건 = 합 12건 상한 (하드코딩, clinic.max_per_slot 불사용)
  const SLOT_MAX_TOTAL = 12;
  const isSlotFull = useCallback(
    (dateStr: string, time: string) => {
      return slotActiveCount(dateStr, time) >= SLOT_MAX_TOTAL;
    },
    [slotActiveCount],
  );

  const openNewSlot = (d: Date, time: string) => {
    setEditor({
      date: format(d, 'yyyy-MM-dd'),
      time,
      name: '',
      phone: '',
      visit_type: 'returning',
      memo: '',
      booking_memo: '',
      visit_route: '',
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
      booking_memo: r.booking_memo ?? '',
      visit_route: '',  // AC-5: 편집 시 기존 방문경로 미리 불러오지 않음 (변경 시에만 덮어씀)
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
    if (activeCount >= 12) {
      toast.error(`이 시간대는 마감입니다 (${activeCount}/12)`);
      return;
    }

    const oldData = { date: r.reservation_date, time: r.reservation_time.slice(0, 5) };
    const newData = { date: newDate, time: newTime };

    // 낙관적 업데이트: UI 먼저 반영
    setRows((prev) =>
      prev.map((x) =>
        x.id === reservationId
          ? { ...x, reservation_date: newDate, reservation_time: newTime }
          : x,
      ),
    );

    const { error } = await supabase
      .from('reservations')
      .update({ reservation_date: newDate, reservation_time: newTime })
      .eq('id', reservationId);
    if (error) {
      // 실패 시 롤백
      setRows((prev) =>
        prev.map((x) =>
          x.id === reservationId
            ? { ...x, reservation_date: r.reservation_date, reservation_time: r.reservation_time }
            : x,
        ),
      );
      toast.error(`이동 실패: ${error.message}`);
      return;
    }

    await supabase.from('reservation_logs').insert({
      reservation_id: reservationId,
      clinic_id: clinic.id,
      action: 'reschedule',
      old_data: oldData,
      new_data: newData,
      changed_by: changedBy,
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
          {/* T-20260513-foot-RESV-PLUS-PHONE-SEARCH: 페이지 상단 새 예약 버튼 — InlinePatientSearch(phone) 연결 */}
          <Button
            size="sm"
            onClick={() => {
              const today = format(new Date(), 'yyyy-MM-dd');
              setEditor({
                date: today,
                time: '10:00',
                name: '',
                phone: '',
                visit_type: 'returning',
                memo: '',
                booking_memo: '',
                visit_route: '',
                customer_id: null,
              });
            }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            새 예약
          </Button>
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
                generateSlots(
                  clinic.open_time,
                  // day view: 선택된 날짜의 close_time 사용 (토요일=18:30, 평일=20:30)
                  // week view: clinic.close_time(평일 최대) 기준으로 그리드 행 생성, 토요일 열은 allowed=false로 그레이아웃
                  viewMode === 'day' ? closeTimeFor(selectedDay, clinic) : clinic.close_time,
                  clinic.slot_interval,
                ).map(
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
                                      {/* RESV-CHART-CLICK: 성함 클릭 → 차트 새창 */}
                                      <span
                                        className={cn(
                                          'font-semibold',
                                          r.customer_id && 'cursor-pointer hover:underline hover:text-teal-700 transition-colors',
                                        )}
                                        onClick={(e) => {
                                          if (!r.customer_id) return;
                                          e.stopPropagation();
                                          window.open(
                                            `/chart/${r.customer_id}`,
                                            `chart-${r.customer_id}`,
                                            'width=820,height=960,scrollbars=yes,resizable=yes',
                                          );
                                        }}
                                      >
                                        {r.customer_name}
                                      </span>
                                      {/* T-20260514-foot-CHART-NO-VISIBLE: AC-2 차트번호 상시 표시 */}
                                      {r.customer_id && resvChartMap.get(r.customer_id) && (
                                        <span className="text-[10px] font-mono text-teal-600">
                                          #{resvChartMap.get(r.customer_id)}
                                        </span>
                                      )}
                                      {r.customer_id && noshowByCustomer[r.customer_id] ? (
                                        <Badge variant="destructive" className="h-4 px-1 text-xs">
                                          노쇼 {noshowByCustomer[r.customer_id]}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {/* RESV-SLOT-INFO: 방문유형·상태 + 전화번호 뒷4자리 */}
                                    <div className="text-xs opacity-80 flex items-center gap-1">
                                      <span className={cn(
                                        'inline-block h-1.5 w-1.5 rounded-full',
                                        r.visit_type === 'new' ? 'bg-blue-500' : 'bg-emerald-500',
                                      )} />
                                      {VISIT_TYPE_KO[r.visit_type]} · {STATUS_LABEL[r.status]}
                                      {r.customer_phone && (
                                        <span className="text-muted-foreground">
                                          · ···{maskPhoneTail(r.customer_phone)}
                                        </span>
                                      )}
                                    </div>
                                    {/* T-20260515-foot-INLINE-RESV AC-4: 예약메모 한눈에 표시 */}
                                    {r.booking_memo && (
                                      <div
                                        className="truncate text-[10px] text-amber-600"
                                        title={r.booking_memo}
                                      >
                                        📝 {r.booking_memo}
                                      </div>
                                    )}
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
        maxPerSlot={12}
        changedBy={changedBy}
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
        changedBy={changedBy}
        isAdmin={profile?.role === 'admin'}
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
  changedBy,
  onClose,
  onSaved,
}: {
  draft: ReservationDraft | null;
  clinicId: string | undefined;
  maxPerSlot: number;
  changedBy: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<ReservationDraft | null>(draft);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setState(draft);
  }, [draft]);

  if (!state) return null;

  const update = <K extends keyof ReservationDraft>(k: K, v: ReservationDraft[K]) =>
    setState((s) => (s ? { ...s, [k]: v } : s));

  /** 인라인 검색 드롭다운에서 기존 환자 선택 */
  const handlePatientSelect = (p: PatientMatch) => {
    setState((s) =>
      s ? { ...s, name: p.name, phone: p.phone, customer_id: p.id, visit_type: 'returning' } : s,
    );
    toast.info(`${p.name}님 선택`);
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

    // AC-5: 초진이고 방문경로 선택 시 customers.visit_route 업데이트
    if (customerId && state.visit_type === 'new' && state.visit_route) {
      await supabase
        .from('customers')
        .update({ visit_route: state.visit_route })
        .eq('id', customerId);
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
      // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용 메모
      booking_memo: state.booking_memo?.trim() || null,
    };

    // 수정 전 원본 캡처 (감사 로그용)
    let prevRow: Record<string, unknown> | null = null;
    if (state.existingId) {
      const { data: prev } = await supabase
        .from('reservations')
        .select('reservation_date, reservation_time, visit_type, customer_name, customer_phone, service_id, memo')
        .eq('id', state.existingId)
        .maybeSingle();
      prevRow = (prev as Record<string, unknown>) ?? null;
    }

    const result = state.existingId
      ? await supabase.from('reservations').update(payload).eq('id', state.existingId).select('id').maybeSingle()
      : await supabase.from('reservations').insert({ ...payload, status: 'confirmed' }).select('id').maybeSingle();

    if (result.error) {
      toast.error(`저장 실패: ${result.error.message}`);
      setSubmitting(false);
      return;
    }

    // 감사 로그 — create / update / reschedule
    const savedId = (result.data as { id: string } | null)?.id ?? state.existingId;
    if (savedId) {
      if (state.existingId && prevRow) {
        const oldTime = String(prevRow.reservation_time ?? '').slice(0, 5);
        const newTime = state.time.slice(0, 5);
        const isReschedule =
          prevRow.reservation_date !== state.date || oldTime !== newTime;
        await supabase.from('reservation_logs').insert({
          reservation_id: savedId,
          clinic_id: clinicId,
          action: isReschedule ? 'reschedule' : 'update',
          old_data: {
            date: prevRow.reservation_date,
            time: oldTime,
            visit_type: prevRow.visit_type,
            customer_name: prevRow.customer_name,
            customer_phone: prevRow.customer_phone,
            service_id: prevRow.service_id,
            memo: prevRow.memo,
          },
          new_data: {
            date: state.date,
            time: newTime,
            visit_type: state.visit_type,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            service_id: payload.service_id,
            memo: payload.memo,
          },
          changed_by: changedBy,
        });
      } else if (!state.existingId) {
        await supabase.from('reservation_logs').insert({
          reservation_id: savedId,
          clinic_id: clinicId,
          action: 'create',
          old_data: null,
          new_data: {
            date: state.date,
            time: state.time.slice(0, 5),
            visit_type: state.visit_type,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            service_id: payload.service_id,
            memo: payload.memo,
          },
          changed_by: changedBy,
        });
      }
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
          {/* 이름 — 인라인 자동검색 (신규·수정 모두 표시) */}
          <div className="space-y-1.5">
            <Label>이름</Label>
            <InlinePatientSearch
              value={state.name}
              onChange={(v) => {
                update('name', v);
                if (state.customer_id) update('customer_id', null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={() => update('customer_id', null)}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={state.customer_id}
              placeholder="홍길동"
              required
            />
          </div>
          {/* 전화번호 — 인라인 자동검색 */}
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <InlinePatientSearch
              value={state.phone}
              onChange={(v) => {
                update('phone', v);
                if (state.customer_id) update('customer_id', null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={() => update('customer_id', null)}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={state.customer_id}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['new', 'returning'] as VisitType[]).map((v) => (
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
          {/* AC-4: [서비스] 필드 제거 (DB 컬럼은 유지, UI 비노출) */}
          {/* AC-5: 방문경로 드롭다운 — 초진만 표시, 재진 미표시 */}
          {state.visit_type === 'new' && (
            <div className="space-y-1.5">
              <Label>방문경로 <span className="text-muted-foreground font-normal text-xs">(선택)</span></Label>
              <select
                value={state.visit_route ?? ''}
                onChange={(e) => update('visit_route', e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— 선택 안 함 —</option>
                <option value="TM">TM</option>
                <option value="인바운드">인바운드</option>
                <option value="워크인">워크인</option>
                <option value="지인소개">지인소개</option>
              </select>
            </div>
          )}
          {/* T-20260504-foot-MEMO-RESTRUCTURE: 예약메모 / 고객메모 분리 */}
          {/* AC-6: 예약메모 = 2번차트 1구역 예약메모와 동일 데이터(reservations.booking_memo) */}
          <div className="space-y-1.5">
            <Label>예약메모 <span className="text-muted-foreground font-normal text-xs">(예약 경로 확인용)</span></Label>
            <Textarea value={state.booking_memo ?? ''} onChange={(e) => update('booking_memo', e.target.value)} rows={2} placeholder="예: 인스타그램 광고, 지인 소개, 인바운드 전화 등" className="text-sm" />
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
  changedBy,
  isAdmin,
  onClose,
  onEdit,
  onChanged,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  changedBy: string | null;
  isAdmin?: boolean;
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

  const deleteReservation = async () => {
    if (!reservation) return;
    if (!window.confirm(`${reservation.customer_name}님 예약을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', reservation.id);
    if ((count ?? 0) > 0) {
      toast.error('체크인이 연결된 예약은 삭제할 수 없습니다');
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('reservations').delete().eq('id', reservation.id);
    setBusy(false);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('예약 삭제됨');
    onChanged();
  };

  const setStatus = async (status: Reservation['status'], action?: string) => {
    setBusy(true);
    // 복원 시 슬롯 마감 여부 재확인
    if (action === 'restore' || (status === 'confirmed' && reservation.status === 'cancelled')) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', reservation.clinic_id)
        .eq('reservation_date', reservation.reservation_date)
        .eq('reservation_time', reservation.reservation_time)
        .neq('status', 'cancelled');
      if ((count ?? 0) >= 12) {
        toast.error(`이 시간대는 마감입니다 (${count}/12). 다른 시간으로 옮긴 뒤 복원하세요.`);
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase
      .from('reservations')
      .update({ status })
      .eq('id', reservation.id);
    if (error) {
      toast.error(`업데이트 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    const resolvedAction = action
      ?? (status === 'cancelled' ? 'cancel'
        : status === 'confirmed' && reservation.status === 'cancelled' ? 'restore'
        : 'status_change');
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: resolvedAction,
      old_data: { status: reservation.status },
      new_data: { status },
      changed_by: changedBy,
    });
    setBusy(false);
    toast.success(
      resolvedAction === 'restore'
        ? '예약 복원됨'
        : `상태 변경: ${STATUS_LABEL[status]}`,
    );
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
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'checkin_convert',
      old_data: { status: reservation.status },
      new_data: { status: 'checked_in', queue_number: queueData },
      changed_by: changedBy,
    });
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
              {formatPhone(reservation.customer_phone)} (뒤 4자리 ···{maskPhoneTail(reservation.customer_phone)})
            </div>
          )}
          {/* T-20260504-foot-MEMO-RESTRUCTURE: booking_memo 우선, 없으면 memo */}
          {(reservation.booking_memo || reservation.memo) && (
            <div className="space-y-1">
              {reservation.booking_memo && (
                <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
                  <span className="text-amber-700 font-medium">예약경로: </span>
                  <span className="whitespace-pre-wrap">{reservation.booking_memo}</span>
                </div>
              )}
              {reservation.memo && !reservation.booking_memo && (
                <div className="rounded border bg-muted/30 p-2 whitespace-pre-wrap text-xs">
                  {reservation.memo}
                </div>
              )}
            </div>
          )}
          {logs.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <div className="text-xs font-medium text-muted-foreground">변경 이력</div>
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{format(new Date(l.created_at), 'MM/dd HH:mm')}</span>
                  <span>
                    {l.action === 'create'
                      ? `예약 생성: ${l.new_data?.date} ${l.new_data?.time}`
                      : l.action === 'reschedule'
                        ? `일정 변경: ${l.old_data?.date} ${l.old_data?.time} → ${l.new_data?.date} ${l.new_data?.time}`
                        : l.action === 'cancel'
                          ? '예약 취소'
                          : l.action === 'restore'
                            ? '예약 복원'
                            : l.action === 'checkin_convert'
                              ? '체크인 전환'
                              : l.action === 'update'
                                ? '예약 수정'
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
          {isAdmin && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={deleteReservation}>
              완전 삭제
            </Button>
          )}
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

