/**
 * T-20260806-foot-SALESDOCTOR-CUMUL-GROSS-REDEFINE (김주연 총괄, forward-iteration of 4COL)
 *   (canonical; dedup of T-20260806-foot-SALESDOCTOR-CUMULATIVE-GROSS-RECOMPUTE — 동일 결정, planner void)
 * 매출집계 > 담당실장별 탭 — [누적매출]을 gross(환불 차감 前 원본 수납)로 재산식. 환불 단일차감.
 *
 * ── 왜 재산식인가 (부모 4COL 이중차감 RC) ─────────────────────────────────────────
 *  부모 as-built(aaaafd09): 누적매출 = 랭킹 total_amount verbatim(net, mig 20260724130000)이라
 *  이미 환불이 차감된 값이었다. 여기서 다시 총매출 = 누적 − 환불금 → 동일 환불이 '이중차감'됐다.
 *  reporter(총괄) 확정 = 누적매출을 gross(환불 차감 前 원본 수납 합계)로 바꿔 환불이 '한 번만' 빠지게 한다.
 *  ⇒ 랭킹 verbatim(net) 소비 중단. 누적매출 ≠ 랭킹 탭(랭킹은 net 유지) = reporter 명시 수용(회귀 아님).
 *
 * ── 컬럼 정의 (4열 유지, 산식만 개정) ──────────────────────────────────────────────
 *  ① [실장]      = 담당 실장 이름 (사람 grain = staff.id).
 *  ② [누적매출]  = gross(환불 차감 前 원본 수납 합계). ★랭킹 verbatim 소비 중단(신 직접집계).
 *                  = (a) 단건(payments) 매출 rows SUM (payment_type≠'refund', status≠deleted) [gross]
 *                  + (b) 패키지(package_payments) NET (환불=음수상계) [부모와 동일 net]
 *                  귀속축 = customers.assigned_staff_id('2번차트 담당자', 환불금과 동일축) · accounting_date 윈도우.
 *  ③ [환불금]    = 단건(payments) 환불 SUM (payment_type='refund'). ★부모 AC-4 그대로 유지 —
 *                  assigned_staff_id 귀속 + 환불처리월(accounting_date) 윈도우 · 소스=payments only(불변).
 *  ④ [총 매출]   = 누적매출 − 환불금 (렌더 시 실시간 계산).
 *
 * ── 산식 정합 증명 (환불 단일차감) ────────────────────────────────────────────────
 *  reporter 확정 공식 "총 = gross누적 − 환불금(AC-4=단건환불)" 가 올바른 net 이 되려면
 *  gross누적 = 단건gross + 패키지net 이어야 한다(수학적 강제):
 *    총 = (단건gross + 패키지net) − 단건환불 = (단건gross − 단건환불) + 패키지net = 단건net + 패키지net.
 *  ∴ 단건환불은 정확히 1회(환불금 컬럼)만 차감된다. 패키지환불은 부모와 동일하게 패키지net 안에서 1회
 *    차감(환불금 컬럼 미표기 = 부모 랭킹net 시절과 동일 취급). 이중차감 없음.
 *  ★패키지를 net 으로 두는 이유: 부모 환불금(AC-4)이 payments-only(패키지 환불 미포함)이므로,
 *    패키지 환불은 패키지net 안에 접어 넣어야 정확히 1회 차감된다(풋=패키지 1급 → 매출 보존 필수).
 *
 * ── grain 정합 판단(dev, 비블로킹) ────────────────────────────────────────────────
 *  누적/환불/총 3열 전부 동일축(assigned_staff_id = 담당실장='담당실장별' 탭 취지) + 동일 윈도우(accounting_date).
 *  부모의 축 불일치(누적=consultant랭킹 vs 환불=assigned_staff)를 해소 → 단일축으로 통일.
 *  랭킹 탭(통계/배정 consultant축·net)과는 별개 surface(무접촉). 누적 ≠ 랭킹 = 설계상 정상.
 *  '미지정'(assigned_staff NULL) = 맨 아래. 매출/환불 어느 하나라도 있는 실장은 표시(숨김 없음).
 *
 * ── surface 격리 ────────────────────────────────────────────────────────────────
 *  본 컴포넌트는 Sales.tsx(매출집계) 전용. 통계>MTM '04 실장별 실적'(lib/mtmSales.ts)·랭킹 탭은 별도 surface
 *  → 본 티켓 무대상·무접촉(무회귀). /admin/sales = RoleGuard admin/manager/director.
 *  소스(payments/package_payments/customers/staff)는 전부 RLS clinic-scoped 정당 조회.
 *
 * READ-ONLY 산식. DB 변경 없음(db_change=false, DDL 0).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

const UNASSIGNED = '__UNASSIGNED__';

// ─── DB row types ────────────────────────────────────────────────────────────

/** 단건 payments 행 (누적 gross + 환불금 소스). status≠deleted, accounting_date 윈도우. */
interface PaymentRow {
  amount: number;
  payment_type: string | null; // 'payment' | 'refund'
  customer_id: string | null;
}

