/**
 * 인수인계 게시판 (캘린더) — /admin/handover
 * T-20260605-foot-HANDOVER-BOARD
 *
 * 파트(상담실장·코디·치료사)별 인수인계를 자유 메모 + 체크리스트로 기록하고
 * 월/주/일 3뷰 캘린더로 날짜별 조회한다. 전 직원 작성/조회, 수정·삭제는 본인 한정.
 *
 * 테이블: handover_notes / handover_checklist_items
 * (migration: 20260605130000_handover_notes.sql)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { todaySeoulISODate } from '@/lib/format';
import { STAFF_ROLE_LABEL, STAFF_ROLE_ORDER, staffRoleCardClass } from '@/lib/status';
import { fetchAttendeesByDate } from '@/lib/dutySheet';
import type { Staff } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import {
  PART_OPTIONS,
  partBadgeClass,
  partBoxClass,
  partLabel,
  type CalendarView,
  type HandoverChecklistItem,
  type HandoverNote,
} from '@/lib/handover';
// T-20260620-foot-SIDEBAR-DUTYCAL-PROMOTE → T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL:
//   원장 근무표(듀티 로스터) 흡수 후 의사·직원 탭 통합 → 단일 스크롤. Tabs 의존 제거, DutyRosterTab 만 사용.
import { DutyRosterTab } from '@/components/DutyRosterTab';

const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');

// T-20260620-foot-SIDEBAR-DUTYCAL-PROMOTE: 원장 근무표(DutyRosterTab) 가시성 = 이동 전 직원·공간 메뉴 노출 role 그대로.
//   (AdminLayout NAV /admin/staff roles = admin/manager/director/consultant/coordinator/therapist)
//   AC-3 권한 가드 보존: part_lead/staff/tm 에게 새로 노출 금지. 흡수해도 동일 role 게이트 유지.
const DUTY_ROSTER_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'] as const;

/** 편집 다이얼로그용 임시 체크리스트 항목 (id 없는 신규 포함) */
interface DraftChecklistItem {
  id?: string;
  label: string;
  is_checked: boolean;
  sort_order: number;
}

