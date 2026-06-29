// ProgressTargetsSection.tsx — 치료테이블 §③ '경과분석' (당일 대상자 리스트)
// Ticket: T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경2]
//   배경: 예약관리에 붙어 있던 '경과분석 ON/OFF 필터'를 회수하고([변경1]), '오늘 경과분석 대상자를 한눈에 보는 동선'을
//         치료테이블 전용 탭으로 재배치. 같은 reporter(김주연 총괄)·같은 스레드 결정.
//   AC-5: 당일(부모 공통 날짜선택기 기준, 기본=오늘) 경과분석 대상 환자 '리스트'(테이블). 캘린더·일간보기 형태 금지.
//     데이터 = reservations.progress_check_required=TRUE(체크포인트 회차) read-only 집계.
//       progress_check_required/label 은 T-PROGRESS-CHECKPOINT 트리거/플랜(PKGTYPE-DB-BIND, done)이 자동 마킹한 SSOT.
//       본 탭은 그 마킹을 read-only 소비만 — 신규 스키마/트리거 0(db_change=false).
//     컬럼: 환자(이름+차트번호) / 회차(progress_check_label) / 예약시간 / 담당자(registrar_name). 정렬=예약시각 오름차순(치료 흐름순).
//   이름 인터랙션: 좌클릭=2번차트(부모 nameInteraction.onLeftClick→useChart), 우클릭=CRM 컨텍스트 메뉴(부모 onContextMenu) — ExamTargetsSection 과 동일 재사용.
//   방어성: progress_check_required/label 미적용 prod(42703/PGRST204) → 빈 목록 폴백(섹션 무파손). ExamTargetsSection 선례 동일.

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge, seoulISODate } from '@/lib/format';
import { Loader2, TrendingUp, CalendarDays } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

interface ProgressTargetRow {
  reservationId: string;
  customerId: string | null;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  label: string | null;          // 회차 (progress_check_label, 예: "6회 경과분석")
  reservationTime: string;       // HH:mm
  registrarName: string | null;  // 담당자(예약등록자 스냅샷)
}

// reservations(progress_check_required=true, 당일, 취소 제외) → 당일 경과분석 대상자 목록(read-only).
function useProgressTargets(clinicId: string | null | undefined, date: string) {
  return useQuery<ProgressTargetRow[]>({
    queryKey: ['progress_targets', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const SEL =
        'id, customer_id, customer_name, reservation_time, registrar_name, ' +
        'progress_check_required, progress_check_label, status';
      const { data, error } = await supabase
        .from('reservations')
        .select(SEL)
        .eq('clinic_id', clinicId)
        .eq('reservation_date', date)
        .eq('progress_check_required', true)
        .neq('status', 'cancelled')
        .order('reservation_time', { ascending: true });
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703/PGRST204) → 빈 목록 폴백(페이지 무파손).
        if (/progress_check_required|progress_check_label|42703|PGRST204/.test(error.message ?? '')) return [];
        throw error;
      }

      const rows: ProgressTargetRow[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
        reservationId: String(r['id'] ?? ''),
        customerId: r['customer_id'] ? String(r['customer_id']) : null,
        customerName: String(r['customer_name'] ?? '—'),
        chartNumber: null,
        phone: null,
        label: r['progress_check_label'] ? String(r['progress_check_label']) : null,
        reservationTime: String(r['reservation_time'] ?? '').slice(0, 5),
        registrarName: r['registrar_name'] ? String(r['registrar_name']) : null,
      }));
      if (rows.length === 0) return [];

      // 차트번호·연락처 보강(read-only). 실패해도 목록은 표시(이름·회차·시간은 정상).
      try {
        const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
        if (ids.length > 0) {
          const { data: custs } = await supabase
            .from('customers')
            .select('id, chart_number, phone')
            .in('id', ids);
          const metaMap = new Map<string, { chart: string | null; phone: string | null }>();
          for (const c of (custs ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null }>) {
            if (c.id) metaMap.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null });
          }
          for (const r of rows) {
            if (!r.customerId) continue;
            const meta = metaMap.get(r.customerId);
            r.chartNumber = meta?.chart ?? null;
            r.phone = meta?.phone ?? null;
          }
        }
      } catch {
        // 보강 실패 — 무시.
      }

      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

function dateLabel(d: string) {
  return format(new Date(d + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko });
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function ProgressTargetsSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const { data: rows = [], isLoading, isError, error } = useProgressTargets(clinic?.id, date);
  const today = seoulISODate(new Date());
  const isToday = date === today;

  return (
    <div className="flex flex-col gap-2" data-testid="progress-targets-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-teal-600" />
            경과분석
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dateLabel(date)} {isToday && '(오늘) '}경과분석 체크포인트 회차에 해당하는 예약 환자를 한눈에
            보여줍니다. 예약 생성 시 패키지 경과분석 플랜에 따라 자동 표시됩니다.
          </p>
        </div>
        {rows.length > 0 && (
          <span
            className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
            data-testid="progress-targets-count"
          >
            대상 {rows.length}명
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="progress-targets-empty"
        >
          <TrendingUp className="h-5 w-5 text-muted-foreground/40" />
          {isToday ? '오늘 경과분석 대상자가 없습니다.' : '해당 날짜에 경과분석 대상자가 없습니다.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
              {dateLabel(date)}
              {isToday && (
                <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  오늘
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground" data-testid="progress-targets-group-count">
              {rows.length}명
            </span>
          </div>
          <div className="overflow-x-auto" data-testid="progress-targets-table">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] font-semibold text-muted-foreground">
                  <th className="px-2 py-1 whitespace-nowrap">#</th>
                  <th className="px-2 py-1 whitespace-nowrap">환자</th>
                  <th className="px-2 py-1 whitespace-nowrap">회차</th>
                  <th className="px-2 py-1 whitespace-nowrap">예약시간</th>
                  <th className="px-2 py-1 whitespace-nowrap">담당자</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={r.reservationId}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    data-testid="progress-targets-row"
                  >
                    <td className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">
                      {/* 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 (부모 nameInteraction 재사용) */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit"
                        data-testid="progress-name-clickable"
                        disabled={!r.customerId}
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) => {
                          if (!r.customerId) return;
                          nameInteraction.onContextMenu(e, {
                            id: r.customerId,
                            name: r.customerName,
                            phone: r.phone,
                          });
                        }}
                      >
                        <span>{r.customerName}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                          {chartNoBadge(r.chartNumber)}
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap" data-testid="progress-label-cell">
                      <span className="inline-flex items-center gap-0.5 rounded border border-teal-300 bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-800 leading-none">
                        <TrendingUp className="h-2.5 w-2.5" />
                        {r.label ?? '경과분석'}
                      </span>
                    </td>
                    <td className="px-2 py-1 tabular-nums whitespace-nowrap" data-testid="progress-time-cell">
                      {r.reservationTime || '—'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground" data-testid="progress-registrar-cell">
                      {r.registrarName ? `@${r.registrarName}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
