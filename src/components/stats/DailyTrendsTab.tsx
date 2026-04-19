import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays, startOfMonth, endOfMonth, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';

interface Props {
  clinicId: string;
}

type Row = { dt: string; clinic_id: string; [k: string]: any };

type ChartDef = {
  key: string;
  title: string;
  view: string;
  field: string;
  unit: '분' | '만원' | '건' | '%';
  color: string;
  transform?: (v: number) => number;
  fmt?: (v: number) => string;
};

const WON_TO_MAN = (v: number) => Math.round((v / 10000) * 10) / 10;

const CHARTS: ChartDef[] = [
  { key: 'wait', title: '평균 상담 대기시간', view: 'v_daily_consult_wait', field: 'avg_wait_min', unit: '분', color: '#3b82f6' },
  { key: 'stay', title: '평균 체류시간', view: 'v_daily_stay_duration', field: 'avg_stay_min', unit: '분', color: '#8b5cf6' },
  { key: 'rev',  title: '일 매출',        view: 'v_daily_revenue',       field: 'net_revenue',  unit: '만원', color: '#10b981', transform: WON_TO_MAN },
  { key: 'vis',  title: '일 내원 수',     view: 'v_daily_visits',        field: 'visit_count',  unit: '건',   color: '#f59e0b' },
  { key: 'avg',  title: '일 평균 객단가', view: 'v_daily_avg_spend',     field: 'avg_spend',    unit: '만원', color: '#ef4444', transform: WON_TO_MAN },
  { key: 'rate', title: '내원율',         view: 'v_daily_visit_rate',    field: 'visit_rate_pct', unit: '%',  color: '#06b6d4' },
];

export default function DailyTrendsTab({ clinicId }: Props) {
  const [from, setFrom] = useState<Date>(subDays(startOfDay(new Date()), 29));
  const [to, setTo] = useState<Date>(startOfDay(new Date()));
  const [allClinics, setAllClinics] = useState(false);
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(false);

  const setPreset = (days: number) => { setTo(startOfDay(new Date())); setFrom(startOfDay(subDays(new Date(), days))); };

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      setLoading(true);
      const fromStr = format(from, 'yyyy-MM-dd');
      const toStr = format(to, 'yyyy-MM-dd');
      const next: Record<string, Row[]> = {};
      await Promise.all(CHARTS.map(async (c) => {
        let q = (supabase.from(c.view as any) as any)
          .select('*')
          .gte('dt', fromStr).lte('dt', toStr);
        if (!allClinics) q = q.eq('clinic_id', clinicId);
        const { data: rows } = await q;
        next[c.key] = (rows || []) as Row[];
      }));
      setData(next);
      setLoading(false);
    })();
  }, [clinicId, from, to, allClinics]);

  // 지점 합산 처리 + 날짜별 단일 포인트로 집계
  const aggregate = (rows: Row[], c: ChartDef) => {
    const byDate = new Map<string, { sum: number; count: number; weight?: number }>();
    rows.forEach((r) => {
      const raw = r[c.field];
      if (raw == null) return;
      const v = c.transform ? c.transform(Number(raw)) : Number(raw);
      const cur = byDate.get(r.dt) || { sum: 0, count: 0 };
      // 평균성 지표는 sample_count 가중 평균, 그 외는 합산
      if (c.field === 'avg_wait_min' || c.field === 'avg_stay_min') {
        const w = Number(r.sample_count || 1);
        cur.sum += v * w;
        cur.weight = (cur.weight || 0) + w;
      } else if (c.field === 'avg_spend') {
        const w = Number(r.paid_count || 1);
        cur.sum += v * w;
        cur.weight = (cur.weight || 0) + w;
      } else if (c.field === 'visit_rate_pct') {
        // 지점 합산: 분자/분모 재계산
        const num = Number(r.checkin_count || 0);
        const den = Number(r.total_reservations || 0);
        cur.sum += num;
        cur.weight = (cur.weight || 0) + den;
      } else {
        cur.sum += v;
        cur.count += 1;
      }
      byDate.set(r.dt, cur);
    });
    const arr = Array.from(byDate.entries())
      .map(([dt, v]) => {
        let val = 0;
        if (c.field === 'avg_wait_min' || c.field === 'avg_stay_min' || c.field === 'avg_spend') {
          val = v.weight ? v.sum / v.weight : 0;
        } else if (c.field === 'visit_rate_pct') {
          val = v.weight ? (v.sum / v.weight) * 100 : 0;
        } else {
          val = v.sum;
        }
        return { dt, value: Math.round(val * 10) / 10 };
      })
      .sort((a, b) => a.dt.localeCompare(b.dt));
    return arr;
  };

  const chartData = useMemo(() => {
    const m: Record<string, { dt: string; value: number }[]> = {};
    CHARTS.forEach((c) => { m[c.key] = aggregate(data[c.key] || [], c); });
    return m;
  }, [data]);

  const avgOf = (arr: { value: number }[]) =>
    arr.length ? arr.reduce((s, p) => s + p.value, 0) / arr.length : 0;

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 bg-card p-3 rounded-lg border">
        <span className="text-sm font-medium">기간</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(from, 'yyyy-MM-dd', { locale: ko })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={from} onSelect={(d) => d && setFrom(d)} className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        <span className="text-sm">~</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(to, 'yyyy-MM-dd', { locale: ko })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={to} onSelect={(d) => d && setTo(d)} className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        <div className="flex gap-1 ml-2">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(6)}>최근 7일</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(13)}>최근 14일</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(29)}>최근 30일</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setFrom(startOfMonth(new Date())); setTo(endOfMonth(new Date())); }}>이번 달</Button>
        </div>
        <Button
          size="sm"
          variant={allClinics ? 'default' : 'outline'}
          className={`h-8 text-xs ml-auto ${allClinics ? 'bg-accent text-accent-foreground' : ''}`}
          onClick={() => setAllClinics(v => !v)}
        >
          {allClinics ? '✓ 전체 지점' : '선택 지점만'}
        </Button>
        {loading && <span className="text-xs text-muted-foreground">로딩...</span>}
      </div>

      {/* 6개 라인 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {CHARTS.map((c) => {
          const rows = chartData[c.key] || [];
          const avg = avgOf(rows);
          const avgDisp =
            c.unit === '만원' ? `${avg.toFixed(1)}만원`
            : c.unit === '%' ? `${avg.toFixed(1)}%`
            : c.unit === '분' ? `${avg.toFixed(1)}분`
            : `${Math.round(avg).toLocaleString()}건`;
          return (
            <div key={c.key} className="bg-card border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">{c.title}</h4>
                <span className="text-xs text-muted-foreground">
                  기간 평균 <span className="font-medium text-foreground">{avgDisp}</span>
                </span>
              </div>
              {rows.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">데이터 없음</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
                    <XAxis dataKey="dt" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v: any) => [`${v} ${c.unit}`, c.title]}
                      labelFormatter={(l) => l}
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
      <p className="text-[11px] text-muted-foreground px-1">
        * 금액은 만원(원/10000, 소수 1자리), 평균 체류·대기는 샘플 수 가중 평균. 지점 "전체" 선택 시 내원율은 분자·분모 합산 재계산.
      </p>
    </div>
  );
}
