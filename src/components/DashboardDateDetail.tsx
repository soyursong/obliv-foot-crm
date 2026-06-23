/**
 * DashboardDateDetail — 대시보드 하단 인라인 현황 패널
 * T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [6]
 *
 * 사이드바 달력에서 날짜 클릭(대시보드 한정) 시 페이지 이동 없이 대시보드 하단에
 * 해당 날짜의 (1) 근무스케줄 + (2) 인수인계를 인라인 표시한다.
 *
 * ★기존 데이터 재활용(신규 테이블/EF/컬럼 0):
 *   - 근무스케줄 = fetchAttendeesByDate(duty-sheet-read EF, 기존) + fetchActiveStaff(staff, 기존).
 *     이름→role 매칭으로 파트(의사/실장/코디/치료) 그룹핑(CalendarNoticePanel ROSTER_PARTS와 동일 규칙).
 *   - 인수인계 = handover_notes(기존 테이블) target_date 필터 + handover_checklist_items 조인.
 *   graceful: 시트/조회 실패 시 throw 없이 "정보 없음" 표시(대시보드 본문 영향 0).
 */
import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Users, ClipboardCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchActiveStaff } from '@/lib/autoAssign';
import { fetchAttendeesByDate } from '@/lib/dutySheet';
import { partLabel, partBadgeClass, type HandoverNote } from '@/lib/handover';
import type { StaffRole } from '@/lib/types';
import { cn } from '@/lib/utils';

/** 파트(라벨) ↔ staff.role 매핑 — CalendarNoticePanel ROSTER_PARTS와 동일 규칙 SSOT. */
const ROSTER_PARTS: { label: string; roles: StaffRole[] }[] = [
  { label: '의사', roles: ['director'] },
  { label: '실장', roles: ['consultant'] },
  { label: '코디', roles: ['coordinator'] },
  { label: '치료', roles: ['therapist'] },
];

interface Props {
  /** YYYY-MM-DD */
  dateStr: string;
  clinicId: string | null | undefined;
  onClose: () => void;
}

export default function DashboardDateDetail({ dateStr, clinicId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [rosterParts, setRosterParts] = useState<{ label: string; names: string[] }[] | null>(null);
  const [notes, setNotes] = useState<HandoverNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      // ── 근무스케줄 (graceful) ──
      try {
        const staffList = await fetchActiveStaff(clinicId);
        const byDate = await fetchAttendeesByDate(undefined, staffList.map((s) => s.name).filter(Boolean));
        const attendeeNames = new Set(byDate[dateStr] ?? []);
        // 이름→role 매칭으로 파트 그룹핑. (이름 충돌은 현장 데이터상 무시 가능 수준 — 기존 roster 규칙 동일)
        const parts = ROSTER_PARTS.map((p) => ({
          label: p.label,
          names: staffList
            .filter((s) => p.roles.includes(s.role) && attendeeNames.has(s.name))
            .map((s) => s.name)
            .filter(Boolean),
        }));
        if (!cancelled) setRosterParts(parts);
      } catch (e) {
        console.warn('[DashboardDateDetail] 근무스케줄 로드 실패:', e);
        if (!cancelled) setRosterParts(null);
      }
      // ── 인수인계 (graceful) ──
      try {
        const { data } = await supabase
          .from('handover_notes')
          .select('*, handover_checklist_items(*)')
          .eq('clinic_id', clinicId)
          .eq('target_date', dateStr)
          .order('created_at', { ascending: true });
        const rows = (data ?? []) as HandoverNote[];
        rows.forEach((n) => n.handover_checklist_items?.sort((a, b) => a.sort_order - b.sort_order));
        if (!cancelled) setNotes(rows);
      } catch (e) {
        console.warn('[DashboardDateDetail] 인수인계 로드 실패:', e);
        if (!cancelled) setNotes([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [dateStr, clinicId]);

  const dateLabel = (() => {
    try { return format(parseISO(dateStr), 'M월 d일 (EEE)', { locale: ko }); }
    catch { return dateStr; }
  })();

  const hasRoster = rosterParts && rosterParts.some((p) => p.names.length > 0);

  return (
    <div
      data-testid="dashboard-date-detail"
      className="shrink-0 border-t bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.04)] max-h-[38vh] overflow-y-auto"
    >
      {/* 헤더 */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-white/90 px-4 py-2 backdrop-blur">
        <CalendarDays className="h-4 w-4 text-teal-600 shrink-0" />
        <span className="text-sm font-semibold" data-testid="dashboard-date-detail-label">
          {dateLabel} 현황
        </span>
        <button
          data-testid="dashboard-date-detail-close"
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="현황 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 py-3 md:grid-cols-2">
        {/* ── 근무스케줄 ── */}
        <section data-testid="dashboard-date-detail-roster">
          <div className="mb-2 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold">근무스케줄</span>
          </div>
          {loading ? (
            <div className="py-2 text-[11px] text-muted-foreground">불러오는 중…</div>
          ) : !hasRoster ? (
            <div className="py-2 text-[11px] text-muted-foreground">근무 정보가 없습니다</div>
          ) : (
            <div className="space-y-1">
              {rosterParts!.map((p) => (
                <div key={p.label} className="flex items-start gap-1.5 text-[11px]">
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
        </section>

        {/* ── 인수인계 ── */}
        <section data-testid="dashboard-date-detail-handover">
          <div className="mb-2 flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold">인수인계</span>
          </div>
          {loading ? (
            <div className="py-2 text-[11px] text-muted-foreground">불러오는 중…</div>
          ) : notes.length === 0 ? (
            <div className="py-2 text-[11px] text-muted-foreground">인수인계가 없습니다</div>
          ) : (
            <div className="space-y-1.5">
              {notes.map((n) => (
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
        </section>
      </div>
    </div>
  );
}
