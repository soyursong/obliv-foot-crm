/**
 * DutyRosterTab — 근무캘린더(듀티 로스터) 관리 탭
 * T-20260502-foot-DUTY-ROSTER
 *
 * - 주간 달력: 행 = 원장님, 열 = 날짜(월~토)
 * - 셀 클릭: 없음 → 근무 → 파트근무 → 없음 (3단 토글)
 * - 오늘 당일 근무원장님 배너 (커서 0회 확인)
 * - admin/manager 전용 (읽기는 전체)
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, startOfWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Clinic, Staff } from '@/lib/types';

// ─── 타입 ───────────────────────────────────────────────────────────────────

type RosterType = 'regular' | 'part' | 'resigned';

interface RosterRow {
  id: string;
  date: string;
  doctor_id: string;
  roster_type: RosterType;
  notes: string | null;
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const ROSTER_TYPE_LABEL: Record<RosterType, string> = {
  regular: '근무',
  part: '파트',
  resigned: '퇴사',
};

const ROSTER_TYPE_COLOR: Record<RosterType, string> = {
  regular: 'bg-teal-100 text-teal-800 border-teal-300',
  part: 'bg-amber-100 text-amber-800 border-amber-300',
  resigned: 'bg-red-100 text-red-700 border-red-300',
};

/** 셀 토글 순서: 없음 → regular → part → 없음 */
function nextRosterType(current: RosterType | null): RosterType | null {
  if (!current) return 'regular';
  if (current === 'regular') return 'part';
  return null; // part → 제거
}

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ─── DutyRosterTab ───────────────────────────────────────────────────────────

