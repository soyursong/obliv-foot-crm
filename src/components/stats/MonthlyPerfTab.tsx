import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, startOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts';

interface Props { clinicId: string; }

type TechRow = { technician_id: string; technician_name: string; procedure_count: number; net_revenue: number; avg_stay_min: number };
type ConsRow = { consultant_id: string; consultant_name: string; consult_count: number; net_revenue: number; avg_spend: number };
type TmRow   = { tm_name: string; total_reservations: number; checkin_count: number; visit_rate: number; net_revenue: number; avg_spend: number };

const WON_TO_MAN = (v: number) => Math.round(v / 10000);
const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

export default function MonthlyPerfTab({ clinicId }: Props) {
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [allClinics, setAllClinics] = useState(false);
  const [tech, setTech] = useState<TechRow[]>([]);
  const [cons, setCons] = useState<ConsRow[]>([]);
  const [tm, setTm] = useState<TmRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      setLoading(true);
      const monthStr = format(month, 'yyyy-MM-01');
      const base = (view: string) => {
        let q: any = (supabase.from(view as any) as any).select('*').eq('month', monthStr);
        if (!allClinics) q = q.eq('clinic_id', clinicId);
        return q;
      };
      const [t, c, m] = await Promise.all([
        base('v_monthly_technician_perf'),
        base('v_monthly_consultant_perf'),
        base('v_monthly_tm_perf'),
      ]);
      // 전체 지점: 같은 사람 여러 행 합산
      const mergeBy = <T extends Record<string, any>>(rows: T[], key: keyof T, sumKeys: (keyof T)[]): T[] => {
        const map = new Map<string, T>();
        rows.forEach((r) => {
          const k = String(r[key]);
          if (!map.has(k)) { map.set(k, { ...r }); return; }
          const cur = map.get(k)!;
          sumKeys.forEach((sk) => { (cur as any)[sk] = Number(cur[sk] || 0) + Number(r[sk] || 0); });
        });
        return Array.from(map.values());
      };

      const techRows = ((t.data || []) as TechRow[]);
      const consRows = ((c.data || []) as ConsRow[]);
      const tmRows   = ((m.data || []) as TmRow[]);

      const techMerged = allClinics
        ? (() => {
            // avg_stay_min은 procedure_count 기준 가중평균으로 재계산
            const weightMap = new Map<string, { totalWeightedMin: number; totalCount: number }>();
            techRows.forEach(r => {
              const k = String(r.technician_id);
              const cur = weightMap.get(k) || { totalWeightedMin: 0, totalCount: 0 };
              cur.totalWeightedMin += (r.avg_stay_min || 0) * (r.procedure_count || 0);
              cur.totalCount += (r.procedure_count || 0);
              weightMap.set(k, cur);
            });
            return mergeBy(techRows, 'technician_id', ['procedure_count', 'net_revenue']).map(r => {
              const w = weightMap.get(String(r.technician_id));
              return { ...r, avg_stay_min: w && w.totalCount ? Math.round(w.totalWeightedMin / w.totalCount) : r.avg_stay_min };
            });
          })()
        : techRows;
      const consMerged = allClinics
        ? mergeBy(consRows, 'consultant_id', ['consult_count', 'net_revenue']).map(r => ({ ...r, avg_spend: r.consult_count ? Math.round(r.net_revenue / r.consult_count) : 0 }))
        : consRows;
      const tmMerged = allClinics
        ? mergeBy(tmRows, 'tm_name', ['total_reservations', 'checkin_count', 'net_revenue']).map(r => ({
            ...r,
            visit_rate: r.total_reservations ? Math.round((r.checkin_count / r.total_reservations) * 1000) / 10 : 0,
            avg_spend: r.checkin_count ? Math.round(r.net_revenue / r.checkin_count) : 0,
          }))
        : tmRows;

      setTech(techMerged.sort((a, b) => b.net_revenue - a.net_revenue));
      setCons(consMerged.sort((a, b) => b.net_revenue - a.net_revenue));
      setTm(tmMerged.sort((a, b) => b.net_revenue - a.net_revenue));
      setLoading(false);
    })();
  }, [clinicId, month, allClinics]);

  const totalsTech = useMemo(() => ({
    count: tech.reduce((s, r) => s + (r.procedure_count || 0), 0),
    rev: tech.reduce((s, r) => s + (r.net_revenue || 0), 0),
  }), [tech]);
  const totalsCons = useMemo(() => ({
    count: cons.reduce((s, r) => s + (r.consult_count || 0), 0),
    rev: cons.reduce((s, r) => s + (r.net_revenue || 0), 0),
  }), [cons]);
  const totalsTm = useMemo(() => ({
    res: tm.reduce((s, r) => s + (r.total_reservations || 0), 0),
    ck: tm.reduce((s, r) => s + (r.checkin_count || 0), 0),
    rev: tm.reduce((s, r) => s + (r.net_revenue || 0), 0),
  }), [tm]);

  const barTech = tech.map(r => ({ name: r.technician_name, value: WON_TO_MAN(r.net_revenue) }));
  const barCons = cons.map(r => ({ name: r.consultant_name, value: WON_TO_MAN(r.net_revenue) }));
  const barTm   = tm.map(r => ({ name: r.tm_name, value: WON_TO_MAN(r.net_revenue) }));

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 bg-card p-3 rounded-lg border">
        <span className="text-sm font-medium">월</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(month, 'yyyy년 M월', { locale: ko })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={month} onSelect={(d) => d && setMonth(startOfMonth(d))} className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
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

      <PerfSection
        title="시술자 성과"
        bar={barTech}
        rows={tech}
        columns={['시술자명', '시술 건수', '매출 합계', '평균 체류시간']}
        renderRow={(r: TechRow) => [
          r.technician_name,
          `${r.procedure_count.toLocaleString()}건`,
          `${r.net_revenue.toLocaleString()}원`,
          `${Math.round(r.avg_stay_min || 0)}분`,
        ]}
        totalsRow={['합계', `${totalsTech.count.toLocaleString()}건`, `${totalsTech.rev.toLocaleString()}원`, '-']}
      />

      <PerfSection
        title="상담실장 성과"
        bar={barCons}
        rows={cons}
        columns={['상담실장명', '상담 건수', '매출 합계', '평균 객단가']}
        renderRow={(r: ConsRow) => [
          r.consultant_name,
          `${r.consult_count.toLocaleString()}건`,
          `${r.net_revenue.toLocaleString()}원`,
          `${(r.avg_spend || 0).toLocaleString()}원`,
        ]}
        totalsRow={['합계', `${totalsCons.count.toLocaleString()}건`, `${totalsCons.rev.toLocaleString()}원`, '-']}
      />

      <PerfSection
        title="TM팀 성과"
        bar={barTm}
        rows={tm}
        columns={['TM명', '예약 건수', '내원 건수', '내원율', '매출 합계', '평균 객단가']}
        renderRow={(r: TmRow) => [
          r.tm_name,
          `${r.total_reservations.toLocaleString()}건`,
          `${r.checkin_count.toLocaleString()}건`,
          `${(r.visit_rate || 0).toFixed(1)}%`,
          `${r.net_revenue.toLocaleString()}원`,
          `${(r.avg_spend || 0).toLocaleString()}원`,
        ]}
        totalsRow={[
          '합계',
          `${totalsTm.res.toLocaleString()}건`,
          `${totalsTm.ck.toLocaleString()}건`,
          `${totalsTm.res ? ((totalsTm.ck / totalsTm.res) * 100).toFixed(1) : '0.0'}%`,
          `${totalsTm.rev.toLocaleString()}원`,
          '-',
        ]}
      />
      <p className="text-[11px] text-muted-foreground px-1">
        * 바 차트 단위: 만원. 테이블 금액 단위: 원. 전체 지점 선택 시 같은 담당자의 여러 지점 실적을 합산.
      </p>
    </div>
  );
}

