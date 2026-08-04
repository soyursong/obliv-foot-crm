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
import type { NoshowReturningRow } from '@/lib/stats';
import type { NoshowPrevCompare } from '@/lib/mtmSales';

interface Props {
  rows: NoshowReturningRow[];
  loading: boolean;
  // T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (05, AC-D): 전월 평균 노쇼율/재방문율 병기.
  //   전월 데이터 없음(신규 오픈 첫 달) → '-'/'전월 데이터 없음' (0 오도 금지).
  prev?: NoshowPrevCompare | null;
}

// 증감(당월 평균 − 전월 평균) 병기 헬퍼. 전월 값 없으면 '-'.
function prevDeltaLabel(cur: number, prevVal: number | null): { text: string; tone: string } {
  if (prevVal === null) return { text: '전월 -', tone: 'text-muted-foreground' };
  const diff = cur - prevVal;
  const sign = diff > 0 ? '+' : '';
  const tone = diff > 0 ? 'text-rose-600' : diff < 0 ? 'text-emerald-600' : 'text-muted-foreground';
  return { text: `전월 ${prevVal.toFixed(1)}% (${sign}${diff.toFixed(1)}%p)`, tone };
}

export default function NoshowReturningSection({ rows, loading, prev }: Props) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        label: r.dt.slice(5),
        noshow: Number(r.noshow_rate ?? 0),
        returning: Number(r.returning_rate ?? 0),
      })),
    [rows],
  );

  const avg = useMemo(() => {
    if (data.length === 0) return { noshow: 0, returning: 0 };
    const n = data.reduce((a, b) => a + b.noshow, 0) / data.length;
    const r = data.reduce((a, b) => a + b.returning, 0) / data.length;
    return { noshow: n, returning: r };
  }, [data]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        5. 노쇼율 / 재방문율
        {prev && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            전월({prev.prevLabel}) 비교{!prev.prevHasData && ' · 전월 데이터 없음'}
          </span>
        )}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">평균 노쇼율</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-rose-700">{avg.noshow.toFixed(1)}%</div>
            {prev && (
              <div
                data-testid="noshow-prev"
                className={`mt-1 text-xs tabular-nums ${prevDeltaLabel(avg.noshow, prev.prevNoshow).tone}`}
              >
                {prev.prevHasData ? prevDeltaLabel(avg.noshow, prev.prevNoshow).text : '전월 데이터 없음'}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">평균 재방문율</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-emerald-700">
              {avg.returning.toFixed(1)}%
            </div>
            {prev && (
              <div
                data-testid="returning-prev"
                className={`mt-1 text-xs tabular-nums ${prevDeltaLabel(avg.returning, prev.prevReturning).tone}`}
              >
                {prev.prevHasData
                  ? prevDeltaLabel(avg.returning, prev.prevReturning).text
                  : '전월 데이터 없음'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">기간별 추이</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
          ) : data.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="noshow"
                  name="노쇼율"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="returning"
                  name="재방문율"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