/** 패키지 package_payments 행 (누적 NET 소스, 환불=음수상계). status 컬럼 부재(foot 실측). */
interface PkgPaymentRow {
  amount: number;
  payment_type: string | null; // 'payment' | 'refund' | 'deposit'…
  customer_id: string | null;
}

interface StaffNameRow {
  id: string;
  name: string;
}

// 쿼리 결과 묶음
interface DoctorTabData {
  /** 단건 결제(payments) — 누적 gross + 환불금 */
  singlePayments: PaymentRow[];
  /** 패키지 결제(package_payments) — 누적 NET(환불 음수상계) */
  pkgPayments: PkgPaymentRow[];
  /** customer_id → assigned_staff_id (귀속: 2번차트 담당자) */
  custStaffMap: Map<string, string>;
  /** staff_id → name */
  staffNameMap: Map<string, string>;
}

// ─── 집계 타입 ────────────────────────────────────────────────────────────────

interface StaffStat {
  staffId: string;    // staff UUID or '__UNASSIGNED__'
  staffName: string;  // 실명 or '미지정'
  /** ② 누적매출(gross) = 단건 gross + 패키지 net. */
  cumulativeRevenue: number;
  /** ③ 환불금 = 단건(payments) 환불 SUM (양수 magnitude). 부모 AC-4 불변. */
  refundAmount: number;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  const { data, isLoading } = useQuery<DoctorTabData>({
    queryKey: ['sales-doctor-gross', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      // 1. 단건 결제(payments): accounting_date 윈도우 · status≠deleted · payment/refund 전부.
      //    누적 gross = payment_type≠'refund' SUM · 환불금 = payment_type='refund' SUM.
      const { data: payData, error: payErr } = await supabase
        .from('payments')
        .select('amount, payment_type, customer_id')
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (payErr) throw payErr;

      // 2. 패키지 결제(package_payments): accounting_date 윈도우. status 컬럼 부재 → 필터 없음(환불=음수상계).
      //    누적 NET 에 접어 넣음(부모 랭킹net 시절과 동일 취급 → 패키지 환불 1회 차감).
      const { data: pkgData, error: pkgErr } = await supabase
        .from('package_payments')
        .select('amount, payment_type, customer_id')
        .eq('clinic_id', clinic!.id)
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (pkgErr) throw pkgErr;

      // 방어필터: is_simulation=true 고객 결제 제외(테스트 데이터 오염 방지, 워크인 NULL 보존).
      const simIds = await getSimulationCustomerIds(clinic!.id);
      const singlePayments = excludeSimulationPaymentRows(
        (payData ?? []) as PaymentRow[],
        simIds,
      );
      const pkgPayments = excludeSimulationPaymentRows(
        (pkgData ?? []) as PkgPaymentRow[],
        simIds,
      );

      // 3. 결제 고객 → assigned_staff_id(2번차트 담당자) 매핑 (단건 ∪ 패키지 고객).
      const custIds = [
        ...new Set(
          [
            ...singlePayments.map((r) => r.customer_id),
            ...pkgPayments.map((r) => r.customer_id),
          ].filter(Boolean) as string[],
        ),
      ];
      const custStaffMap = new Map<string, string>(); // customer_id → staff_id
      if (custIds.length > 0) {
        const { data: custs, error: custErr } = await supabase
          .from('customers')
          .select('id, assigned_staff_id')
          .in('id', custIds);
        if (custErr) throw custErr;
        for (const c of (custs ?? []) as { id: string; assigned_staff_id: string | null }[]) {
          if (c.assigned_staff_id) custStaffMap.set(c.id, c.assigned_staff_id);
        }
      }

      // 4. staff id↔name (담당 실장 이름 해석)
      const staffNameMap = new Map<string, string>();
      const { data: staffList, error: staffErr } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic!.id);
      if (staffErr) throw staffErr;
      for (const s of (staffList ?? []) as StaffNameRow[]) {
        staffNameMap.set(s.id, s.name);
      }

      return { singlePayments, pkgPayments, custStaffMap, staffNameMap };
    },
  });

  // ── 담당실장별 집계 (사람 grain = staff.id, 단일축 assigned_staff_id) ─────────────
  const stats = useMemo<StaffStat[]>(() => {
    const {
      singlePayments = [], pkgPayments = [], custStaffMap = new Map(), staffNameMap = new Map(),
    } = data ?? {};
    const map = new Map<string, StaffStat>();

    const ensure = (staffId: string): StaffStat => {
      let stat = map.get(staffId);
      if (!stat) {
        stat = {
          staffId,
          staffName:
            staffId === UNASSIGNED ? '미지정' : (staffNameMap.get(staffId) ?? '알 수 없음'),
          cumulativeRevenue: 0,
          refundAmount: 0,
        };
        map.set(staffId, stat);
      }
      return stat;
    };

    const staffOf = (customerId: string | null): string =>
      (customerId ? custStaffMap.get(customerId) : undefined) ?? UNASSIGNED;

    // ② 단건(payments): gross → 누적 / refund → 환불금(부모 AC-4).
    for (const p of singlePayments) {
      const stat = ensure(staffOf(p.customer_id));
      if (p.payment_type === 'refund') {
        stat.refundAmount += Math.abs(p.amount ?? 0);
      } else {
        stat.cumulativeRevenue += p.amount ?? 0;
      }
    }

    // ② 패키지(package_payments): NET(환불 음수상계) → 누적 에 접어 넣음(환불금 컬럼 미표기).
    for (const pp of pkgPayments) {
      const net = pp.payment_type === 'refund' ? -(pp.amount ?? 0) : (pp.amount ?? 0);
      ensure(staffOf(pp.customer_id)).cumulativeRevenue += net;
    }

    return Array.from(map.values()).sort((a, b) => {
      // '미지정'은 항상 맨 아래
      if (a.staffId === UNASSIGNED) return 1;
      if (b.staffId === UNASSIGNED) return -1;
      // 누적매출 desc → 총매출 desc → 이름(ko)
      return (
        b.cumulativeRevenue - a.cumulativeRevenue ||
        (b.cumulativeRevenue - b.refundAmount) - (a.cumulativeRevenue - a.refundAmount) ||
        a.staffName.localeCompare(b.staffName, 'ko')
      );
    });
  }, [data]);

  // AC-6 검색 필터 — 담당실장 이름 포함 검색
  const filtered = useMemo<StaffStat[]>(() => {
    if (!searchQuery) return stats;
    return stats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [stats, searchQuery]);

  const totals = useMemo(
    () => ({
      cumulative: filtered.reduce((s, x) => s + x.cumulativeRevenue, 0),
      refund: filtered.reduce((s, x) => s + x.refundAmount, 0),
      total: filtered.reduce((s, x) => s + (x.cumulativeRevenue - x.refundAmount), 0),
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
          담당 실장(2번차트) 기준 수납·환불이 잡힌 실장이 없으면 표시되지 않습니다
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
            {['실장', '누적매출', '환불금', '총 매출'].map((h) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap border-b px-3 py-2 font-medium text-muted-foreground',
                  h === '실장' ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const totalRevenue = s.cumulativeRevenue - s.refundAmount;
            return (
              <tr
                key={s.staffId}
                data-testid={`sales-doctor-row-${s.staffId}`}
                className="border-b transition hover:bg-muted/30"
              >
                {/* ① 실장 */}
                <td
                  className={cn(
                    'px-3 py-2 font-medium',
                    s.staffId === UNASSIGNED && 'text-muted-foreground',
                  )}
                >
                  {s.staffName}
                </td>
                {/* ② 누적매출 (gross = 단건gross + 패키지net) */}
                <td
                  data-testid={`sales-doctor-cumulative-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right font-semibold',
                    s.cumulativeRevenue < 0 && 'text-red-600',
                  )}
                >
                  {formatAmount(Math.round(s.cumulativeRevenue))}원
                </td>
                {/* ③ 환불금 (단건 환불 · 2번차트 담당자 · 처리월) */}
                <td
                  data-testid={`sales-doctor-refund-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right',
                    s.refundAmount > 0 && 'text-red-600',
                  )}
                >
                  {s.refundAmount > 0 ? '−' : ''}
                  {formatAmount(Math.round(s.refundAmount))}원
                </td>
                {/* ④ 총 매출 = 누적 − 환불 */}
                <td
                  data-testid={`sales-doctor-total-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right font-semibold text-teal-700',
                    totalRevenue < 0 && 'text-red-600',
                  )}
                >
                  {formatAmount(Math.round(totalRevenue))}원
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-3 py-2">합계</td>
            <td
              data-testid="sales-doctor-total-cumulative"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.cumulative))}원
            </td>
            <td
              data-testid="sales-doctor-total-refund"
              className={cn(
                'px-3 py-2 tabular-nums text-right',
                totals.refund > 0 && 'text-red-600',
              )}
            >
              {totals.refund > 0 ? '−' : ''}
              {formatAmount(Math.round(totals.refund))}원
            </td>
            <td
              data-testid="sales-doctor-total-total"
              className="px-3 py-2 tabular-nums text-right font-semibold text-teal-700"
            >
              {formatAmount(Math.round(totals.total))}원
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-[10px] leading-relaxed text-muted-foreground">
        * 누적매출 = <span className="font-medium text-teal-700">환불 차감 전</span> 원본 수납 합계(gross) · 담당 실장(2번차트 담당자) 기준
        <br />
        * 환불금 = 담당 실장(2번차트 담당자) 기준 · <span className="font-medium text-red-600">환불처리한 달</span> 기준 집계(단건)
        <br />
        * <span className="font-medium text-teal-700">총 매출 = 누적매출 − 환불금</span> (환불 1회 차감)
      </p>
    </div>
  );
}
