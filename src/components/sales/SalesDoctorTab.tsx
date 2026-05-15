/**
 * T-20260515-foot-SALES-TAB-DOCTOR
 * 매출집계 탭4 — 담당의별 통계
 *
 * AC-1: check_ins.consultant_id 기준 그룹
 * AC-2: 비급여 순매출 + 급여 본부금 + 공단청구액 + 오더 건수
 * AC-3: 복합 결제 안분 (TREATMENT과 동일 로직)
 *
 * READ-ONLY. DB 변경 없음.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

interface DoctorPayRow {
  id: string;
  amount: number;
  payment_type: string | null;
  tax_type: string | null;
  accounting_date: string | null;
  check_ins: {
    consultant: { id: string; name: string } | null;
    check_in_services: {
      base_amount: number;
    }[] | null;
  } | null;
}

interface DoctorStat {
  doctorId: string;
  doctorName: string;
  orderCount: number;
  nonInsuranceRevenue: number;   // 과세 + 면세 비급여 (세금속성 기준)
  insuranceCopay: number;        // 급여 본부금
  ediClaim: number;              // 공단청구액 (현재 payments에 없으므로 0)
}

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;

  const { data: payments = [], isLoading } = useQuery<DoctorPayRow[]>({
    queryKey: ['sales-doctor', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, payment_type, tax_type, accounting_date,
          check_ins(
            consultant:staff!check_ins_consultant_id_fkey(id, name),
            check_in_services(base_amount)
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      return data as unknown as DoctorPayRow[];
    },
  });

  const stats = useMemo<DoctorStat[]>(() => {
    const map = new Map<string, DoctorStat>();

    for (const p of payments) {
      const consultant = p.check_ins?.consultant;
      if (!consultant) continue;

      const key = consultant.id;
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const isInsurance = p.tax_type === '급여';

      const stat = map.get(key) ?? {
        doctorId: consultant.id,
        doctorName: consultant.name,
        orderCount: 0,
        nonInsuranceRevenue: 0,
        insuranceCopay: 0,
        ediClaim: 0,
      };

      stat.orderCount += 1;
      if (isInsurance) {
        stat.insuranceCopay += netAmt;
      } else {
        stat.nonInsuranceRevenue += netAmt;
      }

      map.set(key, stat);
    }

    return Array.from(map.values()).sort((a, b) => b.nonInsuranceRevenue - a.nonInsuranceRevenue);
  }, [payments]);

  const totals = useMemo(() => ({
    orders: stats.reduce((s, x) => s + x.orderCount, 0),
    nonIns: stats.reduce((s, x) => s + x.nonInsuranceRevenue, 0),
    copay: stats.reduce((s, x) => s + x.insuranceCopay, 0),
    edi: 0,
  }), [stats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center">
        <span className="text-sm text-muted-foreground">해당 기간에 담당의 데이터가 없습니다</span>
        <span className="text-xs text-muted-foreground">수납에 담당의(consultant)가 연결되지 않은 경우 표시되지 않습니다</span>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border bg-background text-xs">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['담당의', '오더 건수', '비급여 순매출', '급여 본부금', '공단청구액 (EDI)'].map((h) => (
              <th key={h} className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.doctorId} className="border-b transition hover:bg-muted/30">
              <td className="px-3 py-2 font-medium">{s.doctorName}</td>
              <td className="px-3 py-2 tabular-nums text-center">{s.orderCount}</td>
              <td className={cn('px-3 py-2 tabular-nums text-right font-semibold', s.nonInsuranceRevenue < 0 && 'text-red-600')}>
                {formatAmount(Math.round(s.nonInsuranceRevenue))}원
              </td>
              <td className="px-3 py-2 tabular-nums text-right">
                {formatAmount(Math.round(s.insuranceCopay))}원
              </td>
              <td className="px-3 py-2 tabular-nums text-right text-muted-foreground">
                — <span className="text-[10px]">(EDI 미연동)</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-3 py-2">합계</td>
            <td className="px-3 py-2 tabular-nums text-center">{totals.orders}</td>
            <td className="px-3 py-2 tabular-nums text-right">{formatAmount(Math.round(totals.nonIns))}원</td>
            <td className="px-3 py-2 tabular-nums text-right">{formatAmount(Math.round(totals.copay))}원</td>
            <td className="px-3 py-2 text-right text-muted-foreground">—</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-muted-foreground">
        * 공단청구액(EDI)은 보험청구 시스템 연동 후 표시됩니다
      </p>
    </div>
  );
}
