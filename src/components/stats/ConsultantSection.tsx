import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import type { ConsultantRow } from '@/lib/stats';
import { consultantRevenue } from '@/lib/consultantSalesExport';

interface Props {
  rows: ConsultantRow[];
  loading: boolean;
}

type SortKey = 'name' | 'ticketing' | 'conversion' | 'total' | 'avg';

export default function ConsultantSection({ rows, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('ticketing');
  const [sortAsc, setSortAsc] = useState(false);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        conversion: r.ticketing_count > 0 ? (r.package_count / r.ticketing_count) * 100 : 0,
        // T-20260622: 실장별 총 매출액 (RPC total_amount, 미반환 시 객단가×건수 역산)
        revenue: consultantRevenue(r),
      })),
    [rows],
  );

  const sorted = useMemo(() => {
    const copy = [...enriched];
    copy.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'name':       diff = (a.name ?? '').localeCompare(b.name ?? ''); break;
        case 'ticketing':  diff = a.ticketing_count - b.ticketing_count; break;
        case 'conversion': diff = a.conversion - b.conversion; break;
        case 'total':      diff = a.revenue - b.revenue; break;
        // AC6: avg_amount NULL(상담고객 0) 은 항상 최하위. 그 외는 값 비교.
        case 'avg':        diff = (a.avg_amount ?? -1) - (b.avg_amount ?? -1); break;
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
                      <button onClick={() => setSort('total')} className="hover:text-foreground">
                        총 매출액{arrow('total')}
                      </button>
                    </th>
                    {/* AC6: 상담(내원)고객 수 = 객단가 분모(distinct 고객, 결제무관·노쇼/예약only 제외) */}
                    <th className="pb-2 font-medium text-right">상담고객</th>
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
                      <td className="py-2 font-medium">{r.name || '미지정'}</td>
                      <td className="py-2 text-right tabular-nums">{r.ticketing_count}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.ticketing_count > 0 ? `${r.conversion.toFixed(1)}%` : '-'}
                        <span className="text-xs text-muted-foreground ml-1">({r.package_count})</span>
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold text-teal-700">
                        {formatAmount(r.revenue)}
                      </td>
                      {/* AC6: 상담고객 수(객단가 분모). 0명이면 '-' */}
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {r.consulted_customer_count && r.consulted_customer_count > 0
                          ? `${r.consulted_customer_count}명`
                          : '-'}
                      </td>
                      {/* AC6: 상담고객당 객단가. 분모=0 → RPC NULL → '-' 표시 */}
                      <td className="py-2 text-right tabular-nums font-medium">
                        {r.avg_amount == null ? '-' : formatAmount(r.avg_amount)}
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
