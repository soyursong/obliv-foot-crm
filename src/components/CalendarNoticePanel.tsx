/**
 * CalendarNoticePanel — 좌측 고정 사이드 패널
 * T-20260510-foot-CALENDAR-NOTICE (AC v4)
 *
 * 모든 페이지에서 항상 표시. 좌측 네비게이션 바로 오른쪽 고정.
 * 상단: 스몰 캘린더 (월간 미니뷰)
 * 하단: 공지사항 (등록/조회/수정/삭제)
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
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type ViewMode = 'today' | 'day' | 'week' | 'month';

interface Notice {
  id: string;
  clinic_id: string;
  title: string;
  content: string | null;
  is_pinned: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const WEEK_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export default function CalendarNoticePanel() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const navigate = useNavigate();

  // ── 캘린더 상태 ──────────────────────────────────────────────────────────
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  // ── 공지사항 상태 ─────────────────────────────────────────────────────────
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeLoading, setNoticeLoading] = useState(true);

  // ── 모바일 접힘 상태 (T-20260514-foot-MOBILE-CAL-COLLAPSE) ────────────────
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth <= 768,
  );
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth <= 768,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches) setMobileCollapsed(true);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── PC 접힘 상태 (T-20260516-foot-PC-CAL-COLLAPSE) ────────────────────────
  // AC-6: PC 초기 상태는 펼쳐진 상태
  const [pcCollapsed, setPcCollapsed] = useState<boolean>(false);

  // ── 공지 폼 상태 ──────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── 공지 fetch ────────────────────────────────────────────────────────────
  const fetchNotices = useCallback(async () => {
    if (!clinic) return;
    setNoticeLoading(true);
    const { data, error } = await supabase
      .from('notices')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error) setNotices((data ?? []) as Notice[]);
    setNoticeLoading(false);
  }, [clinic]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  // ── 미니 캘린더 날짜 배열 ─────────────────────────────────────────────────
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }),
  });

  // 주간 뷰 모드: 선택 날짜가 속한 주 경계
  const weekHighlightStart =
    viewMode === 'week' && selectedDate
      ? startOfWeek(selectedDate, { weekStartsOn: 0 })
      : null;
  const weekHighlightEnd =
    viewMode === 'week' && selectedDate
      ? endOfWeek(selectedDate, { weekStartsOn: 0 })
      : null;

  // ── 공지 폼 핸들러 ────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingId('new');
    setFormTitle('');
    setFormContent('');
    setFormPinned(false);
  };

  const openEdit = (n: Notice) => {
    setEditingId(n.id);
    setFormTitle(n.title);
    setFormContent(n.content ?? '');
    setFormPinned(n.is_pinned);
  };

  const closeForm = () => setEditingId(null);

  // ── 뷰 모드 전환 ──────────────────────────────────────────────────────────
  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'today') {
      const today = new Date();
      setSelectedDate(today);
      setCurrentDate(today);
    }
  };

  const handleSave = async () => {
    if (!clinic || !formTitle.trim()) { toast.error('제목을 입력해주세요'); return; }
    setSaving(true);
    if (editingId === 'new') {
      const { error } = await supabase.from('notices').insert({
        clinic_id: clinic.id,
        title: formTitle.trim(),
        content: formContent.trim() || null,
        is_pinned: formPinned,
        created_by: profile?.id ?? null,
      });
      if (error) toast.error('저장 실패: ' + error.message);
      else { toast.success('공지가 등록되었습니다'); closeForm(); fetchNotices(); }
    } else if (editingId) {
      const { error } = await supabase.from('notices').update({
        title: formTitle.trim(),
        content: formContent.trim() || null,
        is_pinned: formPinned,
      }).eq('id', editingId);
      if (error) toast.error('수정 실패: ' + error.message);
      else { toast.success('공지가 수정되었습니다'); closeForm(); fetchNotices(); }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 공지를 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('notices').delete().eq('id', id);
    if (error) toast.error('삭제 실패: ' + error.message);
    else { toast.success('삭제되었습니다'); fetchNotices(); }
  };

  const handleTogglePin = async (n: Notice) => {
    const { error } = await supabase
      .from('notices')
      .update({ is_pinned: !n.is_pinned })
      .eq('id', n.id);
    if (error) toast.error('핀 변경 실패');
    else fetchNotices();
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  // AC-1: 모바일 + 접힘 상태 → 날짜 바 한 줄만 표시
  if (isMobile && mobileCollapsed) {
    return (
      <button
        data-testid="mobile-cal-bar"
        className="w-full shrink-0 border-b bg-white flex items-center justify-between px-4 py-2.5 text-left"
        onClick={() => setMobileCollapsed(false)}
        aria-label="달력 펼치기"
      >
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">
            {format(selectedDate ?? new Date(), 'M월 d일 (E)', { locale: ko })}
          </span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  // AC-2: PC + 접힘 상태 → 좌측 날짜 바 strip만 표시 (T-20260516-foot-PC-CAL-COLLAPSE)
  if (!isMobile && pcCollapsed) {
    return (
      <aside
        data-testid="pc-cal-bar"
        className="w-10 shrink-0 border-r bg-white flex flex-col items-center gap-2 py-2"
      >
        {/* 펼치기 버튼 */}
        <button
          data-testid="pc-cal-expand"
          onClick={() => setPcCollapsed(false)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          aria-label="달력 펼치기"
        >
          <ChevronRight className="h-4 w-4 text-teal-600" />
        </button>
        {/* 날짜 세로 표기 */}
        <span
          className="text-[10px] font-semibold text-teal-700 select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {format(selectedDate ?? new Date(), 'M월 d일 (E)', { locale: ko })}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'shrink-0 bg-white flex flex-col overflow-hidden',
        isMobile ? 'w-full border-b' : 'w-72 border-r',
      )}
    >
      {/* 패널 헤더 */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 bg-white/80">
        <CalendarDays className="h-4 w-4 text-teal-600" />
        <span className="text-sm font-semibold">달력</span>
        {/* AC-1: PC 접기 토글 버튼 (T-20260516-foot-PC-CAL-COLLAPSE) */}
        {!isMobile && (
          <button
            data-testid="pc-cal-toggle"
            className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
            onClick={() => setPcCollapsed(true)}
            aria-label="달력 접기"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {/* AC-2: 모바일 펼침 상태에서 닫기 버튼 */}
        {isMobile && (
          <button
            data-testid="mobile-cal-close"
            className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
            onClick={() => setMobileCollapsed(true)}
            aria-label="달력 접기"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── 미니 캘린더 ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b px-3 pt-3 pb-2">
        {/* 월 네비게이션 */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setCurrentDate((d) => subMonths(d, 1))}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-semibold">
            {format(currentDate, 'yyyy년 M월', { locale: ko })}
          </span>
          <button
            onClick={() => setCurrentDate((d) => addMonths(d, 1))}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 mb-0.5">
          {WEEK_LABELS.map((d, i) => (
            <div
              key={d}
              className={cn(
                'text-center text-[10px] font-medium py-0.5',
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground',
              )}
            >
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
            const isInWeek =
              weekHighlightStart && weekHighlightEnd
                ? day >= weekHighlightStart && day <= weekHighlightEnd
                : false;
            const dow = day.getDay();

            return (
              <button
                key={dateKey}
                onClick={() => {
                  setSelectedDate(isSelected ? null : day);
                  // AC-7: 날짜 클릭 → 예약관리 해당 주 이동
                  // LOGIC-LOCK: L-002 — 변경 시 현장 승인 필수
                  navigate('/admin/reservations', {
                    state: { goToWeekOf: format(day, 'yyyy-MM-dd') },
                  });
                  // AC-3: 날짜 선택 → 달력 자동 접힘 (모바일 + PC 공통)
                  if (isMobile) setMobileCollapsed(true);
                  else setPcCollapsed(true);
                }}
                className={cn(
                  'w-full py-1 text-[11px] font-medium rounded-full transition-colors leading-none aspect-square flex items-center justify-center',
                  !isCurrentMonth && 'opacity-25',
                  isSelected && 'bg-teal-600 text-white',
                  !isSelected && isInWeek && 'bg-teal-100',
                  !isSelected && !isInWeek && isToday && 'bg-teal-100 text-teal-800 font-bold',
                  !isSelected && !isToday && dow === 0 && isCurrentMonth && 'text-red-500',
                  !isSelected && !isToday && dow === 6 && isCurrentMonth && 'text-blue-500',
                  !isSelected && !isToday && isCurrentMonth && dow > 0 && dow < 6 && 'text-foreground',
                  !isSelected && 'hover:bg-muted',
                )}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>

        {/* 선택된 날짜 표시 */}
        {selectedDate && (
          <div className="mt-2 text-center text-[11px] text-teal-700 font-medium">
            {format(selectedDate, 'M월 d일 (E)', { locale: ko })}
          </div>
        )}

        {/* 뷰 모드 전환 버튼: 당일 / 일 / 주 / 월 */}
        <div className="flex items-center gap-1 mt-2.5 pb-0.5">
          {([ 'today', 'day', 'week', 'month'] as ViewMode[]).map((mode) => {
            const label = mode === 'today' ? '당일' : mode === 'day' ? '일' : mode === 'week' ? '주' : '월';
            return (
              <button
                key={mode}
                onClick={() => handleViewMode(mode)}
                className={cn(
                  'flex-1 rounded py-1 text-[10px] font-semibold transition-colors',
                  viewMode === mode
                    ? 'bg-teal-600 text-white'
                    : 'bg-muted/60 text-muted-foreground hover:bg-teal-50 hover:text-teal-700',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 공지사항 영역 ───────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* 공지 헤더 */}
        <div className="shrink-0 flex items-center justify-between border-b px-3 py-2 bg-white/80">
          <div className="flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold">공지사항</span>
            <NavLink
              to="/admin/notices"
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-teal-700"
              title="공지사항 전체 보기"
            >
              <ExternalLink className="h-3 w-3" />
            </NavLink>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px] gap-0.5"
            onClick={openNew}
          >
            <Plus className="h-3 w-3" /> 공지 등록
          </Button>
        </div>

        {/* 공지 폼 + 목록 — 단일 스크롤 영역 (T-20260512-foot-NOTICE-SCROLL) */}
        <div className="flex-1 overflow-y-auto">

        {/* 공지 작성/수정 폼 */}
        {editingId !== null && (
          <div className="border-b bg-teal-50/60 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-teal-800">
                {editingId === 'new' ? '새 공지 작성' : '공지 수정'}
              </span>
              <button
                onClick={closeForm}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="제목 *"
                className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="내용 (선택)"
                rows={2}
                className="text-xs resize-none"
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  id="panel-pin-check"
                  checked={formPinned}
                  onChange={(e) => setFormPinned(e.target.checked)}
                  className="h-3 w-3 accent-teal-600"
                />
                <label
                  htmlFor="panel-pin-check"
                  className="text-[11px] text-muted-foreground cursor-pointer"
                >
                  상단 고정
                </label>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 h-7 text-xs"
                >
                  {saving ? '저장 중…' : '저장'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={closeForm}
                  className="h-7 text-xs"
                >
                  취소
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 공지 목록 */}
        <div className="p-2 space-y-1.5">
          {noticeLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중…</div>
          ) : notices.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <Bell className="h-6 w-6 opacity-25" />
              <span>등록된 공지가 없습니다</span>
            </div>
          ) : (
            notices.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'rounded-lg border bg-white p-2 space-y-1 shadow-sm',
                  n.is_pinned && 'border-teal-300 bg-teal-50/40',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    {n.is_pinned && (
                      <Pin className="h-3 w-3 shrink-0 text-teal-600 fill-teal-600" />
                    )}
                    <span className="text-xs font-semibold truncate leading-tight">
                      {n.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => handleTogglePin(n)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-teal-700"
                      title={n.is_pinned ? '핀 해제' : '상단 고정'}
                    >
                      <Pin
                        className={cn('h-3 w-3', n.is_pinned && 'fill-teal-600 text-teal-600')}
                      />
                    </button>
                    <button
                      onClick={() => openEdit(n)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-teal-700"
                      title="수정"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(n.id)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-red-600"
                      title="삭제"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {n.content && (
                  <p className="text-[11px] text-gray-600 whitespace-pre-wrap line-clamp-4">
                    {n.content}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(n.created_at), 'M.d HH:mm')}
                </p>
              </div>
            ))
          )}
        </div>
        </div>{/* /단일 스크롤 영역 */}
      </div>
    </aside>
  );
}
