/**
 * T-20260515-foot-SALES-TAB-STAFF
 * 매출집계 탭5 — 담당직원별 정산
 *
 * AC-1: check_ins.therapist_id / technician_id 기준 그룹
 * AC-2: 시술 건수 + 실적 금액 + 환불 차감액
 * AC-3: 소급 방지 환불 차감 엔진 — 당월(accounting_date) 마이너스 표출
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

interface StaffPayRow {
  id: string;
  amount: number;
  payment_type: string | null;
  accounting_date: string | null;
  parent_payment_id: string | null;
  check_ins: {
    therapist: { id: string; name: string } | null;
    technician: { id: string; name: string } | null;
  } | null;
}

interface StaffStat {
  staffId: string;
  staffName: string;
  role: 'therapist' | 'technician';
  count: number;
  revenue: number;
  refundAmount: number;
}

export function SalesStaffTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;

  const { data: payments = [], isLoading } = useQuery<StaffPayRow[]>({
    queryKey: ['sales-staff', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, payment_type, accounting_date, parent_payment_id,
          check_ins(
            therapist:staff!check_ins_therapist_id_fkey(id, name),
            technician:staff!check_ins_technician_id_fkey(id, name)
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      return data as unknown as StaffPayRow[];
    },
  });

  const stats = useMemo<StaffStat[]>(() => {
    // AC-3 소급 방지: 현재 accounting_date 범위 내 수납/환불만 당월 실적에 반영.
    // parent_payment_id로 원거래 추적 → 해당 직원 귀속.
    const map = new Map<string, StaffStat>();

    const upsert = (staffId: string, staffName: string, role: 'therapist' | 'technician', netAmt: number) => {
      const key = `${role}:${staffId}`;
      const existing = map.get(key) ?? {
        staffId, staffName, role,
        count: 0, revenue: 0, refundAmount: 0,
      };
      if (netAmt < 0) {
        existing.refundAmount += Math.abs(netAmt);
      } else {
        existing.count += 1;
        existing.revenue += netAmt;
      }
      map.set(key, existing);
    };

    for (const p of payments) {
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const therapist = p.check_ins?.therapist;
      const technician = p.check_ins?.technician;

      if (therapist?.id) upsert(therapist.id, therapist.name, 'therapist', netAmt);
      if (technician?.id) upsert(technician.id, technician.name, 'technician', netAmt);
    }

    return Array.from(map.values()).sort((a, b) => {
      const ra = a.revenue - a.refundAmount;
      const rb = b.revenue - b.refundAmount;
      return rb - ra;
    });
  }, [payments]);

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
        <span className="text-sm text-muted-foreground">해당 기간에 담당직원 데이터가 없습니다</span>
        <span className="text-xs text-muted-foreground">수납에 치료사/기사가 연결되지 않은 경우 표시되지 않습니다</span>
      </div>
    );
  }

  const totals = {
    count: stats.reduce((s, x) => s + x.count, 0),
    revenue: stats.reduce((s, x) => s + x.revenue, 0),
    refund: stats.reduce((s, x) => s + x.refundAmount, 0),
  };

  return (
    <div className="overflow-auto rounded-lg border bg-background text-xs">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['직원명', '역할', '시술 건수', '실적 금액', '환불 차감액', '순 실적'].map((h) => (
              <th key={h} className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const net = s.revenue - s.refundAmount;
            return (
              <tr key={`${s.role}:${s.staffId}`} className="border-b transition hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{s.staffName}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {s.role === 'therapist' ? '치료사' : '장비명'}
                </td>
                <td className="px-3 py-2 tabular-nums text-center">{s.count}</td>
                <td className="px-3 py-2 tabular-nums text-right">{formatAmount(Math.round(s.revenue))}원</td>
                <td className={cn('px-3 py-2 tabular-nums text-right', s.refundAmount > 0 && 'text-red-600')}>
                  {s.refundAmount > 0 ? `-${formatAmount(Math.round(s.refundAmount))}원` : '—'}
                </td>
                <td className={cn('px-3 py-2 tabular-nums text-right font-semibold', net < 0 && 'text-red-600')}>
                  {formatAmount(Math.round(net))}원
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td colSpan={2} className="px-3 py-2">합계</td>
            <td className="px-3 py-2 tabular-nums text-center">{totals.count}</td>
            <td className="px-3 py-2 tabular-nums text-right">{formatAmount(Math.round(totals.revenue))}원</td>
            <td className="px-3 py-2 tabular-nums text-right text-red-600">
              {totals.refund > 0 ? `-${formatAmount(Math.round(totals.refund))}원` : '—'}
            </td>
            <td className="px-3 py-2 tabular-nums text-right">{formatAmount(Math.round(totals.revenue - totals.refund))}원</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-xs text-muted-foreground">
        * 소급 방지: 환불액은 환불 처리 당월 해당 직원 실적에서 차감 (과거 월 데이터 불변)
      </p>
    </div>
  );
}