export function DutyRosterTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';

  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );

  // 월~토 6일
  const weekDays = useMemo(
    () => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const weekStartStr = format(weekDays[0], 'yyyy-MM-dd');
  const weekEndStr = format(weekDays[5], 'yyyy-MM-dd');
  const today = todayStr();

  // ── 원장님 목록 (active director)
  const { data: directors = [] } = useQuery<Staff[]>({
    queryKey: ['staff_directors', clinic.id],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('role', 'director')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  // ── 이번 주 duty_roster
  const rosterQueryKey = ['duty_roster_week', clinic.id, weekStartStr];
  const { data: rosterRows = [] } = useQuery<RosterRow[]>({
    queryKey: rosterQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('duty_roster')
        .select('id, date, doctor_id, roster_type, notes')
        .eq('clinic_id', clinic.id)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr);
      if (error) throw error;
      return (data ?? []) as RosterRow[];
    },
  });

  // ── 오늘 근무원장님 (배너용)
  const todayDoctors = useMemo(() => {
    const todayRows = rosterRows.filter(
      (r) => r.date === today && r.roster_type !== 'resigned',
    );
    return todayRows
      .map((r) => {
        const d = directors.find((s) => s.id === r.doctor_id);
        return d ? { name: d.name, roster_type: r.roster_type } : null;
      })
      .filter((x): x is { name: string; roster_type: RosterType } => !!x);
  }, [rosterRows, directors, today]);

  // ── 셀 맵: "doctorId_date" → RosterRow
  const cellMap = useMemo(() => {
    const m = new Map<string, RosterRow>();
    for (const r of rosterRows) m.set(`${r.doctor_id}_${r.date}`, r);
    return m;
  }, [rosterRows]);

  const refresh = () => qc.invalidateQueries({ queryKey: rosterQueryKey });

  // ── 셀 토글
  const handleToggle = async (doctor: Staff, dayStr: string) => {
    if (!canEdit) {
      toast.error('admin/manager만 수정할 수 있습니다');
      return;
    }
    const key = `${doctor.id}_${dayStr}`;
    const existing = cellMap.get(key);
    const next = nextRosterType(existing?.roster_type ?? null);

    if (!next) {
      // 삭제
      const { error } = await supabase
        .from('duty_roster')
        .delete()
        .eq('id', existing!.id);
      if (error) { toast.error(error.message); return; }
      toast.success(`${doctor.name} ${dayStr} 근무 해제`);
    } else if (existing) {
      // 타입 변경
      const { error } = await supabase
        .from('duty_roster')
        .update({ roster_type: next })
        .eq('id', existing.id);
      if (error) { toast.error(error.message); return; }
      toast.success(`${doctor.name} → ${ROSTER_TYPE_LABEL[next]}`);
    } else {
      // 신규 추가
      const { error } = await supabase.from('duty_roster').insert({
        clinic_id: clinic.id,
        date: dayStr,
        doctor_id: doctor.id,
        roster_type: next,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`${doctor.name} ${dayStr} 근무 등록`);
    }
    refresh();
  };

  // ── 전주 복사
  const copyPrevWeek = async () => {
    if (!canEdit) return;
    const prevStart = format(addDays(weekDays[0], -7), 'yyyy-MM-dd');
    const prevEnd = format(addDays(weekDays[5], -7), 'yyyy-MM-dd');

    const { data: prevRows, error } = await supabase
      .from('duty_roster')
      .select('date, doctor_id, roster_type, notes')
      .eq('clinic_id', clinic.id)
      .gte('date', prevStart)
      .lte('date', prevEnd);

    if (error || !prevRows?.length) {
      toast.error('전주 데이터가 없습니다');
      return;
    }

    // 날짜 오프셋 +7일
    const inserts = prevRows
      .filter((r) => r.roster_type !== 'resigned')
      .map((r) => ({
        clinic_id: clinic.id,
        date: format(addDays(new Date(r.date), 7), 'yyyy-MM-dd'),
        doctor_id: r.doctor_id,
        roster_type: r.roster_type,
        notes: r.notes,
      }));

    if (rosterRows.length > 0) {
      if (!window.confirm(`이번 주에 이미 ${rosterRows.length}건 데이터가 있습니다. 덮어쓰시겠습니까?`))
        return;
      await supabase
        .from('duty_roster')
        .delete()
        .eq('clinic_id', clinic.id)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr);
    }

    const { error: insErr } = await supabase.from('duty_roster').insert(inserts);
    if (insErr) { toast.error(insErr.message); return; }
    toast.success(`전주 복사 완료 (${inserts.length}건)`);
    refresh();
  };

  const jumpToThisWeek = () =>
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  return (
    <div className="space-y-4">
      {/* ── 오늘 근무원장님 배너 ── */}
      <Card
        className={`border-2 ${
          todayDoctors.length > 0 ? 'border-teal-300 bg-teal-50' : 'border-amber-200 bg-amber-50'
        }`}
      >
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserCheck className="h-4 w-4" />
            오늘({format(new Date(), 'M/d(EEE)', { locale: ko })}) 근무 원장님
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {todayDoctors.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                오늘 근무 원장님이 설정되지 않았습니다.{' '}
                <span className="font-medium">서류 발행 시 수동 입력이 필요합니다.</span>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {todayDoctors.map((d) => (
                <div
                  key={d.name}
                  className="flex items-center gap-1.5 rounded-full bg-white border border-teal-300 px-3 py-1 text-sm font-medium text-teal-800 shadow-sm"
                >
                  <span>{d.name}</span>
                  <Badge
                    className={`text-[10px] px-1.5 py-0 ${ROSTER_TYPE_COLOR[d.roster_type]}`}
                  >
                    {ROSTER_TYPE_LABEL[d.roster_type]}
                  </Badge>
                </div>
              ))}
              <span className="self-center text-xs text-teal-600">
                ← 서류 자동 세팅됩니다
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 주간 캘린더 헤더 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[160px] text-center text-sm font-medium">
            {format(weekDays[0], 'M/d', { locale: ko })} ~{' '}
            {format(weekDays[5], 'M/d(EEE)', { locale: ko })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={jumpToThisWeek}>
            <CalendarDays className="mr-1 h-4 w-4" />
            이번 주
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={copyPrevWeek}>
              전주 복사
            </Button>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`inline-block h-3 w-3 rounded border ${ROSTER_TYPE_COLOR.regular}`}
            />
            근무
            <span
              className={`inline-block h-3 w-3 rounded border ${ROSTER_TYPE_COLOR.part}`}
            />
            파트근무
          </div>
        </div>
      </div>

      {/* ── 근무 그리드 ── */}
      {directors.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          등록된 원장님이 없습니다. 직원 탭에서 원장님(director)을 추가하세요.
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border bg-background">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/70">
              <tr>
                <th className="w-28 border-b border-r px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                  원장님
                </th>
                {weekDays.map((d) => {
                  const ds = format(d, 'yyyy-MM-dd');
                  const isToday = ds === today;
                  return (
                    <th
                      key={ds}
                      className={`border-b border-r px-2 py-2.5 text-center text-xs font-semibold ${
                        isToday
                          ? 'bg-teal-100 text-teal-800'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {format(d, 'EEE', { locale: ko })}
                      <br />
                      <span className={isToday ? 'font-bold' : ''}>
                        {format(d, 'M/d')}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {directors.map((doctor) => (
                <tr key={doctor.id}>
                  <td className="border-b border-r px-3 py-2 text-sm font-medium whitespace-nowrap">
                    {doctor.name}
                  </td>
                  {weekDays.map((d) => {
                    const ds = format(d, 'yyyy-MM-dd');
                    const isToday = ds === today;
                    const entry = cellMap.get(`${doctor.id}_${ds}`);
                    const rtype = entry?.roster_type ?? null;

                    return (
                      <td
                        key={ds}
                        className={`border-b border-r p-1 text-center ${
                          isToday ? 'bg-teal-50/60' : ''
                        }`}
                      >
                        <button
                          className={`
                            h-10 w-full rounded-md border text-xs font-medium transition-all
                            ${
                              rtype
                                ? ROSTER_TYPE_COLOR[rtype] +
                                  ' shadow-sm hover:opacity-80'
                                : 'border-dashed border-gray-200 text-gray-300 hover:border-teal-300 hover:text-teal-400 hover:bg-teal-50/50'
                            }
                            ${!canEdit ? 'cursor-default' : 'cursor-pointer active:scale-95'}
                          `}
                          onClick={() => handleToggle(doctor, ds)}
                          disabled={!canEdit}
                          title={
                            rtype
                              ? `${ROSTER_TYPE_LABEL[rtype]} → ${
                                  rtype === 'regular'
                                    ? '파트근무로 변경'
                                    : '근무 해제'
                                }`
                              : '클릭하여 근무 등록'
                          }
                        >
                          {rtype ? ROSTER_TYPE_LABEL[rtype] : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <p className="text-xs text-muted-foreground">
          💡 셀 클릭: <strong>없음 → 근무 → 파트근무 → 없음</strong> 순으로 토글됩니다.
        </p>
      )}
    </div>
  );
}
