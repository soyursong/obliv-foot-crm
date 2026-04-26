import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { supabase } from '@/lib/supabase';

interface Props {
  clinicId: string;
}

type TechRow = {
  technician_id: string;
  technician_name: string;
  technician_role: string;
  procedure_count: number;
  net_revenue: number;
  avg_stay_min: number;
};

type ConsRow = {
  consultant_id: string;
  consultant_name: string;
  consult_count: number;
  net_revenue: number;
  avg_spend: number;
};

const WON_TO_MAN = (v: number) => Math.round(v / 10000);
const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

import { roleLabel } from '@/lib/status';

export default function MonthlyPerfTab({ clinicId }: Props) {
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [tech, setTech] = useState<TechRow[]>([]);
  const [cons, setCons] = useState<ConsRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    const load = async () => {
      setLoading(true);
      const monthStr = format(month, 'yyyy-MM-01');
      const [t, c] = await Promise.all([
        supabase
          .from('v_monthly_therapist_perf')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month', monthStr),
        supabase
          .from('v_monthly_consultant_perf')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month', monthStr),
      ]);
      setTech(((t.data ?? []) as TechRow[]).sort((a, b) => b.net_revenue - a.net_revenue));
      setCons(((c.data ?? []) as ConsRow[]).sort((a, b) => b.net_revenue - a.net_revenue));
      setLoading(false);
    };
    load();
  }, [clinicId, month]);

  const totalsTech = useMemo(
    () => ({
      count: tech.reduce((s, r) => s + (r.procedure_count || 0), 0),
      rev: tech.reduce((s, r) => s + (r.net_revenue || 0), 0),
    }),
    [tech],
  );
  const totalsCons = useMemo(
    () => ({
      count: cons.reduce((s, r) => s + (r.consult_count || 0), 0),
      rev: cons.reduce((s, r) => s + (r.net_revenue || 0), 0),
    }),
    [cons],
  );

  const barTech = tech.map((r) => ({ name: r.technician_name || '미지정', value: WON_TO_MAN(r.net_revenue) }));
  const barCons = cons.map((r) => ({ name: r.consultant_name || '미지정', value: WON_TO_MAN(r.net_revenue) }));

  // 월 입력: <input type="month"> 형식 yyyy-MM
  const monthInputValue = format(month, 'yyyy-MM');

  return (
    <div className="space-y-4">
      {/* 월 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-sm font-medium">월</span>
        <input
          type="month"
          value={monthInputValue}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m] = e.target.value.split('-').map(Number);
            setMonth(startOfMonth(new Date(y, (m ?? 1) - 1, 1)));
          }}
          className="h-8 rounded border bg-background px-2 text-sm"
        />
        {loading && <span className="ml-auto text-xs text-muted-foreground">로딩…</span>}
      </div>

      <PerfSection
        title="관리사·치료사 성과"
        bar={barTech}
        rows={tech}
        columns={['이름', '직책', '시술 건수', '매출 합계', '평균 체류시간']}
        renderRow={(r: TechRow) => [
          r.technician_name || '미지정',
          roleLabel(r.technician_role),
          `${r.procedure_count.toLocaleString()}건`,
          r.net_revenue.toLocaleString(),
          `${Math.round(r.avg_stay_min || 0)}분`,
        ]}
        totalsRow={['합계', '', `${totalsTech.count.toLocaleString()}건`, totalsTech.rev.toLocaleString(), '-']}
      />

      <PerfSection
        title="상담실장 성과"
        bar={barCons}
        rows={cons}
        columns={['이름', '상담 건수', '매출 합계', '평균 객단가']}
        renderRow={(r: ConsRow) => [
          r.consultant_name || '미지정',
          `${r.consult_count.toLocaleString()}건`,
          r.net_revenue.toLocaleString(),
          (r.avg_spend || 0).toLocaleString(),
        ]}
        totalsRow={['합계', `${totalsCons.count.toLocaleString()}건`, totalsCons.rev.toLocaleString(), '-']}
      />
      <p className="px-1 text-[11px] text-muted-foreground">
        * 바 차트 단위는 만원, 테이블 매출 단위는 원. 시술 건수는 status=done 기준 집계.
      </p>
    </div>
  );
}

function PerfSection<T>({
  title,
  bar,
  rows,
  columns,
  renderRow,
  totalsRow,
}: {
  title: string;
  bar: { name: string; value: number }[];
  rows: T[];
  columns: string[];
  renderRow: (r: T) => (string | number)[];
  totalsRow: (string | number)[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/30 px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-3">
        {bar.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            데이터 없음
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, bar.length * 28)}>
            <BarChart data={bar} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 0 }}>
              <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(v) => [`${v} 만원`, '매출']} contentStyle={{ fontSize: '11px' }} />
              <Bar dataKey="value">
                {bar.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
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
                <th key={c} className={i === 0 ? 'px-4 py-2 text-left' : 'px-4 py-2 text-right'}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const cells = renderRow(r);
                return (
                  <tr key={idx} className="border-t hover:bg-muted/10">
                    {cells.map((v, i) => (
                      <td
                        key={i}
                        className={i === 0 ? 'px-4 py-2 font-medium' : 'px-4 py-2 text-right tabular-nums'}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 bg-muted/20 text-sm font-semibold">
              <tr>
                {totalsRow.map((v, i) => (
                  <td
                    key={i}
                    className={i === 0 ? 'px-4 py-2' : 'px-4 py-2 text-right tabular-nums'}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
