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
  ClipboardCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Pin,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { fetchActiveStaff } from '@/lib/autoAssign';
import { fetchAttendeesByDate } from '@/lib/dutySheet';
import { partLabel, partBadgeClass, type HandoverNote } from '@/lib/handover';
import type { StaffRole } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/toast';
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

/**
 * 근무캘린더 섹션 파트 ↔ staff.role 매핑
 * (T-20260623-foot-DASH-WORKSTAFF-ROSTER-SECTION)
 *
 * staff 테이블 role = StaffRole = director|consultant|coordinator|therapist|technician.
 *   - 의사 = director (StaffRole 에 'doctor'/'manager' 값 없음 → 원장=director 단일)
 *   - 실장 = consultant (상담실장). staff 테이블엔 manager(총괄실장) role 자체가 없으므로
 *            티켓 §확인필요2 의 consultant vs manager 충돌은 staff 테이블 한정 무의미 → consultant 확정.
 *   - 코디 = coordinator
 *   - 치료 = therapist
 *   - technician(장비명) = 사람이 아닌 장비 → 4파트 어디에도 미매핑(표시 제외).
 */
const ROSTER_PARTS: { label: string; roles: StaffRole[] }[] = [
  { label: '의사', roles: ['director'] },
  { label: '실장', roles: ['consultant'] },
  { label: '코디', roles: ['coordinator'] },
  { label: '치료', roles: ['therapist'] },
];

