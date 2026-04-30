import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import type { ConsultantRow } from '@/lib/stats';

interface Props {
  rows: ConsultantRow[];
  loading: boolean;
}

type SortKey = 'name' | 'ticketing' | 'conversion' | 'avg';

export default function ConsultantSection({ rows, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('ticketing');
  const [sortAsc, setSortAsc] = useState(false);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        conversion: r.ticketing_count > 0 ? (r.package_count / r.ticketing_count) * 100 : 0,
      })),
    [rows],
  );

  const sorted = useMemo(() => {
    const copy = [...enriched];
    copy.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'name':       diff = a.name.localeCompare(b.name); break;
        case 'ticketing':  diff = a.ticketing_count - b.ticketing_count; break;
        case 'conversion': diff = a.conversion - b.conversion; break;
        case 'avg':        diff = a.avg_amount - b.avg_amount; break;
      }
      return sortAsc ? diff : -diff;
    });
    return copy;
  }, [enriched, sortKey, sortAsc]);

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  const arrow = (k: SortKey) => (sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : '');

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">3. 상담실장 티켓팅 실적</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">실장별 실적</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">
                      <button onClick={() => setSort('name')} className="hover:text-foreground">
                        실장명{arrow('name')}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right">
                      <button onClick={() => setSort('ticketing')} className="hover:text-foreground">
                        티켓팅 건수{arrow('ticketing')}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right">
                      <button onClick={() => setSort('conversion')} className="hover:text-foreground">
                        패키지 전환율{arrow('conversion')}
                      </button>
                    </th>
                    <th className="pb-2 font-medium text-right">
                      <button onClick={() => setSort('avg')} className="hover:text-foreground">
                        객단가{arrow('avg')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.consultant_id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2 text-right tabular-nums">{r.ticketing_count}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.ticketing_count > 0 ? `${r.conversion.toFixed(1)}%` : '-'}
                        <span className="text-xs text-muted-foreground ml-1">({r.package_count})</span>
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatAmount(r.avg_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
