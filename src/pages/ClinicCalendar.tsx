/**
 * 캘린더 페이지 — /admin/calendar
 * T-20260510-foot-CALENDAR-NOTICE
 *
 * 원내 일정 등록/조회/수정/삭제 (월간 캘린더 뷰 + 공지사항 통합 표시)
 * clinic_events 테이블 CRUD + notices 테이블 읽기 통합
 */
import { useCallback, useEffect, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Pencil,
  Trash2,
  Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 타입 ────────────────────────────────────────────────────────────────
interface ClinicEvent {
  id: string;
  clinic_id: string;
  title: string;
  description: string | null;
  event_date: string;   // 'YYYY-MM-DD'
  start_time: string | null;
  end_time: string | null;
  event_type: 'general' | 'reservation' | 'notice' | 'holiday' | 'meeting';
  color: string | null;
  created_at: string;
}

interface Notice {
  id: string;
  title: string;
  is_pinned: boolean;
}

// ─── 상수 ────────────────────────────────────────────────────────────────
const EVENT_TYPE_LABEL: Record<ClinicEvent['event_type'], string> = {
  general: '일반',
  reservation: '예약',
  notice: '공지',
  holiday: '휴무',
  meeting: '회의',
};

const EVENT_TYPE_COLOR: Record<ClinicEvent['event_type'], string> = {
  general: 'bg-teal-100 text-teal-800 border-teal-200',
  reservation: 'bg-blue-100 text-blue-800 border-blue-200',
  notice: 'bg-amber-100 text-amber-800 border-amber-200',
  holiday: 'bg-red-100 text-red-800 border-red-200',
  meeting: 'bg-purple-100 text-purple-800 border-purple-200',
};

const WEEK_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function ClinicCalendar() {
  const clinic = useClinic();
  const { profile } = useAuth();

  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<ClinicEvent[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  // 선택된 날짜 상태
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDayEvents, setSelectedDayEvents] = useState<ClinicEvent[]>([]);

  // 편집 폼
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formType, setFormType] = useState<ClinicEvent['event_type']>('general');
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [saving, setSaving] = useState(false);

  // ─── 데이터 fetch ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);

    const monthStart = format(startOfMonth(currentDate), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentDate), 'yyyy-MM-dd');

    const [eventsRes, noticesRes] = await Promise.all([
      supabase
        .from('clinic_events')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('event_date', monthStart)
        .lte('event_date', monthEnd)
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: true }),
      supabase
        .from('notices')
        .select('id, title, is_pinned')
        .eq('clinic_id', clinic.id)
        .eq('is_pinned', true)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    if (eventsRes.error) toast.error('일정 불러오기 실패: ' + eventsRes.error.message);
    else setEvents((eventsRes.data ?? []) as ClinicEvent[]);

    if (!noticesRes.error) setNotices((noticesRes.data ?? []) as Notice[]);

    setLoading(false);
  }, [clinic, currentDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 선택된 날짜의 이벤트 갱신
  useEffect(() => {
    if (!selectedDate) { setSelectedDayEvents([]); return; }
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    setSelectedDayEvents(events.filter((e) => e.event_date === dateStr));
  }, [selectedDate, events]);

  // ─── 달력 날짜 배열 ──────────────────────────────────────────────────
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }),
  });

  const eventsMap = new Map<string, ClinicEvent[]>();
  for (const ev of events) {
    const k = ev.event_date;
    if (!eventsMap.has(k)) eventsMap.set(k, []);
    eventsMap.get(k)!.push(ev);
  }

  // ─── 폼 조작 ──────────────────────────────────────────────────────────
  const openNew = (date?: Date) => {
    setEditingId('new');
    setFormDate(date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    setFormTitle('');
    setFormDesc('');
    setFormType('general');
    setFormStartTime('');
    setFormEndTime('');
    setFormOpen(true);
  };

  const openEdit = (ev: ClinicEvent) => {
    setEditingId(ev.id);
    setFormDate(ev.event_date);
    setFormTitle(ev.title);
    setFormDesc(ev.description ?? '');
    setFormType(ev.event_type);
    setFormStartTime(ev.start_time ?? '');
    setFormEndTime(ev.end_time ?? '');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!clinic || !formTitle.trim()) { toast.error('제목을 입력해주세요'); return; }
    if (!formDate) { toast.error('날짜를 선택해주세요'); return; }
    setSaving(true);

    const payload = {
      clinic_id: clinic.id,
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      event_date: formDate,
      start_time: formStartTime || null,
      end_time: formEndTime || null,
      event_type: formType,
      created_by: profile?.id ?? null,
    };

    let error;
    if (editingId === 'new') {
      ({ error } = await supabase.from('clinic_events').insert(payload));
      if (!error) toast.success('일정이 등록되었습니다');
    } else if (editingId) {
      ({ error } = await supabase.from('clinic_events').update(payload).eq('id', editingId));
      if (!error) toast.success('일정이 수정되었습니다');
    }

    if (error) { toast.error('저장 실패: ' + error.message); }
    else { closeForm(); fetchData(); }

    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('clinic_events').delete().eq('id', id);
    if (error) toast.error('삭제 실패: ' + error.message);
    else { toast.success('삭제되었습니다'); fetchData(); setSelectedDayEvents((prev) => prev.filter((e) => e.id !== id)); }
  };

  // ─── 렌더 ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b bg-white/80">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-teal-600" />
          <h1 className="text-base font-semibold">캘린더</h1>
        </div>
        <Button size="sm" onClick={() => openNew()} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> 일정 추가
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 캘린더 영역 */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-white/60 shrink-0">
            <button
              onClick={() => setCurrentDate((d) => subMonths(d, 1))}
              className="p-1.5 rounded hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">
              {format(currentDate, 'yyyy년 M월', { locale: ko })}
            </span>
            <button
              onClick={() => setCurrentDate((d) => addMonths(d, 1))}
              className="p-1.5 rounded hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b bg-muted/30 shrink-0">
            {WEEK_LABELS.map((d, i) => (
              <div
                key={d}
                className={cn(
                  'py-1.5 text-center text-[11px] font-semibold',
                  i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground',
                )}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">불러오는 중…</div>
            ) : (
              <div className="grid grid-cols-7 divide-x divide-y border-b">
                {calendarDays.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dayEvents = eventsMap.get(dateStr) ?? [];
                  const isToday = isSameDay(day, new Date());
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                  const dow = day.getDay();

                  return (
                    <div
                      key={dateStr}
                      onClick={() => setSelectedDate(isSelected ? null : day)}
                      className={cn(
                        'min-h-[80px] p-1 cursor-pointer transition-colors',
                        !isCurrentMonth && 'bg-muted/20 opacity-50',
                        isSelected && 'bg-teal-50/80 ring-inset ring-1 ring-teal-400',
                        !isSelected && 'hover:bg-muted/30',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full',
                            isToday && 'bg-teal-600 text-white',
                            !isToday && dow === 0 && 'text-red-500',
                            !isToday && dow === 6 && 'text-blue-500',
                            !isToday && dow > 0 && dow < 6 && 'text-foreground',
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                        {isCurrentMonth && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openNew(day); }}
                            className="p-0.5 rounded hover:bg-teal-100 text-muted-foreground hover:text-teal-700 opacity-0 group-hover:opacity-100"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="mt-0.5 space-y-0.5">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            className={cn(
                              'rounded px-1 py-0.5 text-[10px] font-medium truncate border',
                              EVENT_TYPE_COLOR[ev.event_type],
                            )}
                            title={ev.title}
                          >
                            {ev.start_time && (
                              <span className="opacity-70 mr-0.5">
                                {ev.start_time.slice(0, 5)}
                              </span>
                            )}
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[9px] text-muted-foreground pl-1">
                            +{dayEvents.length - 3}개
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 사이드 패널 */}
        <div className="w-64 shrink-0 flex flex-col border-l bg-white overflow-y-auto">
          {/* 선택된 날짜 이벤트 */}
          {selectedDate ? (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-teal-800">
                  {format(selectedDate, 'M월 d일 (E)', { locale: ko })}
                </span>
                <button
                  onClick={() => openNew(selectedDate)}
                  className="p-1 rounded hover:bg-teal-50 text-teal-600"
                  title="이 날 일정 추가"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {selectedDayEvents.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  등록된 일정이 없습니다
                  <button
                    onClick={() => openNew(selectedDate)}
                    className="block mx-auto mt-2 text-teal-600 hover:underline"
                  >
                    + 일정 추가
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedDayEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={cn(
                        'rounded-lg border p-2 space-y-1',
                        EVENT_TYPE_COLOR[ev.event_type],
                      )}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-semibold leading-tight">{ev.title}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => openEdit(ev)}
                            className="p-0.5 rounded hover:bg-black/10"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDelete(ev.id)}
                            className="p-0.5 rounded hover:bg-red-100 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {(ev.start_time || ev.end_time) && (
                        <div className="flex items-center gap-1 text-[10px] opacity-80">
                          <Clock className="h-2.5 w-2.5" />
                          {ev.start_time?.slice(0, 5)}
                          {ev.end_time && ` ~ ${ev.end_time.slice(0, 5)}`}
                        </div>
                      )}
                      {ev.description && (
                        <p className="text-[11px] opacity-80 whitespace-pre-wrap line-clamp-3">
                          {ev.description}
                        </p>
                      )}
                      <span className="inline-block text-[9px] font-medium rounded px-1 bg-black/10">
                        {EVENT_TYPE_LABEL[ev.event_type]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 고정 공지 패널 */
            <div className="p-3 space-y-2">
              <div className="text-xs font-semibold text-teal-800 flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                날짜를 선택하면 일정을 볼 수 있습니다
              </div>
              {notices.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    📌 고정 공지
                  </p>
                  {notices.map((n) => (
                    <div key={n.id} className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5">
                      <p className="text-xs font-medium text-amber-900 truncate">{n.title}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 등록/수정 폼 (오버레이) */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeForm} />
          <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border bg-background shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {editingId === 'new' ? '새 일정 추가' : '일정 수정'}
              </span>
              <button onClick={closeForm} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* 날짜 */}
              <div>
                <Label className="text-xs">날짜 <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>

              {/* 종류 */}
              <div>
                <Label className="text-xs">종류</Label>
                <Select
                  value={formType}
                  onValueChange={(v) => setFormType(v as ClinicEvent['event_type'])}
                >
                  <SelectTrigger className="mt-1 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(EVENT_TYPE_LABEL) as [ClinicEvent['event_type'], string][]).map(
                      ([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* 제목 */}
              <div>
                <Label className="text-xs">제목 <span className="text-red-500">*</span></Label>
                <Input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="일정 제목"
                  className="mt-1 h-9 text-sm"
                />
              </div>

              {/* 시간 */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">시작 시간</Label>
                  <Input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">종료 시간</Label>
                  <Input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
              </div>

              {/* 내용 */}
              <div>
                <Label className="text-xs">내용</Label>
                <Textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="일정 내용 (선택)"
                  rows={3}
                  className="mt-1 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? '저장 중…' : '저장'}
              </Button>
              <Button size="sm" variant="outline" onClick={closeForm}>취소</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
