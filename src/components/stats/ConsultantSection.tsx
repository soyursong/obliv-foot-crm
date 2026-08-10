import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import {
  reconcileConsultantRevenue,
  type ConsultantDualAxisRow,
} from '@/lib/consultantSalesExport';

interface Props {
  // T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1-B): dual-axis view-model 소비.
  //   [티켓팅]·[전환율] = 방문축(무접촉) / [총매출액]·[결제고객]·[객단가] = staff축(assigned_staff_id net).
  rows: ConsultantDualAxisRow[];
  loading: boolean;
  // T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE:
  //   일마감 대사용 총 매출(순). 미귀속분(= 총매출 − staff축 귀속합) 파생 표시에만 사용(read-only).
  totalNetRevenue?: number;
}

type SortKey = 'name' | 'ticketing' | 'conversion' | 'total' | 'avg';

export default function ConsultantSection({ rows, loading, totalNetRevenue }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('ticketing');
  const [sortAsc, setSortAsc] = useState(false);

  // T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE (FIX-1-D):
  //   일마감 대사(실적합 + 미귀속 = 총매출) 파생. 실적합 = Σ staff축 net(dual-axis revenue) → 미귀속 ≥ 0.
  const recon = useMemo(
    () => (typeof totalNetRevenue === 'number' ? reconcileConsultantRevenue(rows, totalNetRevenue) : null),
    [rows, totalNetRevenue],
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'name':       diff = (a.name ?? '').localeCompare(b.name ?? ''); break;
        case 'ticketing':  diff = a.ticketingCount - b.ticketingCount; break;
        case 'conversion': diff = a.conversionRate - b.conversionRate; break;
        case 'total':      diff = a.revenue - b.revenue; break;
        // 객단가 NULL(결제고객 0) 은 항상 최하위. 그 외는 값 비교.
        case 'avg':        diff = (a.avgAmount ?? -1) - (b.avgAmount ?? -1); break;
      }
      return sortAsc ? diff : -diff;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

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
      <h2 className="text-sm font-semibold text-muted-foreground">4. 상담실장 티켓팅 실적</h2>

      {/* T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1-B): dual-axis 명시.
          두 기준이 섞인 표임을 현장 친화 문구로 밝혀 '왜 티켓팅과 매출의 사람 수가 다른가'를 설명. */}
      <div
        data-testid="consultant-dualaxis-note"
        className="rounded-md border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800"
      >
        이 표는 <b>두 가지 기준</b>이 함께 있어요. <b>[티켓팅 건수]·[패키지 전환율]</b>은 <b>상담(방문)한 사람</b> 기준이고,
        {' '}<b>[총 매출액]·[결제고객]·[객단가]</b>는 <b>고객 카드의 담당 실장(2번차트 담당자)</b> 기준이에요
        {' '}— ‘실장별 일별 매출’·‘매출집계 담당실장별’과 같은 기준입니다. 아래
        {' '}<b>‘상담실장 귀속 매출 + 미귀속 매출 = 총 매출(순)’</b>로 직접 맞춰볼 수 있어요.
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
                    {/* FIX-1-C: [상담고객] → [결제고객] (객단가 실제 분모 = staff축 결제고객 distinct) */}
                    <th className="pb-2 font-medium text-right">결제고객</th>
                    <th className="pb-2 font-medium text-right">
                      <button onClick={() => setSort('avg')} className="hover:text-foreground">
                        객단가{arrow('avg')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.staffId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.name || '미지정'}</td>
                      {/* 방문축(무접촉) */}
                      <td className="py-2 text-right tabular-nums">{r.ticketingCount}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.ticketingCount > 0 ? `${r.conversionRate.toFixed(1)}%` : '-'}
                        <span className="text-xs text-muted-foreground ml-1">({r.packageCount})</span>
                      </td>
                      {/* staff축: 총매출액 = assigned_staff_id net */}
                      <td className="py-2 text-right tabular-nums font-semibold text-teal-700">
                        {formatAmount(r.revenue)}
                      </td>
                      {/* FIX-1-C: 결제고객 수(객단가 분모, staff축). 0명이면 '-' */}
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {r.payingCustomers > 0 ? `${r.payingCustomers}명` : '-'}
                      </td>
                      {/* staff축: 객단가 = net / 결제고객. 분모=0 → '-' */}
                      <td className="py-2 text-right tabular-nums font-medium">
                        {r.avgAmount == null ? '-' : formatAmount(r.avgAmount)}
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
                  <span className="ml-1 text-xs text-muted-foreground/80">(미지정·워크인·비상담직·퇴사 실장)</span>
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
