/**
 * T-20260515-foot-SALES-TAB-DOCTOR
 * 매출집계 탭4 — 담당의별 통계
 *
 * AC-1: check_ins.consultant_id 기준 그룹, 의사 실명 표시
 * AC-2: 비급여 순매출(과세+면세) + 급여 본부금 + 공단청구액(EDI) + 오더 건수
 *       복합결제 안분 — check_in_services.price 비율로 결제금액 안분 (TREATMENT 동일 로직)
 * AC-3: 글로벌 필터(기간·검색) + 엑셀 다운로드는 Sales.tsx 공통 레이어 사용
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

// ─── DB row types ────────────────────────────────────────────────────────────

interface DoctorPayRow {
  id: string;
  amount: number;
  payment_type: string | null;
  tax_type: string | null;
  accounting_date: string | null;
  check_ins: {
    consultant: { id: string; name: string } | null;
    /** check_in_services.price — 복합결제 안분 비율 산출용 */
    check_in_services: {
      price: number;
    }[] | null;
  } | null;
}

// ─── 집계 타입 ────────────────────────────────────────────────────────────────

interface DoctorStat {
  doctorId: string;
  doctorName: string;
  /** 오더 건수 (결제 건 수) */
  orderCount: number;
  /** 비급여 순매출: 과세_비급여 + 면세_비급여 (환불 마이너스 반영) */
  nonInsuranceRevenue: number;
  /** 급여 본부금: 보험 적용 본인부담금 */
  insuranceCopay: number;
  /**
   * 공단청구액 (EDI): 보험청구 시스템 연동 전이므로 항상 0.
   * 향후 claim_diagnoses / EDI API 연동 시 채울 자리.
   */
  ediClaim: number;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // payments → check_ins(consultant, check_in_services.price)
  // 집계 기준: accounting_date (소급 차단)
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
            check_in_services(price)
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

  // ── 담당의별 집계 (AC-2 복합결제 안분) ────────────────────────────────────
  // check_ins.consultant_id는 visit당 단일 의사이므로 안분 후 합산 = 동일.
  // TREATMENT 동일 로직 적용: price 합계 0이면 균등 분배.
  const stats = useMemo<DoctorStat[]>(() => {
    const map = new Map<string, DoctorStat>();

    for (const p of payments) {
      const consultant = p.check_ins?.consultant;
      if (!consultant) continue;

      const key = consultant.id;
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const isInsurance = p.tax_type === '급여';

      // 복합결제 안분: services의 price 비율로 안분
      // (단일 의사이므로 안분 합 = netAmt — 정합성 보장)
      const svcs = p.check_ins?.check_in_services ?? [];
      const totalBase = svcs.reduce((s, cs) => s + (cs.price ?? 0), 0);
      const allocatedAmt =
        svcs.length > 0
          ? svcs.reduce((s, cs) => {
              const ratio = totalBase > 0 ? (cs.price ?? 0) / totalBase : 1 / svcs.length;
              return s + netAmt * ratio;
            }, 0)
          : netAmt; // check_in_services 없을 때 전액 귀속

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
        stat.insuranceCopay += allocatedAmt;
      } else {
        stat.nonInsuranceRevenue += allocatedAmt;
      }

      map.set(key, stat);
    }

    return Array.from(map.values()).sort((a, b) => b.nonInsuranceRevenue - a.nonInsuranceRevenue);
  }, [payments]);

  // AC-3: 검색 필터 — 담당의 이름 포함 검색
  const filtered = useMemo<DoctorStat[]>(() => {
    if (!searchQuery) return stats;
    return stats.filter((s) => s.doctorName.toLowerCase().includes(searchQuery));
  }, [stats, searchQuery]);

  const totals = useMemo(
    () => ({
      orders: filtered.reduce((s, x) => s + x.orderCount, 0),
      nonIns: filtered.reduce((s, x) => s + x.nonInsuranceRevenue, 0),
      copay: filtered.reduce((s, x) => s + x.insuranceCopay, 0),
      edi: 0,
    }),
    [filtered],
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div
        data-testid="sales-doctor-loading"
        className="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        불러오는 중…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div
        data-testid="sales-doctor-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
      >
        <span className="text-sm text-muted-foreground">해당 기간에 담당의 데이터가 없습니다</span>
        <span className="text-xs text-muted-foreground">
          수납에 담당의(consultant)가 연결되지 않은 경우 표시되지 않습니다
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="sales-doctor-tab"
      className="overflow-auto rounded-lg border bg-background text-xs"
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['담당의', '오더 건수', '비급여 순매출', '급여 본부금', '공단청구액 (EDI)'].map((h) => (
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
          {filtered.map((s) => (
            <tr
              key={s.doctorId}
              data-testid={`sales-doctor-row-${s.doctorId}`}
              className="border-b transition hover:bg-muted/30"
            >
              <td className="px-3 py-2 font-medium">{s.doctorName}</td>
              <td className="px-3 py-2 tabular-nums text-center">{s.orderCount}</td>
              <td
                data-testid={`sales-doctor-nonins-${s.doctorId}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right font-semibold',
                  s.nonInsuranceRevenue < 0 && 'text-red-600',
                )}
              >
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
            <td
              data-testid="sales-doctor-total-orders"
              className="px-3 py-2 tabular-nums text-center"
            >
              {totals.orders}
            </td>
            <td
              data-testid="sales-doctor-total-nonins"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.nonIns))}원
            </td>
            <td className="px-3 py-2 tabular-nums text-right">
              {formatAmount(Math.round(totals.copay))}원
            </td>
            <td className="px-3 py-2 text-right text-muted-foreground">—</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-[10px] text-muted-foreground">
        * 공단청구액(EDI)은 보험청구 시스템 연동 후 표시됩니다
      </p>
    </div>
  );
}
