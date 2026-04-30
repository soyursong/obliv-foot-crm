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

interface Props {
  rows: RevenueRow[];
  loading: boolean;
}

export default function RevenueSection({ rows, loading }: Props) {
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
      total: pkg + single - refund,
    };
  }, [rows]);

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="총 매출 (순)" value={totals.total} accent="text-teal-700" />
        <KpiCard title="패키지 매출" value={totals.pkg} accent="text-emerald-700" />
        <KpiCard title="단건 매출" value={totals.single} accent="text-blue-700" />
        <KpiCard title="환불액" value={totals.refund} accent="text-rose-700" />
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

function KpiCard({ title, value, accent }: { title: string; value: number; accent: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${accent}`}>{formatAmount(value)}</div>
      </CardContent>
    </Card>
  );
}
