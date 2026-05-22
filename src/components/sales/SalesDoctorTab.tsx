/**
 * T-20260515-foot-SALES-TAB-DOCTOR / T-20260522-foot-SETTLE-STAFF-LABEL
 * 매출집계 탭4 — 담당실장별 통계
 *
 * AC-1 (SETTLE-STAFF-LABEL): "담당의별" → "담당실장별" 라벨 변경
 * AC-2 (SETTLE-STAFF-LABEL): 데이터소스 consultant_id(deprecated) → customers.assigned_staff_id
 *   - DAILY-SETTLE-STAFF(9a97d5a) 동일 소스: 2번차트 1구역 담당자 드롭
 *   - 3-step join: payments(customer_id) → customers(assigned_staff_id) → staff(name)
 *   - NULL assigned_staff → '미지정' 포함 (DAILY-SETTLE-STAFF AC-3 일관성)
 * AC-3: 글로벌 필터(기간·검색) + 집계 기준: accounting_date
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

interface PayRow {
  id: string;
  amount: number;
  payment_type: string | null;
  tax_type: string | null;
  accounting_date: string | null;
  customer_id: string | null;
}

interface CustomerRow {
  id: string;
  assigned_staff_id: string | null;
}

interface StaffNameRow {
  id: string;
  name: string;
}

// 쿼리 결과 묶음
interface StaffPayData {
  rows: PayRow[];
  /** customer_id → staff_id */
  custStaffMap: Map<string, string>;
  /** staff_id → name */
  staffNameMap: Map<string, string>;
}

// ─── 집계 타입 ────────────────────────────────────────────────────────────────

interface StaffStat {
  staffId: string;     // staff UUID or '__UNASSIGNED__'
  staffName: string;   // 실명 or '미지정'
  orderCount: number;
  nonInsuranceRevenue: number;
  insuranceCopay: number;
  /** 공단청구액 — EDI 미연동, 항상 0 */
  ediClaim: number;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // ── 3-step fetch (DAILY-SETTLE-STAFF 패턴 동일) ───────────────────────────
  // Step 1: payments(customer_id)
  // Step 2: customers(assigned_staff_id) for those customer_ids
  // Step 3: staff(name) for those staff_ids
  const { data, isLoading } = useQuery<StaffPayData>({
    queryKey: ['sales-staff-label', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      // 1. 결제 내역 (accounting_date 기준)
      const { data: pays, error: payErr } = await supabase
        .from('payments')
        .select('id, amount, payment_type, tax_type, accounting_date, customer_id')
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (payErr) throw payErr;

      const rows = (pays ?? []) as PayRow[];

      // 2. customer_ids 수집 → customers(assigned_staff_id)
      const custIds = [...new Set(
        rows.map((r) => r.customer_id).filter(Boolean) as string[]
      )];

      const custStaffMap = new Map<string, string>(); // customer_id → staff_id
      if (custIds.length > 0) {
        const { data: custs, error: custErr } = await supabase
          .from('customers')
          .select('id, assigned_staff_id')
          .in('id', custIds);
        if (custErr) throw custErr;
        for (const c of (custs ?? []) as CustomerRow[]) {
          if (c.assigned_staff_id) custStaffMap.set(c.id, c.assigned_staff_id);
        }
      }

      // 3. staff_ids 수집 → staff(name)
      const staffIds = [...new Set([...custStaffMap.values()])];
      const staffNameMap = new Map<string, string>(); // staff_id → name
      if (staffIds.length > 0) {
        const { data: staffList, error: staffErr } = await supabase
          .from('staff')
          .select('id, name')
          .in('id', staffIds);
        if (staffErr) throw staffErr;
        for (const s of (staffList ?? []) as StaffNameRow[]) {
          staffNameMap.set(s.id, s.name);
        }
      }

      return { rows, custStaffMap, staffNameMap };
    },
  });

  // ── 담당실장별 집계 ────────────────────────────────────────────────────────
  // NULL assigned_staff → key='__UNASSIGNED__', name='미지정' (DAILY-SETTLE-STAFF AC-3 일관)
  const stats = useMemo<StaffStat[]>(() => {
    const { rows = [], custStaffMap = new Map(), staffNameMap = new Map() } = data ?? {};
    const map = new Map<string, StaffStat>();

    for (const p of rows) {
      const staffId = (p.customer_id ? custStaffMap.get(p.customer_id) : undefined) ?? '__UNASSIGNED__';
      const staffName = staffId === '__UNASSIGNED__'
        ? '미지정'
        : (staffNameMap.get(staffId) ?? '알 수 없음');

      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const isInsurance = p.tax_type === '급여';

      const stat = map.get(staffId) ?? {
        staffId,
        staffName,
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

      map.set(staffId, stat);
    }

    return Array.from(map.values()).sort((a, b) => {
      // '미지정'은 항상 맨 아래
      if (a.staffId === '__UNASSIGNED__') return 1;
      if (b.staffId === '__UNASSIGNED__') return -1;
      return b.nonInsuranceRevenue - a.nonInsuranceRevenue;
    });
  }, [data]);

  // AC-3: 검색 필터 — 담당실장 이름 포함 검색
  const filtered = useMemo<StaffStat[]>(() => {
    if (!searchQuery) return stats;
    return stats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [stats, searchQuery]);

  const totals = useMemo(
    () => ({
      orders: filtered.reduce((s, x) => s + x.orderCount, 0),
      nonIns: filtered.reduce((s, x) => s + x.nonInsuranceRevenue, 0),
      copay: filtered.reduce((s, x) => s + x.insuranceCopay, 0),
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
        <span className="text-sm text-muted-foreground">해당 기간에 담당실장 데이터가 없습니다</span>
        <span className="text-xs text-muted-foreground">
          고객 카드(2번차트)에 담당실장이 지정되지 않은 경우 표시되지 않습니다
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
            {['담당실장', '오더 건수', '비급여 순매출', '급여 본부금', '공단청구액 (EDI)'].map((h) => (
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
              key={s.staffId}
              data-testid={`sales-doctor-row-${s.staffId}`}
              className="border-b transition hover:bg-muted/30"
            >
              <td className={cn('px-3 py-2 font-medium', s.staffId === '__UNASSIGNED__' && 'text-muted-foreground')}>
                {s.staffName}
              </td>
              <td className="px-3 py-2 tabular-nums text-center">{s.orderCount}</td>
              <td
                data-testid={`sales-doctor-nonins-${s.staffId}`}
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
        * 담당실장: 고객 2번차트 지정 기준 · 공단청구액(EDI)은 보험청구 시스템 연동 후 표시
      </p>
    </div>
  );
}
