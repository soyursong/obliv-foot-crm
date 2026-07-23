import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import type { ConsultantRow } from '@/lib/stats';
import { consultantRevenue, reconcileConsultantRevenue } from '@/lib/consultantSalesExport';

interface Props {
  rows: ConsultantRow[];
  loading: boolean;
  // T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE:
  //   일마감 대사용 총 매출(순). 미귀속분(= 총매출 − 상담사 귀속합) 파생 표시에만 사용(read-only).
  totalNetRevenue?: number;
}

type SortKey = 'name' | 'ticketing' | 'conversion' | 'total' | 'avg';

export default function ConsultantSection({ rows, loading, totalNetRevenue }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('ticketing');
  const [sortAsc, setSortAsc] = useState(false);

  // T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE:
  //   일마감 대사(실적합 + 미귀속 = 총매출) 파생. totalNetRevenue 미전달 시 대사 블록 숨김.
  const recon = useMemo(
    () => (typeof totalNetRevenue === 'number' ? reconcileConsultantRevenue(rows, totalNetRevenue) : null),
    [rows, totalNetRevenue],
  );

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

      {/* T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE:
          by-design 안내 문구 — '상담실장에게 귀속된 매출만' 합산한 값이라 일마감 총액과 다를 수 있음.
          숫자 오류가 아니라 집계 범위가 다른 것임을 현장 친화 문구로 명시. */}
      <div
        data-testid="consultant-bydesign-note"
        className="rounded-md border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800"
      >
        아래 금액은 <b>상담실장에게 귀속된 매출만</b> 합산한 값이에요. 상담 이력이 없는 결제나
        비상담 직원이 받은 결제는 여기 포함되지 않아서, <b>일마감 총액(전체 결제)과 다를 수 있습니다</b>
        {' '}— 숫자 오류가 아니라 집계 범위가 다른 것이에요. 아래 <b>‘상담실장 귀속 매출 + 미귀속 매출 = 총 매출(순)’</b>
        {' '}로 직접 맞춰볼 수 있습니다.
      </div>

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

          {/* T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE: 일마감 대사 블록.
              실적합 + 미귀속 = 총매출(순) 항등이 화면에서 눈으로 성립하도록 표시(파생·read-only). */}
          {!loading && recon && (
            <div
              data-testid="consultant-reconcile"
              className="mt-4 border-t pt-3 flex flex-col gap-1 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">상담실장 귀속 매출 합계</span>
                <span data-testid="reconcile-attributed" className="tabular-nums font-medium">
                  {formatAmount(recon.attributed)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  미귀속 매출
                  <span className="ml-1 text-xs text-muted-foreground/80">(상담 이력 없음·비상담 직원)</span>
                </span>
                <span data-testid="reconcile-unattributed" className="tabular-nums font-medium">
                  {formatAmount(recon.unattributed)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-2">
                <span className="font-semibold">총 매출(순) · 일마감 전체 결제</span>
                <span data-testid="reconcile-total" className="tabular-nums font-bold text-teal-700">
                  {formatAmount(recon.total)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
