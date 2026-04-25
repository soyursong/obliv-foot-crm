import { useEffect, useMemo, useState } from 'react';
import { format, subDays, startOfMonth, endOfMonth, startOfDay } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

interface Props {
  clinicId: string;
}

type Row = { dt: string; clinic_id: string; [k: string]: unknown };

type ChartDef = {
  key: string;
  title: string;
  view: string;
  field: string;
  unit: '분' | '만원' | '건' | '%';
  color: string;
  transform?: (v: number) => number;
};

const WON_TO_MAN = (v: number) => Math.round((v / 10000) * 10) / 10;

const CHARTS: ChartDef[] = [
  { key: 'wait', title: '평균 상담 대기시간', view: 'v_daily_consult_wait',  field: 'avg_wait_min',   unit: '분',   color: '#3b82f6' },
  { key: 'stay', title: '평균 체류시간',      view: 'v_daily_stay_duration', field: 'avg_stay_min',   unit: '분',   color: '#8b5cf6' },
  { key: 'rev',  title: '일 매출',           view: 'v_daily_revenue',       field: 'net_revenue',    unit: '만원', color: '#10b981', transform: WON_TO_MAN },
  { key: 'vis',  title: '일 내원수',         view: 'v_daily_visits',        field: 'visit_count',    unit: '건',   color: '#f59e0b' },
  { key: 'avg',  title: '평균 객단가',       view: 'v_daily_avg_spend',     field: 'avg_spend',      unit: '만원', color: '#ef4444', transform: WON_TO_MAN },
  { key: 'rate', title: '내원율',            view: 'v_daily_visit_rate',    field: 'visit_rate_pct', unit: '%',    color: '#06b6d4' },
];

export default function DailyTrendsTab({ clinicId }: Props) {
  const [from, setFrom] = useState<Date>(subDays(startOfDay(new Date()), 29));
  const [to, setTo] = useState<Date>(startOfDay(new Date()));
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(false);

  const setPreset = (days: number) => {
    setTo(startOfDay(new Date()));
    setFrom(startOfDay(subDays(new Date(), days)));
  };

  useEffect(() => {
    if (!clinicId) return;
    const load = async () => {
      setLoading(true);
      const fromStr = format(from, 'yyyy-MM-dd');
      const toStr = format(to, 'yyyy-MM-dd');
      const next: Record<string, Row[]> = {};
      await Promise.all(
        CHARTS.map(async (c) => {
          const { data: rows } = await supabase
            .from(c.view)
            .select('*')
            .eq('clinic_id', clinicId)
            .gte('dt', fromStr)
            .lte('dt', toStr);
          next[c.key] = (rows ?? []) as Row[];
        }),
      );
      setData(next);
      setLoading(false);
    };
    load();
  }, [clinicId, from, to]);

  const chartData = useMemo(() => {
    const m: Record<string, { dt: string; value: number }[]> = {};
    CHARTS.forEach((c) => {
      const rows = data[c.key] ?? [];
      const arr = rows
        .map((r) => {
          const raw = r[c.field];
          const num = raw == null ? 0 : Number(raw);
          const val = c.transform ? c.transform(num) : num;
          return { dt: String(r.dt), value: Math.round(val * 10) / 10 };
        })
        .sort((a, b) => a.dt.localeCompare(b.dt));
      m[c.key] = arr;
    });
    return m;
  }, [data]);

  const avgOf = (arr: { value: number }[]) =>
    arr.length ? arr.reduce((s, p) => s + p.value, 0) / arr.length : 0;

  return (
    <div className="space-y-4">
      {/* 기간 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-sm font-medium">기간</span>
        <input
          type="date"
          value={format(from, 'yyyy-MM-dd')}
          onChange={(e) => e.target.value && setFrom(new Date(e.target.value))}
          className="h-8 rounded border bg-background px-2 text-sm"
        />
        <span className="text-sm">~</span>
        <input
          type="date"
          value={format(to, 'yyyy-MM-dd')}
          onChange={(e) => e.target.value && setTo(new Date(e.target.value))}
          className="h-8 rounded border bg-background px-2 text-sm"
        />
        <div className="ml-2 flex gap-1">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(6)}>최근 7일</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(13)}>최근 14일</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(29)}>최근 30일</Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              setFrom(startOfMonth(new Date()));
              setTo(endOfMonth(new Date()));
            }}
          >
            이번 달
          </Button>
        </div>
        {loading && <span className="ml-auto text-xs text-muted-foreground">로딩…</span>}
      </div>

      {/* 6 line charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CHARTS.map((c) => {
          const rows = chartData[c.key] ?? [];
          const avg = avgOf(rows);
          const avgDisp =
            c.unit === '만원' ? `${avg.toFixed(1)}만원`
            : c.unit === '%'  ? `${avg.toFixed(1)}%`
            : c.unit === '분' ? `${avg.toFixed(1)}분`
            : `${Math.round(avg).toLocaleString()}건`;
          return (
            <div key={c.key} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{c.title}</h4>
                <span className="text-xs text-muted-foreground">
                  기간 평균 <span className="font-medium text-foreground">{avgDisp}</span>
                </span>
              </div>
              {rows.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                  데이터 없음
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
                    <XAxis dataKey="dt" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v) => [`${v} ${c.unit}`, c.title]}
                      contentStyle={{ fontSize: '11px' }}
                    />
                    <Line type="monotone" dataKey="value" stroke={c.color} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        * 금액은 만원(원/10000, 소수 1자리). 평균 상담 대기시간은 체크인→상담 첫 전이 기준.
      </p>
    </div>
  );
}