function PerfSection<T>({ title, bar, rows, columns, renderRow, totalsRow }: {
  title: string;
  bar: { name: string; value: number }[];
  rows: T[];
  columns: string[];
  renderRow: (r: T) => (string | number)[];
  totalsRow: (string | number)[];
}) {
  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-3">
        {bar.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">데이터 없음</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, bar.length * 28)}>
            <BarChart data={bar} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 0 }}>
              <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(v: any) => [`${v} 만원`, '매출']} contentStyle={{ fontSize: '11px' }} />
              <Bar dataKey="value">
                {bar.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-xs text-muted-foreground">
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={i === 0 ? 'text-left px-4 py-2' : 'text-right px-4 py-2'}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">데이터 없음</td></tr>
            ) : rows.map((r, idx) => {
              const cells = renderRow(r);
              return (
                <tr key={idx} className="border-t hover:bg-muted/10">
                  {cells.map((v, i) => (
                    <td key={i} className={i === 0 ? 'px-4 py-2 font-medium' : 'px-4 py-2 text-right'}>{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted/20 font-semibold text-sm border-t-2">
              <tr>
                {totalsRow.map((v, i) => (
                  <td key={i} className={i === 0 ? 'px-4 py-2' : 'px-4 py-2 text-right'}>{v}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
