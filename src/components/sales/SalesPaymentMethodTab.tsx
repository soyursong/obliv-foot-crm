/**
 * T-20260811-foot-SALESAGG-PAYMETHOD-BREAKDOWN (김주연 총괄)
 * 매출집계 탭 — 결제수단별 매출 분해.
 *
 * ── 왜 이 탭인가 ──────────────────────────────────────────────────────────────
 *  담당실장별(SalesDoctorTab)·담당치료사별(SalesStaffTab)과 '병존하는 분해 축'.
 *  실장/치료사가 매출을 '누가'로 쪼갠다면, 이 탭은 같은 매출을 '결제수단(카드/현금/이체/
 *  선수금차감/미분류)'으로 쪼갠다. 축만 다르고 모집단·산식은 동일.
 *
 * ── 산식 SSOT (신규 창작 0, D2 tie-out) ───────────────────────────────────────
 *  담당실장별 탭과 '동일 소스' lib/staffRevenue.fetchAttributedPayments 를 그대로 소비.
 *    · 소스① 단건 payments net + 소스② 패키지 package_payments net (환불=음수).
 *    · 상태필터 status NOT IN('cancelled','deleted') · sim(테스트) 고객 제외 = SSOT 동일.
 *  그 rows 를 staffId 대신 method 로만 재버킷팅(aggregateByPaymentMethod) →
 *    Σ(결제수단별 순매출) === Σ(전 rows net) === 담당실장별 '총 매출'(구조적 정합).
 *  null/미지정 method → '미분류/기타' 버킷(누락 0). → 표 하단 '합계 순매출'은 담당실장별 총매출과 일치.
 *
 * READ-ONLY. DB 변경 없음(db_change=false, DDL/RPC/신규컬럼·테이블·enum 0).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAttributedPayments,
  aggregateByPaymentMethod,
  payMethodNet,
  PAY_METHOD_LABEL,
  PAY_METHOD_ORDER,
  type AttributedPayments,
  type PayMethodBucket,
  type PayMethodKey,
} from '@/lib/staffRevenue';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

interface MethodRow {
  methodKey: PayMethodKey;
  label: string;
  gross: number;
  refund: number;
  net: number;
  count: number;
}

export function SalesPaymentMethodTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;

  // 담당실장별 탭과 완전히 동일한 SSOT 페치(캐시 키도 공유 → 재조회 없이 정합).
  const { data, isLoading } = useQuery<AttributedPayments>({
    queryKey: ['sales-doctor-gross', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: () => fetchAttributedPayments(clinic!.id, from, to),
  });

  // 결제수단 버킷 → 표시 행. 표시 순서 고정(카드·현금·이체·선수금차감·미분류/기타).
  //   금액/건수 0인 버킷은 숨겨 표를 간결하게(합계는 전 버킷 net 합이라 불변).
  const rows = useMemo<MethodRow[]>(() => {
    if (!data) return [];
    const buckets = aggregateByPaymentMethod(data.rows);
    const out: MethodRow[] = [];
    const seen = new Set<PayMethodKey>();
    const pushBucket = (key: PayMethodKey, b: PayMethodBucket | undefined) => {
      if (seen.has(key)) return;
      seen.add(key);
      const gross = b?.gross ?? 0;
      const refund = b?.refund ?? 0;
      const count = b?.count ?? 0;
      // 완전 무활동 버킷(gross·refund·count 모두 0)은 표에서 생략.
      if (gross === 0 && refund === 0 && count === 0) return;
      out.push({
        methodKey: key,
        label: PAY_METHOD_LABEL[key],
        gross,
        refund,
        net: b ? payMethodNet(b) : 0,
        count,
      });
    };
    // 정본 순서 먼저
    for (const key of PAY_METHOD_ORDER) pushBucket(key, buckets.get(key));
    // 혹시 순서표에 없는 키가 생기면(방어) 뒤에 append
    for (const [key, b] of buckets) pushBucket(key, b);
    return out;
  }, [data]);

  const totals = useMemo(
    () => ({
      gross: rows.reduce((s, r) => s + r.gross, 0),
      refund: rows.reduce((s, r) => s + r.refund, 0),
      net: rows.reduce((s, r) => s + r.net, 0),
      count: rows.reduce((s, r) => s + r.count, 0),
    }),
    [rows],
  );

  if (isLoading) {
    return (
      <div
        data-testid="sales-paymethod-loading"
        className="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        불러오는 중…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="sales-paymethod-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
      >
        <span className="text-sm text-muted-foreground">해당 기간에 결제 내역이 없습니다</span>
        <span className="text-xs text-muted-foreground">
          결제(단건·패키지)가 잡힌 결제수단이 없으면 표시되지 않습니다
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="sales-paymethod-tab"
      className="overflow-auto rounded-lg border bg-background text-xs"
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['결제수단', '결제 건수', '매출(gross)', '환불', '순매출'].map((h) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap border-b px-3 py-2 font-medium text-muted-foreground',
                  h === '결제수단' ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.methodKey}
              data-testid={`sales-paymethod-row-${r.methodKey}`}
              className="border-b transition hover:bg-muted/30"
            >
              <td
                className={cn(
                  'px-3 py-2 font-medium',
                  r.methodKey === 'unknown' && 'text-muted-foreground',
                )}
              >
                {r.label}
              </td>
              <td className="px-3 py-2 tabular-nums text-right text-muted-foreground">
                {r.count}
              </td>
              <td
                data-testid={`sales-paymethod-gross-${r.methodKey}`}
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(r.gross))}원
              </td>
              <td
                data-testid={`sales-paymethod-refund-${r.methodKey}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right',
                  r.refund > 0 && 'text-red-600',
                )}
              >
                {r.refund > 0 ? '−' : ''}
                {formatAmount(Math.round(r.refund))}원
              </td>
              <td
                data-testid={`sales-paymethod-net-${r.methodKey}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right font-semibold text-teal-700',
                  r.net < 0 && 'text-red-600',
                )}
              >
                {formatAmount(Math.round(r.net))}원
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-3 py-2">합계</td>
            <td
              data-testid="sales-paymethod-total-count"
              className="px-3 py-2 tabular-nums text-right text-muted-foreground"
            >
              {totals.count}
            </td>
            <td
              data-testid="sales-paymethod-total-gross"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.gross))}원
            </td>
            <td
              data-testid="sales-paymethod-total-refund"
              className={cn(
                'px-3 py-2 tabular-nums text-right',
                totals.refund > 0 && 'text-red-600',
              )}
            >
              {totals.refund > 0 ? '−' : ''}
              {formatAmount(Math.round(totals.refund))}원
            </td>
            <td
              data-testid="sales-paymethod-total-net"
              className="px-3 py-2 tabular-nums text-right font-semibold text-teal-700"
            >
              {formatAmount(Math.round(totals.net))}원
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-[10px] leading-relaxed text-muted-foreground">
        * 순매출 = 매출(gross, 환불 차감 전) − 환불 (환불 1회 차감) · 담당실장별 '총 매출'과 동일 모집단·산식
        <br />
        * 결제수단은 매출을 '어떻게 결제했나'로 분해한 축 — <span className="font-medium text-teal-700">합계 순매출은 담당실장별 총 매출과 일치</span>
        <br />
        * 결제수단이 기록되지 않은 결제는 <span className="font-medium">미분류/기타</span>로 집계(누락 없음)
      </p>
    </div>
  );
}
