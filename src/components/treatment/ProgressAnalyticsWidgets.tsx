// ProgressAnalyticsWidgets.tsx — 치료테이블 §③ '경과분석' 탭 상단 위젯 묶음
// Ticket: T-20260630-foot-TXTABLE-PROGRESS-TAB-WIDGETS
//   배경: 김주연 총괄 "사이드바-치료테이블-경과분석 탭 / 다양하게 3~4개 넣어줘"(의도적으로 열린 요청 → dev 선택권).
//   surface 현실: '경과분석' 탭은 단일 환자 선택 컨텍스트가 없는 '당일 경과분석 대상자(코호트) 리스트'.
//     → 환자 1인 타임라인/전·후 비교는 이 화면이 못 주는 데이터(빈껍데기 위험) → 제외.
//     → 코호트(선택일 대상자) + 최근 추이를 실데이터로 집계하는 위젯 3종을 채택(전부 read-only).
//   위젯(기존 대상자 리스트 = 4번째 섹션, 본 컴포넌트가 1~3):
//     ① 누적 요약 카드(KPI 4) — 오늘 대상 / 최근 7일 누적 / 최근 14일 일평균 / 오늘 평균 회차.
//     ② 회차 진행 분포(막대) — 선택일 대상자를 경과분석 회차(label)별로 그룹 카운트.
//     ③ 최근 14일 경과분석 추이(영역) — 일자별 경과분석 대상 예약 건수.
//   데이터: reservations.progress_check_required / progress_check_label (T-PROGRESS-CHECKPOINT 트리거가 자동 마킹한 SSOT) read-only 집계.
//     신규 스키마/컬럼/트리거 0 (db_change=none). recharts 기존 사용분 재사용(신규 npm 0).
//   방어성: ADDITIVE 컬럼 미적용 prod(42703/PGRST204) → 빈 시리즈 폴백(섹션 무파손). ProgressTargetsSection 선례 동일.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { Loader2, TrendingUp, BarChart3, CalendarRange, Users, Layers, Activity } from 'lucide-react';

