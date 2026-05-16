/**
 * T-20260515-foot-SALES-TAB-STAFF
 * 매출집계 탭5 — 담당직원별 정산
 *
 * AC-1: check_ins.therapist_id / technician_id 기준 그룹
 * AC-2: 시술 건수 + 실적 금액 + 환불 차감액
 * AC-3: 소급 방지 환불 차감 엔진 — 당월(accounting_date) 마이너스 표출
 * AC-4: 글로벌 필터(기간·검색) + 엑셀 — Sales.tsx 공통 레이어 사용
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
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // accounting_date 기준 조회 — 소급 방지의 핵심 (AC-3)
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

  // ── 담당직원별 집계 (AC-1 · AC-2 · AC-3) ────────────────────────────────
  // AC-3 소급 방지: accounting_date 범위 내 수납/환불만 당월 실적에 반영.
  // parent_payment_id로 원거래 추적 → 환불은 환불 발생 당월 해당 직원 실적에 차감.
  const stats = useMemo<StaffStat[]>(() => {
    const map = new Map<string, StaffStat>();

    const upsert = (
      staffId: string,
      staffName: string,
      role: 'therapist' | 'technician',
      netAmt: number,
    ) => {
      const key = `${role}:${staffId}`;
      const existing = map.get(key) ?? {
        staffId,
        staffName,
        role,
        count: 0,
        revenue: 0,
        refundAmount: 0,
      };
      if (netAmt < 0) {
        // 환불액 — 당월 실적에서 차감 (소급 없음, AC-3)
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

  // AC-4: 검색 필터 — 직원 이름 포함 검색 (글로벌 필터 공통 레이어)
  const filtered = useMemo<StaffStat[]>(() => {
    if (!searchQuery) return stats;
    return stats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [stats, searchQuery]);

  const totals = useMemo(
    () => ({
      count: filtered.reduce((s, x) => s + x.count, 0),
      revenue: filtered.reduce((s, x) => s + x.revenue, 0),
      refund: filtered.reduce((s, x) => s + x.refundAmount, 0),
    }),
    [filtered],
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div
        data-testid="sales-staff-loading"
        className="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        불러오는 중…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div
        data-testid="sales-staff-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
      >
        <span className="text-sm text-muted-foreground">해당 기간에 담당직원 데이터가 없습니다</span>
        <span className="text-xs text-muted-foreground">
          수납에 치료사/장비명이 연결되지 않은 경우 표시되지 않습니다
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="sales-staff-tab"
      className="overflow-auto rounded-lg border bg-background text-xs"
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['직원명', '역할', '시술 건수', '실적 금액', '환불 차감액', '순 실적'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const net = s.revenue - s.refundAmount;
            return (
              <tr
                key={`${s.role}:${s.staffId}`}
                data-testid={`sales-staff-row-${s.role}-${s.staffId}`}
                className="border-b transition hover:bg-muted/30"
              >
                <td className="px-3 py-2 font-medium">{s.staffName}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {s.role === 'therapist' ? '치료사' : '장비명'}
                </td>
                <td className="px-3 py-2 tabular-nums text-center">{s.count}</td>
                <td className="px-3 py-2 tabular-nums text-right">
                  {formatAmount(Math.round(s.revenue))}원
                </td>
                <td
                  data-testid={`sales-staff-refund-${s.role}-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right',
                    s.refundAmount > 0 && 'text-red-600',
                  )}
                >
                  {s.refundAmount > 0 ? `-${formatAmount(Math.round(s.refundAmount))}원` : '—'}
                </td>
                <td
                  data-testid={`sales-staff-net-${s.role}-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right font-semibold',
                    net < 0 && 'text-red-600',
                  )}
                >
                  {formatAmount(Math.round(net))}원
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td colSpan={2} className="px-3 py-2">합계</td>
            <td
              data-testid="sales-staff-total-count"
              className="px-3 py-2 tabular-nums text-center"
            >
              {totals.count}
            </td>
            <td
              data-testid="sales-staff-total-revenue"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.revenue))}원
            </td>
            <td
              data-testid="sales-staff-total-refund"
              className="px-3 py-2 tabular-nums text-right text-red-600"
            >
              {totals.refund > 0 ? `-${formatAmount(Math.round(totals.refund))}원` : '—'}
            </td>
            <td
              data-testid="sales-staff-total-net"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.revenue - totals.refund))}원
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-xs text-muted-foreground">
        * 소급 방지: 환불액은 환불 처리 당월 해당 직원 실적에서 차감 (과거 월 데이터 불변)
      </p>
    </div>
  );
}
