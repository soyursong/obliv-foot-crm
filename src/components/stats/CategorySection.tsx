import { useMemo } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import { categoryLabel, type CategoryRow } from '@/lib/stats';

interface Props {
  rows: CategoryRow[];
  loading: boolean;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#a855f7', '#64748b'];

export default function CategorySection({ rows, loading }: Props) {
  const total = useMemo(() => rows.reduce((a, b) => a + (b.amount ?? 0), 0), [rows]);

  const chartData = useMemo(
    () =>
      rows
        .filter((r) => (r.amount ?? 0) > 0)
        .map((r) => ({
          name: categoryLabel(r.category),
          value: r.amount,
        })),
    [rows],
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">2. 시술 종류별 매출</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">카테고리 비중</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
            ) : chartData.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {chartData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatAmount(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">카테고리 표</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">
                {loading ? '로딩 중…' : '데이터 없음'}
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">카테고리</th>
                      <th className="pb-2 font-medium text-right">회차/건수</th>
                      <th className="pb-2 font-medium text-right">매출액</th>
                      <th className="pb-2 font-medium text-right">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const ratio = total > 0 ? (r.amount / total) * 100 : 0;
                      return (
                        <tr key={r.category} className="border-b last:border-0">
                          <td className="py-2 font-medium">{categoryLabel(r.category)}</td>
                          <td className="py-2 text-right tabular-nums">{r.sessions}</td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {formatAmount(r.amount)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {ratio.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