/** 경과분석 회차 라벨에서 회차 숫자 추출 ("6회 경과분석" → 6). 없으면 null. */
export function parseProgressSession(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 본 위젯이 필요로 하는 당일 코호트 행의 최소 형태 (ProgressTargetsSection 의 행에서 추출). */
export interface ProgressCohortRow {
  label: string | null;
}

const WINDOW_DAYS = 14;
const RECENT_DAYS = 7;

interface TrendPoint {
  date: string; // yyyy-MM-dd
  count: number;
}

// 선택일 기준 최근 WINDOW_DAYS 일간 경과분석 대상 예약 건수(일자별) read-only 집계.
function useProgressTrend(clinicId: string | null | undefined, date: string) {
  return useQuery<TrendPoint[]>({
    queryKey: ['progress_trend', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const start = format(subDays(new Date(date + 'T12:00:00'), WINDOW_DAYS - 1), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('reservations')
        .select('reservation_date, progress_check_required, status')
        .eq('clinic_id', clinicId)
        .gte('reservation_date', start)
        .lte('reservation_date', date)
        .eq('progress_check_required', true)
        .neq('status', 'cancelled');
      if (error) {
        if (/progress_check_required|progress_check_label|42703|PGRST204/.test(error.message ?? '')) return [];
        throw error;
      }

      const counts = new Map<string, number>();
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const d = String(r['reservation_date'] ?? '').slice(0, 10);
        if (!d) continue;
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }

      // 빈 날짜를 0 으로 채워 연속 시리즈 구성(추이 그래프 끊김 방지).
      const series: TrendPoint[] = [];
      for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
        const d = format(subDays(new Date(date + 'T12:00:00'), i), 'yyyy-MM-dd');
        series.push({ date: d, count: counts.get(d) ?? 0 });
      }
      return series;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

const BAR_COLORS = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#0f766e'];

interface Props {
  date: string;
  clinicId: string | null | undefined;
  cohortRows: ProgressCohortRow[];
  cohortLoading: boolean;
}

export default function ProgressAnalyticsWidgets({ date, clinicId, cohortRows, cohortLoading }: Props) {
  const { data: trend = [], isLoading: trendLoading } = useProgressTrend(clinicId, date);

  // ── ② 회차 진행 분포 (선택일 대상자) ──
  const distribution = useMemo(() => {
    const counts = new Map<string, { order: number; count: number }>();
    for (const r of cohortRows) {
      const n = parseProgressSession(r.label);
      const key = n != null ? `${n}회` : (r.label?.trim() || '기타');
      const order = n != null ? n : 9999;
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { order, count: 1 });
    }
    return [...counts.entries()]
      .map(([label, v]) => ({ label, count: v.count, order: v.order }))
      .sort((a, b) => a.order - b.order);
  }, [cohortRows]);

  // ── ① KPI 집계 ──
  const kpi = useMemo(() => {
    const todayCount = cohortRows.length;
    const sessions = cohortRows.map((r) => parseProgressSession(r.label)).filter((n): n is number => n != null);
    const avgSession = sessions.length > 0 ? sessions.reduce((a, b) => a + b, 0) / sessions.length : null;

    const recentCutoff = format(subDays(new Date(date + 'T12:00:00'), RECENT_DAYS - 1), 'yyyy-MM-dd');
    const recent7 = trend.filter((p) => p.date >= recentCutoff).reduce((a, p) => a + p.count, 0);
    const total14 = trend.reduce((a, p) => a + p.count, 0);
    const avg14 = trend.length > 0 ? total14 / trend.length : 0;

    return { todayCount, avgSession, recent7, avg14 };
  }, [cohortRows, trend, date]);

  const trendHasData = trend.some((p) => p.count > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="progress-analytics-widgets">
      {/* ── ① 누적 요약 카드 ── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="progress-kpi-cards">
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          title="오늘 경과분석 대상"
          value={cohortLoading ? '…' : `${kpi.todayCount}`}
          unit="명"
          testid="progress-kpi-today"
        />
        <KpiCard
          icon={<CalendarRange className="h-4 w-4" />}
          title="최근 7일 누적"
          value={trendLoading ? '…' : `${kpi.recent7}`}
          unit="건"
          testid="progress-kpi-recent7"
        />
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          title="최근 14일 일평균"
          value={trendLoading ? '…' : kpi.avg14.toFixed(1)}
          unit="건/일"
          testid="progress-kpi-avg14"
        />
        <KpiCard
          icon={<Layers className="h-4 w-4" />}
          title="오늘 평균 회차"
          value={cohortLoading ? '…' : kpi.avgSession != null ? kpi.avgSession.toFixed(1) : '—'}
          unit={kpi.avgSession != null ? '회차' : ''}
          testid="progress-kpi-avgsession"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ── ② 회차 진행 분포 ── */}
        <WidgetCard
          icon={<BarChart3 className="h-4 w-4 text-teal-600" />}
          title="회차 진행 분포"
          subtitle="선택일 대상자를 경과분석 회차별로 집계"
          testid="progress-distribution-widget"
        >
          {cohortLoading ? (
            <ChartLoading />
          ) : distribution.length === 0 ? (
            <WidgetEmpty
              icon={<BarChart3 className="h-5 w-5 text-muted-foreground/40" />}
              text="선택일 경과분석 대상자가 없습니다."
              testid="progress-distribution-empty"
            />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={distribution} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${Number(v)}명`, '대상']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {distribution.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        {/* ── ③ 최근 14일 경과분석 추이 ── */}
        <WidgetCard
          icon={<TrendingUp className="h-4 w-4 text-teal-600" />}
          title="최근 14일 경과분석 추이"
          subtitle="일자별 경과분석 대상 예약 건수"
          testid="progress-trend-widget"
        >
          {trendLoading ? (
            <ChartLoading />
          ) : !trendHasData ? (
            <WidgetEmpty
              icon={<TrendingUp className="h-5 w-5 text-muted-foreground/40" />}
              text="최근 14일간 경과분석 이력이 없습니다."
              testid="progress-trend-empty"
            />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="progressTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(d) => format(new Date(String(d) + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko })}
                  formatter={(v) => [`${Number(v)}건`, '경과분석']}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#0d9488"
                  strokeWidth={2}
                  fill="url(#progressTrendFill)"
                  dot={{ r: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  title,
  value,
  unit,
  testid,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  unit: string;
  testid: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-2.5" data-testid={testid}>
      <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <span className="text-teal-600">{icon}</span>
        {title}
      </p>
      <p className="mt-1 flex items-baseline gap-0.5">
        <span className="text-xl font-bold tabular-nums text-foreground" data-testid={`${testid}-value`}>
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

function WidgetCard({
  icon,
  title,
  subtitle,
  testid,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-3" data-testid={testid}>
      <div className="mb-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          {icon}
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ChartLoading() {
  return (
    <div className="flex h-[200px] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function WidgetEmpty({ icon, text, testid }: { icon: React.ReactNode; text: string; testid: string }) {
  return (
    <div
      className="flex h-[200px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-center text-[13px] text-muted-foreground"
      data-testid={testid}
    >
      {icon}
      {text}
    </div>
  );
}