export default function CalendarNoticePanel() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [6]/[7]: 달력 날짜 클릭 동작은 화면별로 분기.
  //   대시보드(/admin)=[6] 페이지 이동 없이 ?date= 만 갱신(Dashboard가 인라인 현황 렌더) + 달력 접힘 없음.
  //   예약관리(/admin/reservations)=[7] 해당 날짜 예약현황 이동 + 달력 자동접힘 제거(펼친 상태 유지).
  const onDashboard = location.pathname === '/admin';
  const onReservations = location.pathname === '/admin/reservations';

  // ── 작성자 staff.id 역조회 (T-20260530-foot-NOTICE-CREATEDBY-BACKFILL) ─────
  // created_by FK → staff(id). profile.id(=auth.uid())는 staff.user_id 경유 매핑.
  // 매핑 실패(staff 미존재) 시 null 유지 → FK nullable(on delete set null) 설계라 저장은 성공.
  const [creatorStaffId, setCreatorStaffId] = useState<string | null>(null);
  useEffect(() => {
    if (!profile?.id || !clinic?.id) { setCreatorStaffId(null); return; }
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setCreatorStaffId((data as { id: string } | null)?.id ?? null));
  }, [profile?.id, clinic?.id]);

  // ── 캘린더 상태 ──────────────────────────────────────────────────────────
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  // ── 공지사항 상태 ─────────────────────────────────────────────────────────
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeLoading, setNoticeLoading] = useState(true);

  // ── 근무캘린더(금일 출근 직원 파트별 명단) 상태 ─────────────────────────────
  //   T-20260623-foot-DASH-WORKSTAFF-ROSTER-SECTION.
  //   데이터 소스 = 공유 accessor fetchTodayWorkingStaffIds(현 duty-sheet-read EF) 경유만.
  //   ★신규 시트 직접 호출 금지(AC3) — SSOT source-swap(T-20260618-...-ATTENDANCE-SSOT-CRM,
  //     시트→staff_attendance 전환) 시 자동 전파되도록 accessor 단일 소비.
  const [rosterParts, setRosterParts] = useState<{ label: string; names: string[] }[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  // ── 인수인계(선택 날짜) 상태 — T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE AC2 ──
  const [handoverNotes, setHandoverNotes] = useState<HandoverNote[]>([]);
  const [handoverLoading, setHandoverLoading] = useState(true);

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
  // T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED: PC 초기 상태를 '항상 접힘'으로 변경.
  //   (이전 AC-6: 펼친 상태로 시작 → 변경) 진료대시보드 등 진입 시 달력 패널을 접힌
  //   상태(pc-cal-bar)로 시작. 마지막 상태 기억(localStorage) 로직 없음 → 매 진입·새로고침
  //   마다 항상 접힘으로 시작하는 게 의도. 사용자는 펼치기 버튼으로 즉시 펼칠 수 있음.
  const [pcCollapsed, setPcCollapsed] = useState<boolean>(true);
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [7]: CALENDAR-DEFAULT-COLLAPSED 예약관리 한정 반전.
  //   예약관리 진입 시 달력을 펼친 상태로 시작(날짜 클릭 시 펼침 유지와 일관).
  // T-20260629-foot-CALENDAR-SCOPE-DASH-RESV-ONLY (QA FIX, AC2): 대시보드(/admin)도 펼친 상태로 시작.
  //   본 패널은 SCOPE-DASH-RESV-ONLY 이후 showSidebarCalendar 로 '대시보드·예약관리' 2개 화면에서만 렌더되므로,
  //   두 화면 공히 달력/공지가 보여야 AC2·AC3 충족. 이전엔 onReservations 만 펼쳐 대시보드는 pc-cal-bar(접힘)
  //   strip만 떠 '공지사항' 미노출 → QA phase2 FAIL(text=공지사항 count 0). 라인 92-93 주석('대시보드 … 달력
  //   접힘 없음') 의도와도 정합. 접기 토글은 보존(사용자 수동 접기 가능) — 기본 시작 상태만 펼침.
  useEffect(() => {
    if (onReservations || onDashboard) setPcCollapsed(false);
  }, [onReservations, onDashboard]);

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

  // ── 근무캘린더 fetch (선택 날짜 출근 직원 + 인수인계) ────────────────────────
  //   T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE: today-fixed → 달력 선택 날짜에 반응.
  //   ★데이터 소스 = 하단 현황패널(DashboardDateDetail)과 동일 date-param accessor 재사용(AC4):
  //     근무 = fetchAttendeesByDate(duty-sheet-read EF, 기존) + fetchActiveStaff(staff, 기존).
  //     인수인계 = handover_notes(기존 테이블) target_date 필터 + handover_checklist_items 조인.
  //   신규 시트 직접 호출/EF 0 — SSOT source-swap(T-20260618-...-ATTENDANCE-SSOT-CRM,
  //     시트→staff_attendance 전환) 시 동일 accessor 단일 소비로 자동 전파(split-brain 0).
  //   기본값(미선택/첫 진입)=오늘(AC3). graceful(AC5): 실패 시 섹션만 빈칸·로딩, 달력·공지 정상 렌더.
  useEffect(() => {
    let cancelled = false;
    const clinicId = clinic?.id;
    if (!clinicId) return;
    const targetDate = selectedDate ?? new Date();
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    setRosterLoading(true);
    setHandoverLoading(true);
    (async () => {
      // ── 근무 (graceful) ── 하단 현황패널과 동일 규칙: 시트의 해당 날짜 명단 ∩ 활성 staff → role 그룹핑.
      try {
        const staffList = await fetchActiveStaff(clinicId);
        const byDate = await fetchAttendeesByDate(
          undefined,
          staffList.map((s) => s.name).filter(Boolean),
        );
        const attendeeNames = new Set((byDate[dateStr] ?? []).map((n) => n.trim()));
        const parts = ROSTER_PARTS.map((p) => ({
          label: p.label,
          names: staffList
            .filter(
              (s) =>
                p.roles.includes(s.role) &&
                (attendeeNames.has((s.display_name ?? s.name ?? '').trim()) ||
                  attendeeNames.has((s.name ?? '').trim())),
            )
            .map((s) => (s.display_name ?? s.name ?? '').trim())
            .filter(Boolean),
        }));
        if (!cancelled) setRosterParts(parts);
      } catch (e) {
        console.warn('[CalendarNoticePanel] 근무캘린더 로드 실패:', e);
        if (!cancelled) setRosterParts(null);
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
      // ── 인수인계 (graceful) ── 하단 현황패널과 동일 쿼리(handover_notes target_date).
      try {
        const { data } = await supabase
          .from('handover_notes')
          .select('*, handover_checklist_items(*)')
          .eq('clinic_id', clinicId)
          .eq('target_date', dateStr)
          .order('created_at', { ascending: true });
        const rows = (data ?? []) as HandoverNote[];
        rows.forEach((n) => n.handover_checklist_items?.sort((a, b) => a.sort_order - b.sort_order));
        if (!cancelled) setHandoverNotes(rows);
      } catch (e) {
        console.warn('[CalendarNoticePanel] 인수인계 로드 실패:', e);
        if (!cancelled) setHandoverNotes([]);
      } finally {
        if (!cancelled) setHandoverLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clinic?.id, selectedDate]);

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
    if (!formTitle.trim()) { toast.error('제목을 입력해주세요'); return; }
    // T-20260530-foot-NOTICE-CREATEDBY-BACKFILL (phase2 fix): Notices 페이지와 동일 레이스 방어.
    //   훅 상태가 아직 로드 전이면 getClinic()(모듈 캐시·await) 로 on-demand 확정.
    const activeClinic = clinic ?? await getClinic().catch(() => null);
    if (!activeClinic) { toast.error('클리닉 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); return; }
    setSaving(true);
    if (editingId === 'new') {
      const { error } = await supabase.from('notices').insert({
        clinic_id: activeClinic.id,
        title: formTitle.trim(),
        content: formContent.trim() || null,
        is_pinned: formPinned,
        created_by: creatorStaffId,  // T-20260530-foot-NOTICE-CREATEDBY-BACKFILL: staff.user_id 역조회 매핑. 미매핑 시 null fallback (FK nullable·on delete set null)
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
            {/* T-20260606-foot-CALENDAR-COLLAPSE-PARENS: 접힘 상태 라벨 괄호 제거.
                'M월 d일 (E)'(→"6월 6일 (토)") 의 리터럴 괄호를 빼 "6월 6일 토" 로 표기.
                펼침 상태 선택날짜 표시(아래)는 AC-2에 따라 괄호 유지(변경 금지). */}
            {format(selectedDate ?? new Date(), 'M월 d일 E', { locale: ko })}
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
        {/* 펼치기 버튼 — T-20260606-foot-CALENDAR-COLLAPSE-ROTATE (Option B)
            이전: 세로 날짜 span(writing-mode:vertical-rl + rotate(180deg)) 이 PC 뷰에서
            "6월 6일 (토)" 텍스트를 90°/180° 회전 표시. w-10(2.5rem) 폭이 좁아 세로 날짜
            표시 실익이 없으므로 span 자체를 제거하고 펼치기 버튼만 남김. */}
        <button
          data-testid="pc-cal-expand"
          onClick={() => setPcCollapsed(false)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          aria-label="달력 펼치기"
        >
          <ChevronRight className="h-4 w-4 text-teal-600" />
        </button>
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
                data-testid={`cal-day-${dateKey}`}
                onClick={() => {
                  setSelectedDate(isSelected ? null : day);
                  const dateStr = format(day, 'yyyy-MM-dd');
                  // T-20260517-foot-MINICAL-REGRESS: location.state → URL ?date= 로 변경
                  //   state 방식은 이미 마운트된 Reservations 에서 재클릭 시 불안정 + 새로고침 소실.
                  //   URL param으로 전환하면 searchParams 변경 → useEffect 확실히 트리거됨.
                  // LOGIC-LOCK: L-002 — 변경 시 현장 승인 필수.
                  //   T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB(reporter code-start confirm MSG-j2ez):
                  if (onDashboard) {
                    // [6] 대시보드: 예약관리로 이동하지 않고 같은 화면 ?date= 만 갱신 → Dashboard 하단 인라인 현황.
                    //   달력 자동접힘도 하지 않음(현황을 보면서 다른 날짜 비교 가능).
                    navigate(`/admin?date=${dateStr}`, { replace: true });
                  } else {
                    // [7] 예약관리(및 기타 레거시 경로): 해당 날짜 예약현황으로 이동.
                    navigate(`/admin/reservations?date=${dateStr}`);
                    // [7] 예약관리에서는 자동접힘 제거(펼친 상태 유지). 그 외 경로(레거시)에서만 기존 자동접힘 유지.
                    if (!onReservations) {
                      if (isMobile) setMobileCollapsed(true);
                      else setPcCollapsed(true);
                    }
                  }
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

      {/* ── 근무캘린더 (선택 날짜 출근 직원 파트별 명단 + 인수인계) ──────────────────
          T-20260623-foot-DASH-WORKSTAFF-ROSTER-SECTION — 달력 섹션과 공지사항 섹션 사이.
          T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE — 달력에서 날짜 클릭 시 이 고정 섹션 자체가
            클릭한 날짜의 명단으로 변동(today 고정 X) + 해당 날짜 인수인계 동반 표시.
          파트(의사/실장/코디/치료)별 그룹핑. 한 줄 max 4명, 5명+ 는 flex-wrap 자연 줄내림. */}
      {/* T-20260629-foot-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE item2 — 2026-06-30 P1 HOTFIX:
          ⚠ 이 사이드바 근무캘린더+인수인계 섹션이 reporter(김주연 총괄)가 스크린샷에서
          빨간박스로 지목한 '보존 대상'(=day-click 시 날짜별로 갱신되는 정상 현황)이다.
          직전 배포(d3f908d0)는 (A)/(B) 매핑을 반대로 적용해 이 빨간박스 섹션을 {!onDashboard}로
          숨겼다 → field-soak FAIL('파란박스 제거 요청했는데 빨간박스가 사라짐'). → 게이트 제거,
          대시보드에서도 상시 보존. 제거 대상(파란박스=하단 인라인 DashboardDateDetail)은
          Dashboard.tsx에서 별도로 제거한다. day-click 현황은 이 섹션(selectedDate 반응)이 담당. */}
      <div className="shrink-0 border-b px-3 py-2.5" data-testid="duty-roster-section">
        <div className="mb-2 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-teal-600" />
          <span className="text-xs font-semibold">근무캘린더</span>
          <span className="text-[10px] text-muted-foreground" data-testid="duty-roster-date-label">
            {!selectedDate || isSameDay(selectedDate, new Date())
              ? '금일 출근'
              : `${format(selectedDate, 'M월 d일 (E)', { locale: ko })} 출근`}
          </span>
        </div>
        {rosterLoading ? (
          <div className="py-2 text-center text-[11px] text-muted-foreground" data-testid="roster-loading">
            불러오는 중…
          </div>
        ) : !rosterParts || rosterParts.every((p) => p.names.length === 0) ? (
          <div className="py-2 text-center text-[11px] text-muted-foreground" data-testid="roster-empty">
            {!selectedDate || isSameDay(selectedDate, new Date())
              ? '금일 출근 정보가 없습니다'
              : '근무 정보가 없습니다'}
          </div>
        ) : (
          <div className="space-y-1">
            {rosterParts.map((p) => (
              <div
                key={p.label}
                className="flex items-start gap-1.5 text-[11px]"
                data-testid={`roster-part-${p.label}`}
              >
                <span className="w-7 shrink-0 pt-0.5 font-semibold text-muted-foreground">{p.label}</span>
                <div className="flex flex-wrap gap-1">
                  {p.names.length === 0 ? (
                    <span className="pt-0.5 text-muted-foreground/50">–</span>
                  ) : (
                    p.names.map((nm, i) => (
                      <span
                        key={`${nm}-${i}`}
                        className="inline-flex items-center rounded bg-teal-50 px-1.5 py-0.5 font-medium text-teal-800"
                      >
                        {nm}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 인수인계 (선택 날짜) — T-20260624-foot-DASH-DUTYCAL-DATE-REACTIVE AC2 ──
            근무 명단 바로 아래 동반 표시. 하단 현황패널(DashboardDateDetail)과 동일 데이터·문구. */}
        <div className="mt-2.5 border-t pt-2" data-testid="duty-roster-handover">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold">인수인계</span>
          </div>
          {handoverLoading ? (
            <div className="py-1.5 text-[11px] text-muted-foreground" data-testid="handover-loading">
              불러오는 중…
            </div>
          ) : handoverNotes.length === 0 ? (
            <div className="py-1.5 text-[11px] text-muted-foreground" data-testid="handover-empty">
              인수인계가 없습니다
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="handover-list">
              {handoverNotes.map((n) => (
                <div key={n.id} className="rounded-lg border bg-white p-2 shadow-sm">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', partBadgeClass(n.part_code))}>
                      {partLabel(n.part_code)}
                    </span>
                    {n.author_name && (
                      <span className="text-[10px] text-muted-foreground">{n.author_name}</span>
                    )}
                  </div>
                  {n.memo && (
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-700">{n.memo}</p>
                  )}
                  {n.handover_checklist_items && n.handover_checklist_items.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {n.handover_checklist_items.map((c) => (
                        <li key={c.id} className="flex items-center gap-1 text-[11px]">
                          <span className={cn('text-xs', c.is_checked ? 'text-emerald-600' : 'text-muted-foreground')}>
                            {c.is_checked ? '☑' : '☐'}
                          </span>
                          <span className={cn(c.is_checked && 'text-muted-foreground line-through')}>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
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
