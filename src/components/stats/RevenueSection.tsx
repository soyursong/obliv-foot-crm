import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import type { RevenueRow } from '@/lib/stats';
import type { MtmCardMetrics } from '@/lib/mtmSales';

interface Props {
  rows: RevenueRow[];
  loading: boolean;
  // T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (01): 매출통계 카드 확장 지표.
  //   급여/비급여/실시술(선수금차감)/내원환자/결제건수 = fetchMtmCardMetrics(read-only SSOT).
  //   예상월매출(추정) = projectMonthlyRevenue(당월 경과일 일평균×총일수) — 현재월만, 과거월 null('-').
  metrics?: MtmCardMetrics | null;
  projectedMonthly?: number | null;
}

export default function RevenueSection({ rows, loading, metrics, projectedMonthly }: Props) {
  const totals = useMemo(() => {
    let pkg = 0;
    let single = 0;
    let refund = 0;
    for (const r of rows) {
      pkg += r.package_amount ?? 0;
      single += r.single_amount ?? 0;
      refund += r.refund_amount ?? 0;
    }
    return {
      pkg,
      single,
      refund,
      // 누적매출(순) = pkg + single − refund (기존 '총 매출(순)' 정의 불변 · SSOT).
      total: pkg + single - refund,
    };
  }, [rows]);

  // 객단가 = 누적매출(순) ÷ 내원환자 수. 내원환자 0 → null('-', 0 나눗셈 방지).
  const arpu = useMemo(() => {
    if (!metrics || metrics.visitPatients <= 0) return null;
    return totals.total / metrics.visitPatients;
  }, [metrics, totals.total]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: r.dt.slice(5),
        package: r.package_amount,
        single: r.single_amount,
      })),
    [rows],
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">1. 매출 통계</h2>

      {/* 매출 요약 KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="누적매출 (순)" value={totals.total} unit="원" accent="text-teal-700" />
        <KpiCard title="예상월매출 (추정)" value={projectedMonthly ?? null} unit="원" accent="text-teal-600" />
        <KpiCard title="패키지 판매액" value={totals.pkg} unit="원" accent="text-emerald-700" />
        <KpiCard title="단건 매출" value={totals.single} unit="원" accent="text-blue-700" />
      </div>

      {/* 급여/비급여 · 실시술매출 · 환불 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="급여 매출" value={metrics ? metrics.salaryRevenue : null} unit="원" accent="text-indigo-700" />
        <KpiCard title="비급여 매출" value={metrics ? metrics.nonSalaryRevenue : null} unit="원" accent="text-violet-700" />
        <KpiCard
          title="실제 시술 매출 (선수금차감)"
          value={metrics ? metrics.actualTreatmentRevenue : null}
          unit="원"
          accent="text-cyan-700"
        />
        <KpiCard title="환불액" value={totals.refund} unit="원" accent="text-rose-700" />
      </div>

      {/* 내원/결제 지표 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="내원환자 수" value={metrics ? metrics.visitPatients : null} unit="명" accent="text-slate-700" />
        <KpiCard title="결제건수" value={metrics ? metrics.paymentCount : null} unit="건" accent="text-slate-700" />
        <KpiCard title="객단가" value={arpu} unit="원" accent="text-amber-700" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">일별 매출 추이</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
          ) : chartData.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${Math.round(v / 10000)}만`}
                />
                <Tooltip formatter={(v) => formatAmount(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="package" name="패키지" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="single" name="단건" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function KpiCard({
  title,
  value,
  accent,
  unit = '',
}: {
  title: string;
  value: number | null;
  accent: string;
  unit?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${accent}`}>
          {value === null ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            `${formatAmount(value)}${unit}`
          )}
        </div>
      </CardContent>
    </Card>
  );
}