export default function Handover() {
  const clinic = useClinic();
  const { profile } = useAuth();

  // T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL: 의사 근무표 = 단일 스크롤 상단 섹션(탭 제거).
  //   권한 가드 보존 — DUTY_ROSTER_ROLES 없는 role 에겐 섹션 자체를 렌더하지 않음(AC-4).
  const canSeeDutyRoster = !!(profile?.role && (DUTY_ROSTER_ROLES as readonly string[]).includes(profile.role));

  const [view, setView] = useState<CalendarView>('month'); // AC-2: 기본 월별
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [partFilter, setPartFilter] = useState<string>('all');

  const [notes, setNotes] = useState<HandoverNote[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 출근자 명단 (T-20260606-…-TODAY-ATTENDEES → T-20260608-…-ATTENDEE-LAYOUT) ──
  //   데이터 소스 = 구글시트 근무 캘린더 직접 read (Edge Function `duty-sheet-read`
  //   프록시 → gviz CSV → 블록 캘린더 파싱, lib/dutySheet.ts). duty_roster import 폐기.
  //   [LAYOUT 개선] 상단 배너 단독 나열 → ❶ 캘린더 셀 내 표시(A안) ❷ 선택일 하단 명단(B안).
  //   시트 CSV는 gid당 1회 fetch 후 날짜별 맵(attendeesByDate)으로 두 동선이 공유(AC-0).
  //   시트엔 역할이 없으므로 추출한 이름을 CRM staff.role 과 매핑해 칩 색을 칠한다
  //   (NAMECARD-ROLECOLOR 결합점). role 미매칭 → role=null → 중립 fallback 색.
  const [attendeesByDate, setAttendeesByDate] = useState<Record<string, string[]>>({});
  const [roleByName, setRoleByName] = useState<Map<string, Staff['role']>>(new Map());
  const [attendeesLoading, setAttendeesLoading] = useState(true);

  const fetchAttendees = useCallback(async () => {
    if (!clinic) return;
    setAttendeesLoading(true);
    try {
      // 활성 직원 먼저 조회 — 시트 "전직원" 토큰 확장(2001c73 룰)에 직원 이름 목록 필요.
      // ⚠ staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션).
      //   select에 포함하면 PostgREST 400(42703) → staffData=null → roleByName 빈 맵 →
      //   출근자 칩 전 역할이 slate fallback으로 떨어짐(상담 rose 미반영의 근본원인).
      //   프로젝트 관례(Closing/CustomerChart/ReservationDetailPopup) 동일: select는 name만, UI는 ||name fallback.
      //   (T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR FIX)
      const { data: staffData } = await supabase
        .from('staff')
        .select('id, name, role, active')
        .eq('clinic_id', clinic.id)
        .eq('active', true);

      // 이름 → CRM staff.role 매핑 (name 키, 공백 제거)
      const norm = (s: string) => s.replace(/\s+/g, '');
      const rmap = new Map<string, Staff['role']>();
      const allStaffNames: string[] = [];
      (staffData ?? []).forEach((s) => {
        const staff = s as Staff;
        if (staff.name) {
          rmap.set(norm(staff.name), staff.role);
          allStaffNames.push(staff.name);
        }
      });

      // 시트 직접 read — 날짜별 맵(gid당 CSV 1회 fetch). 장애/포맷 변경 시 graceful({}).
      const byDate = await fetchAttendeesByDate(undefined, allStaffNames).catch((e) => {
        console.warn('[handover] 출근 명단 시트 read 실패:', e);
        return {} as Record<string, string[]>;
      });

      setRoleByName(rmap);
      setAttendeesByDate(byDate);
    } finally {
      setAttendeesLoading(false);
    }
  }, [clinic]);

  useEffect(() => {
    fetchAttendees();
  }, [fetchAttendees]);

  // 역할 정렬 인덱스 (미매칭은 맨 뒤)
  const roleIdx = useCallback((r: Staff['role'] | null) => {
    if (!r) return STAFF_ROLE_ORDER.length + 1;
    const i = STAFF_ROLE_ORDER.indexOf(r);
    return i === -1 ? STAFF_ROLE_ORDER.length : i;
  }, []);

  // 날짜별 출근자 이름 맵 (역할→이름순 정렬). A안(셀)·B안(선택일 하단) 공유.
  const namesByDate = useMemo(() => {
    const norm = (s: string) => s.replace(/\s+/g, '');
    const out: Record<string, string[]> = {};
    for (const [date, names] of Object.entries(attendeesByDate)) {
      out[date] = [...names].sort(
        (a, b) =>
          roleIdx(roleByName.get(norm(a)) ?? null) - roleIdx(roleByName.get(norm(b)) ?? null) ||
          a.localeCompare(b, 'ko'),
      );
    }
    return out;
  }, [attendeesByDate, roleByName, roleIdx]);

  // 선택일 출근자 (역할 포함 — 칩 색상용). B안 하단 명단에서 사용.
  const selectedAttendees = useMemo(() => {
    const norm = (s: string) => s.replace(/\s+/g, '');
    const names = namesByDate[fmtDate(selectedDate)] ?? [];
    return names.map((name) => ({
      id: `sheet-${name}`,
      name,
      role: roleByName.get(norm(name)) ?? null,
    }));
  }, [namesByDate, roleByName, selectedDate]);

  // 오늘 출근 인원(상단 슬림 요약용)
  const todayCount = (namesByDate[todaySeoulISODate()] ?? []).length;

  // 작성/수정 다이얼로그
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null=신규
  const [formPart, setFormPart] = useState<string>(PART_OPTIONS[0].code);
  const [formMemo, setFormMemo] = useState('');
  const [formItems, setFormItems] = useState<DraftChecklistItem[]>([]);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // ── 조회 범위 계산 (뷰별) ─────────────────────────────────────────────────
  const range = useMemo(() => {
    if (view === 'month') {
      const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
      const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });
      return { start: gridStart, end: gridEnd };
    }
    if (view === 'week') {
      return {
        start: startOfWeek(anchor, { weekStartsOn: 0 }),
        end: endOfWeek(anchor, { weekStartsOn: 0 }),
      };
    }
    return { start: anchor, end: anchor }; // day
  }, [view, anchor]);

  // ── 데이터 로드 ───────────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('handover_notes')
      .select('*, handover_checklist_items(*)')
      .eq('clinic_id', clinic.id)
      .gte('target_date', fmtDate(range.start))
      .lte('target_date', fmtDate(range.end))
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('인수인계 불러오기 실패: ' + error.message);
    } else {
      const rows = (data ?? []) as HandoverNote[];
      // 체크리스트 항목 sort_order 정렬
      rows.forEach((n) => {
        n.handover_checklist_items?.sort((a, b) => a.sort_order - b.sort_order);
      });
      setNotes(rows);
    }
    setLoading(false);
  }, [clinic, range.start, range.end]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // ── 파트 필터 적용 ────────────────────────────────────────────────────────
  const visibleNotes = useMemo(
    () => (partFilter === 'all' ? notes : notes.filter((n) => n.part_code === partFilter)),
    [notes, partFilter],
  );

  /** 날짜별 인수인계 개수 (배지용) */
  const countByDate = useMemo(() => {
    const map: Record<string, number> = {};
    visibleNotes.forEach((n) => {
      map[n.target_date] = (map[n.target_date] ?? 0) + 1;
    });
    return map;
  }, [visibleNotes]);

  /** 선택 날짜의 인수인계 목록 */
  const selectedNotes = useMemo(
    () => visibleNotes.filter((n) => n.target_date === fmtDate(selectedDate)),
    [visibleNotes, selectedDate],
  );

  const isOwner = (n: HandoverNote) => !!profile?.id && n.author_id === profile.id;
  // T-20260609-foot-HANDOVER-ADMIN-DELETE: 관리자(총괄)=admin/manager 는 타인 카드도 삭제 가능.
  //   수정(update)은 본 건 범위 외 — AC-5: 작성자 본인 한정 유지(canon HANDOVER-BOARD AC-7).
  //   UI 게이트뿐 아니라 DB RLS(handover_notes_delete)도 동일 정책으로 강제(AC-4).
  const canManageAll = profile?.role === 'admin' || profile?.role === 'manager';
  const canDelete = (n: HandoverNote) => isOwner(n) || canManageAll;

  // ── 이동 ──────────────────────────────────────────────────────────────────
  const goPrev = () => {
    if (view === 'month') setAnchor((d) => subMonths(d, 1));
    else if (view === 'week') setAnchor((d) => subWeeks(d, 1));
    else setAnchor((d) => addDays(d, -1));
  };
  const goNext = () => {
    if (view === 'month') setAnchor((d) => addMonths(d, 1));
    else if (view === 'week') setAnchor((d) => addWeeks(d, 1));
    else setAnchor((d) => addDays(d, 1));
  };
  const goToday = () => {
    const t = new Date();
    setAnchor(t);
    setSelectedDate(t);
  };

  const selectDate = (d: Date) => {
    setSelectedDate(d);
    if (view === 'day') setAnchor(d);
  };

  // ── 작성/수정 ─────────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingId(null);
    setFormPart(partFilter !== 'all' ? partFilter : PART_OPTIONS[0].code);
    setFormMemo('');
    setFormItems([]);
    setNewItemLabel('');
    setDialogOpen(true);
  };

  const openEdit = (n: HandoverNote) => {
    setEditingId(n.id);
    setFormPart(n.part_code);
    setFormMemo(n.memo ?? '');
    setFormItems(
      (n.handover_checklist_items ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        is_checked: c.is_checked,
        sort_order: c.sort_order,
      })),
    );
    setNewItemLabel('');
    setDialogOpen(true);
  };

  const addDraftItem = () => {
    const label = newItemLabel.trim();
    if (!label) return;
    setFormItems((prev) => [
      ...prev,
      { label, is_checked: false, sort_order: prev.length },
    ]);
    setNewItemLabel('');
  };

  const removeDraftItem = (idx: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sort_order: i })));
  };

  const toggleDraftItem = (idx: number) => {
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, is_checked: !it.is_checked } : it)));
  };

  const handleSave = async () => {
    const memo = formMemo.trim();
    const items = formItems.filter((it) => it.label.trim());
    // AC-3/AC-4: 메모만 / 체크리스트만 / 둘 다 허용 — 단, 완전 빈 인수인계는 막음
    if (!memo && items.length === 0) {
      toast.error('메모 또는 체크리스트 항목을 1개 이상 입력해주세요');
      return;
    }
    const activeClinic = clinic ?? (await getClinic().catch(() => null));
    if (!activeClinic) {
      toast.error('클리닉 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setSaving(true);
    try {
      if (editingId === null) {
        // ── 신규 ──
        const { data: inserted, error } = await supabase
          .from('handover_notes')
          .insert({
            clinic_id: activeClinic.id,
            part_code: formPart,
            target_date: fmtDate(selectedDate),
            author_id: profile?.id ?? null,
            author_name: profile?.name ?? profile?.email ?? null,
            memo: memo || null,
          })
          .select()
          .single();
        if (error || !inserted) {
          toast.error('저장 실패: ' + (error?.message ?? '알 수 없는 오류'));
          return;
        }
        const noteId = (inserted as HandoverNote).id;
        if (items.length > 0) {
          const { error: ciErr } = await supabase.from('handover_checklist_items').insert(
            items.map((it, i) => ({
              handover_id: noteId,
              label: it.label.trim(),
              is_checked: it.is_checked,
              sort_order: i,
            })),
          );
          if (ciErr) {
            toast.error('체크리스트 저장 실패: ' + ciErr.message);
            // 메모는 저장됨 — 다이얼로그 유지해 재시도 가능
            await fetchNotes();
            return;
          }
        }
        toast.confirm('인수인계가 등록되었습니다');
      } else {
        // ── 수정 ──
        const { error } = await supabase
          .from('handover_notes')
          .update({ part_code: formPart, memo: memo || null })
          .eq('id', editingId);
        if (error) {
          toast.error('수정 실패: ' + error.message);
          return;
        }
        // 체크리스트 전체 교체 (단순·정확): 기존 삭제 후 재삽입
        await supabase.from('handover_checklist_items').delete().eq('handover_id', editingId);
        if (items.length > 0) {
          const { error: ciErr } = await supabase.from('handover_checklist_items').insert(
            items.map((it, i) => ({
              handover_id: editingId,
              label: it.label.trim(),
              is_checked: it.is_checked,
              sort_order: i,
            })),
          );
          if (ciErr) {
            toast.error('체크리스트 저장 실패: ' + ciErr.message);
            await fetchNotes();
            return;
          }
        }
        toast.confirm('인수인계가 수정되었습니다');
      }
      setDialogOpen(false);
      await fetchNotes();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (n: HandoverNote) => {
    if (!confirm('이 인수인계를 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('handover_notes').delete().eq('id', n.id);
    if (error) {
      toast.error('삭제 실패: ' + error.message);
      return;
    }
    toast.confirm('삭제되었습니다');
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
  };

  /** 목록에서 체크리스트 토글 (작성자 본인만, DB 영속 — AC-4) */
  const toggleListItem = async (note: HandoverNote, item: HandoverChecklistItem) => {
    if (!isOwner(note)) return;
    const next = !item.is_checked;
    // 낙관적 업데이트
    setNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? {
              ...n,
              handover_checklist_items: n.handover_checklist_items?.map((c) =>
                c.id === item.id ? { ...c, is_checked: next } : c,
              ),
            }
          : n,
      ),
    );
    const { error } = await supabase
      .from('handover_checklist_items')
      .update({ is_checked: next })
      .eq('id', item.id);
    if (error) {
      toast.error('체크 상태 저장 실패');
      await fetchNotes(); // 롤백 겸 재동기화
    }
  };

  // ── 헤더 라벨 ─────────────────────────────────────────────────────────────
  const headerLabel = useMemo(() => {
    if (view === 'month') return format(anchor, 'yyyy년 M월', { locale: ko });
    if (view === 'week') {
      const s = startOfWeek(anchor, { weekStartsOn: 0 });
      const e = endOfWeek(anchor, { weekStartsOn: 0 });
      return `${format(s, 'M.d', { locale: ko })} ~ ${format(e, 'M.d', { locale: ko })}`;
    }
    return format(selectedDate, 'yyyy년 M월 d일 (EEE)', { locale: ko });
  }, [view, anchor, selectedDate]);

  return (
    // T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL: 의사·직원 2탭 → 단일 스크롤 뷰.
    //   외곽 컨테이너 단일 스크롤(overflow-y-auto)에 [의사 근무표] → [구분선] → [인수인계(직원)] 세로 적층.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="handover-scroll-root">
      {/* ── 상단 섹션: 의사 근무표(DutyRosterTab) ──
          권한 가드(DUTY_ROSTER_ROLES) 보존 — 권한 없는 role 에게 새로 노출 금지(AC-4).
          data-testid="handover-tab-duty": 구 탭 식별자를 섹션으로 위치 이동(E2E 회귀 보존). */}
      {canSeeDutyRoster && clinic && (
        <section className="shrink-0 p-4" data-testid="handover-tab-duty">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-teal-600" />
            <h2 className="text-base font-semibold">의사 근무표</h2>
            <span className="hidden text-xs text-muted-foreground sm:inline">· 원장 근무 캘린더</span>
          </div>
          <DutyRosterTab clinic={clinic} />
        </section>
      )}

      {/* ── 구분선(divider) — 두 섹션 시각 분리(AC-3) ── */}
      {canSeeDutyRoster && (
        <div
          className="shrink-0 border-t-8 border-muted/70"
          data-testid="handover-section-divider"
        />
      )}

      {/* ── 하단 섹션: 인수인계 게시판(직원 캘린더) — 기존 그대로 ──
          data-testid="handover-tab-board": 구 탭 식별자를 섹션으로 위치 이동(E2E 회귀 보존). */}
      <section className="flex flex-col" data-testid="handover-tab-board">
      {/* 헤더 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-white/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-teal-600" />
          <h1 className="text-base font-semibold">직원 근무 캘린더</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">· 파트별 인수인계</span>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1" data-testid="handover-new-btn">
          <Plus className="h-3.5 w-3.5" /> 인수인계 작성
        </Button>
      </div>

      {/* ── 출근자 슬림 요약 배너 (T-20260608-foot-HANDOVER-ATTENDEE-LAYOUT, A안) ──
          개선 전: 상단에 오늘 출근자 전체를 칩으로 나열(가독성·동선 불편).
          개선 후: 명단은 캘린더 셀(A안)·선택일 하단(B안)으로 분산. 상단은 슬림 요약만
          유지(같은 명단을 상단·셀 양쪽 풀 중복 나열 금지, AC-A1). */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-teal-50/60 px-4 py-2"
        data-testid="handover-today-attendees"
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold text-teal-800">
          <UserCheck className="h-4 w-4" />
          <span>오늘 출근</span>
        </div>
        <span
          className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-600"
          data-testid="handover-attendees-count"
        >
          {attendeesLoading ? '…' : `${todayCount}명`}
        </span>
        <span className="text-xs text-muted-foreground" data-testid="handover-attendees-hint">
          {attendeesLoading
            ? '명단 불러오는 중…'
            : '캘린더 날짜 셀과 아래 선택일 명단에서 출근자를 확인하세요'}
        </span>
      </div>

      {/* 컨트롤 바: 뷰 토글 + 네비 + 파트 필터 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={goPrev} data-testid="handover-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-semibold" data-testid="handover-range-label">
            {headerLabel}
          </span>
          <Button variant="outline" size="icon-sm" onClick={goNext} data-testid="handover-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} className="ml-1">
            오늘
          </Button>
        </div>

        {/* AC-2: 월/주/일 3뷰 토글 */}
        <div className="inline-flex rounded-lg border bg-background p-0.5" role="tablist" data-testid="handover-view-toggle">
          {(
            [
              ['month', '월별'],
              ['week', '주별'],
              ['day', '일별'],
            ] as [CalendarView, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              data-testid={`handover-view-${v}`}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                view === v ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 파트 필터 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-white/60 px-4 py-2" data-testid="handover-part-filter">
        <button
          onClick={() => setPartFilter('all')}
          data-testid="handover-part-all"
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            partFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          전체
        </button>
        {PART_OPTIONS.map((p) => (
          <button
            key={p.code}
            onClick={() => setPartFilter(p.code)}
            data-testid={`handover-part-${p.code}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              // T-20260615-foot-MONOTONE-…-THERAPISTGREEN item3: 선택 상태 칩은 모든 part가 bg-teal-600 →
              //   tailwind teal→warm-brown 램프 리맵으로 brown 렌더. 치료사는 role 의미색(green)이라
              //   green 원복(출근자 치료사 배지 green 톤 일치). 타 role 칩은 불변(bg-teal-600 유지).
              partFilter === p.code
                ? (p.code === 'therapist' ? 'bg-green-600 text-white' : 'bg-teal-600 text-white')
                : `${partBadgeClass(p.code)} hover:opacity-80`
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 본문 — T-20260629-…-TAB-MERGE-SCROLL: 외곽 단일 스크롤이 관장(내부 flex-1/min-h-0/overflow 제거). */}
      <div className="flex flex-col p-4 gap-4 lg:flex-row">
        {/* 캘린더 영역 */}
        <div className="lg:flex-1 lg:min-w-0">
          {view === 'month' && (
            <MonthGrid
              anchor={anchor}
              selectedDate={selectedDate}
              countByDate={countByDate}
              namesByDate={namesByDate}
              onSelect={selectDate}
            />
          )}
          {view === 'week' && (
            <WeekStrip
              anchor={anchor}
              selectedDate={selectedDate}
              countByDate={countByDate}
              namesByDate={namesByDate}
              onSelect={selectDate}
            />
          )}
          {view === 'day' && (
            <div className="rounded-lg border bg-white p-3 text-center text-sm text-muted-foreground">
              {format(selectedDate, 'yyyy년 M월 d일 (EEEE)', { locale: ko })} 인수인계
              <span className="ml-1 font-semibold text-teal-700">
                {selectedNotes.length}건
              </span>
            </div>
          )}
        </div>

        {/* 선택 날짜 인수인계 목록 */}
        <div className="lg:w-[380px] lg:shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-teal-600" />
              {format(selectedDate, 'M월 d일 (EEE)', { locale: ko })} 인수인계
            </div>
            <Button size="xs" variant="outline" onClick={openNew} className="gap-1">
              <Plus className="h-3 w-3" /> 작성
            </Button>
          </div>

          <div className="space-y-2" data-testid="handover-list">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</div>
            ) : selectedNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
                <ClipboardCheck className="h-7 w-7 opacity-30" />
                <span>이 날짜에 등록된 인수인계가 없습니다</span>
              </div>
            ) : (
              selectedNotes.map((n) => (
                <div
                  key={n.id}
                  data-testid="handover-card"
                  data-part={n.part_code}
                  className={`space-y-2 rounded-lg border p-3 shadow-sm ${partBoxClass(n.part_code)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${partBadgeClass(n.part_code)}`}
                    >
                      {partLabel(n.part_code)}
                    </span>
                    {(isOwner(n) || canDelete(n)) && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* 수정 = 작성자 본인 한정 (AC-5) */}
                        {isOwner(n) && (
                          <button
                            onClick={() => openEdit(n)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-teal-700"
                            title="수정"
                            data-testid="handover-edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* 삭제 = 본인 OR 관리자(admin/manager) (AC-1/AC-2) */}
                        {canDelete(n) && (
                          <button
                            onClick={() => handleDelete(n)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                            title={isOwner(n) ? '삭제' : '관리자 삭제'}
                            data-testid="handover-delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {n.memo && (
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{n.memo}</p>
                  )}

                  {n.handover_checklist_items && n.handover_checklist_items.length > 0 && (
                    <ul className="space-y-1">
                      {n.handover_checklist_items.map((it) => (
                        <li key={it.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={it.is_checked}
                            disabled={!isOwner(n)}
                            onChange={() => toggleListItem(n, it)}
                            data-testid="handover-item-check"
                            className="h-4 w-4 accent-teal-600 disabled:opacity-60"
                          />
                          <span
                            className={`text-sm ${it.is_checked ? 'text-muted-foreground line-through' : 'text-gray-700'}`}
                          >
                            {it.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{n.author_name ?? '직원'}</span>
                    <span>{format(parseISO(n.created_at), 'HH:mm')}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── 선택일 출근자 명단 (T-20260608-foot-HANDOVER-ATTENDEE-LAYOUT, B안) ──
              날짜 클릭 → 인수인계 목록 아래에 그날 출근자를 펼침. 데이터 없는 날=빈 문구. */}
          <div className="mt-4 border-t pt-3" data-testid="handover-selected-attendees">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-teal-800">
              <UserCheck className="h-4 w-4" />
              <span>{format(selectedDate, 'M월 d일 (EEE)', { locale: ko })} 출근자</span>
              <span
                className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-600"
                data-testid="handover-selected-attendees-count"
              >
                {attendeesLoading ? '…' : `${selectedAttendees.length}명`}
              </span>
            </div>
            {attendeesLoading ? (
              <span className="text-sm text-muted-foreground">불러오는 중…</span>
            ) : selectedAttendees.length === 0 ? (
              <span
                className="text-sm text-muted-foreground"
                data-testid="handover-selected-attendees-empty"
              >
                출근자 없음
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {selectedAttendees.map((a) => (
                  // 칩 배경을 역할별로 분기 (T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR)
                  <span
                    key={a.id}
                    data-testid="handover-selected-attendee-chip"
                    data-role={a.role ?? ''}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 shadow-sm ${staffRoleCardClass(a.role ?? '')}`}
                  >
                    <span className="text-sm font-semibold">{a.name}</span>
                    {a.role && (
                      <span className="text-[11px] font-medium opacity-70">
                        {STAFF_ROLE_LABEL[a.role] ?? a.role}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 작성/수정 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="handover-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingId === null ? '인수인계 작성' : '인수인계 수정'} ·{' '}
              {format(selectedDate, 'M월 d일 (EEE)', { locale: ko })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 파트 선택 */}
            <div>
              <Label className="text-xs">파트 <span className="text-red-500">*</span></Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="handover-form-part">
                {PART_OPTIONS.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setFormPart(p.code)}
                    data-testid={`handover-form-part-${p.code}`}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      // T-20260615-foot-MONOTONE-…-THERAPISTGREEN item3: 치료사 선택 칩 green 원복(필터 칩과 동일 의미색)
                      formPart === p.code
                        ? (p.code === 'therapist' ? 'bg-green-600 text-white' : 'bg-teal-600 text-white')
                        : `${partBadgeClass(p.code)} hover:opacity-80`
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div>
              <Label className="text-xs">메모</Label>
              <Textarea
                value={formMemo}
                onChange={(e) => setFormMemo(e.target.value)}
                placeholder="인계 내용을 입력하세요"
                rows={3}
                className="mt-1 text-sm"
                data-testid="handover-form-memo"
              />
            </div>

            {/* 체크리스트 */}
            <div>
              <Label className="text-xs">체크리스트</Label>
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDraftItem();
                    }
                  }}
                  placeholder="항목 입력 후 추가"
                  className="h-9 flex-1 text-sm"
                  data-testid="handover-form-item-input"
                />
                <Button type="button" size="sm" variant="outline" onClick={addDraftItem} data-testid="handover-form-item-add">
                  추가
                </Button>
              </div>
              {formItems.length > 0 && (
                <ul className="mt-2 space-y-1" data-testid="handover-form-item-list">
                  {formItems.map((it, idx) => (
                    <li key={idx} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={it.is_checked}
                        onChange={() => toggleDraftItem(idx)}
                        className="h-4 w-4 accent-teal-600"
                      />
                      <span className={`flex-1 text-sm ${it.is_checked ? 'text-muted-foreground line-through' : ''}`}>
                        {it.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDraftItem(idx)}
                        className="rounded p-0.5 text-muted-foreground hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="flex-1" data-testid="handover-form-save">
                {saving ? '저장 중…' : '저장'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                취소
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </section>
      {/* /T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL 단일 스크롤 뷰 끝 */}
    </div>
  );
}

// ── 셀 내 출근자 (A안, AC-A3 오버플로) ────────────────────────────────────────
// 좁은 캘린더 셀에 그날 출근자를 표시. 상위 max명 + "+N" 으로 레이아웃 무붕괴.
function CellAttendees({
  names,
  max,
  dateKey,
}: {
  names: string[];
  max: number;
  dateKey: string;
}) {
  if (!names || names.length === 0) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div
      className="mt-1 flex w-full flex-col items-stretch gap-0.5 overflow-hidden"
      data-testid={`handover-cell-attendees-${dateKey}`}
    >
      {shown.map((nm) => (
        <span
          key={nm}
          className="truncate rounded bg-teal-50 px-1 text-[9px] font-medium leading-tight text-teal-700"
          title={nm}
        >
          {nm}
        </span>
      ))}
      {rest > 0 && (
        <span className="px-1 text-[9px] font-medium leading-tight text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  );
}

// ── 월별 그리드 ──────────────────────────────────────────────────────────────
function MonthGrid({
  anchor,
  selectedDate,
  countByDate,
  namesByDate,
  onSelect,
}: {
  anchor: Date;
  selectedDate: Date;
  countByDate: Record<string, number>;
  namesByDate: Record<string, string[]>;
  onSelect: (d: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="rounded-lg border bg-white p-2">
      <div className="grid grid-cols-7">
        {weekdays.map((w, i) => (
          <div
            key={w}
            className={`py-1.5 text-center text-xs font-semibold ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground'
            }`}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const key = fmtDate(d);
          const count = countByDate[key] ?? 0;
          const inMonth = isSameMonth(d, anchor);
          const isSelected = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, new Date());
          const dow = d.getDay();
          return (
            <button
              key={key}
              onClick={() => onSelect(d)}
              data-testid={`handover-day-${key}`}
              className={`flex min-h-[64px] flex-col items-center rounded-md border p-1 transition-colors ${
                isSelected ? 'border-teal-500 bg-teal-50' : 'border-transparent hover:bg-muted/50'
              } ${inMonth ? '' : 'opacity-35'}`}
            >
              <span
                className={`text-xs font-medium ${
                  isToday
                    ? 'flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-white'
                    : dow === 0
                      ? 'text-red-500'
                      : dow === 6
                        ? 'text-blue-500'
                        : 'text-gray-700'
                }`}
              >
                {format(d, 'd')}
              </span>
              {count > 0 && (
                <span
                  className="mt-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold text-white"
                  data-testid={`handover-badge-${key}`}
                >
                  {count}
                </span>
              )}
              <CellAttendees names={namesByDate[key] ?? []} max={3} dateKey={key} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 주별 스트립 ──────────────────────────────────────────────────────────────
function WeekStrip({
  anchor,
  selectedDate,
  countByDate,
  namesByDate,
  onSelect,
}: {
  anchor: Date;
  selectedDate: Date;
  countByDate: Record<string, number>;
  namesByDate: Record<string, string[]>;
  onSelect: (d: Date) => void;
}) {
  const start = startOfWeek(anchor, { weekStartsOn: 0 });
  const end = endOfWeek(anchor, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });

  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const key = fmtDate(d);
        const count = countByDate[key] ?? 0;
        const isSelected = isSameDay(d, selectedDate);
        const isToday = isSameDay(d, new Date());
        const dow = d.getDay();
        return (
          <button
            key={key}
            onClick={() => onSelect(d)}
            data-testid={`handover-day-${key}`}
            className={`flex min-h-[88px] flex-col items-center rounded-lg border p-2 transition-colors ${
              isSelected ? 'border-teal-500 bg-teal-50' : 'border-border hover:bg-muted/50'
            }`}
          >
            <span
              className={`text-[11px] font-medium ${
                dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-muted-foreground'
              }`}
            >
              {['일', '월', '화', '수', '목', '금', '토'][dow]}
            </span>
            <span
              className={`mt-0.5 text-sm font-semibold ${
                isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-white' : 'text-gray-800'
              }`}
            >
              {format(d, 'd')}
            </span>
            {count > 0 && (
              <span
                className="mt-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold text-white"
                data-testid={`handover-badge-${key}`}
              >
                {count}
              </span>
            )}
            <CellAttendees names={namesByDate[key] ?? []} max={4} dateKey={key} />
          </button>
        );
      })}
    </div>
  );
}
