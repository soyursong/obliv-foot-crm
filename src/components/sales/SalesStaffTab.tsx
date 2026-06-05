/**
 * T-20260515-foot-SALES-TAB-STAFF
 * 매출집계 탭5 — 담당직원별 정산
 *
 * AC-1: check_ins.therapist_id / technician_id 기준 그룹
 * AC-2: 시술 건수 + 실적 금액 + 환불 차감액
 * AC-3: 소급 방지 환불 차감 엔진 — 당월(accounting_date) 마이너스 표출
 * AC-4: 글로벌 필터(기간·검색) + 엑셀 — Sales.tsx 공통 레이어 사용
 * T-20260522-foot-DESIGNATED-THERAPIST AC-4: 치료사별 지정환자수 컬럼
 *
 * T-20260605-foot-SALES-STAFF-DEDUCT-BASIS — 귀속 기준 전환
 *   기존(수납기준): payments → check_ins.therapist/technician, accounting_date.
 *   신규(차감기준): package_sessions(status='used') → performed_by(차감 치료사),
 *                   unit_price 스냅샷 합, session_date 기준.
 *   두 기준을 토글로 공존(별도 신규 view, 기존 payments 비파괴 / AC-2).
 *   field 결정값은 아래 DEDUCT_* 상수로 토글(AC-3/4/5). DECISION-REQUEST 회신 후 반영.
 *
 * READ-ONLY. DB 변경 없음.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

// ── T-20260605 field 결정 기본값 (DECISION-REQUEST 회신 시 변경) ───────────────
// AC-3 금액기준: 'snapshot'(권장·불변 = package_sessions.unit_price)
//              | 'current'(packages.{type}_unit_price 현재 설정값)
const DEDUCT_AMOUNT_BASIS: 'snapshot' | 'current' = 'snapshot';
// AC-4 추가금(surcharge) 포함 여부 — 기본 미포함
const DEDUCT_INCLUDE_SURCHARGE = false;
// AC-4 환불/취소 세션은 쿼리에서 status='used'만 조회 → 자동 제외 (기본)
// AC-5 소급: session_date 범위 기반이라 performed_by 기록된 과거 차감건 자연 포함 (기본 true)

type StaffBasis = 'payment' | 'deduction';

// ── 수납기준(기존) 타입 ────────────────────────────────────────────────────────
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
  /** T-20260522-foot-DESIGNATED-THERAPIST AC-4: 지정환자수 */
  designatedCount: number;
}

// ── 차감기준(신규) 타입 ────────────────────────────────────────────────────────
interface DeductSessionRow {
  id: string;
  unit_price: number | null;
  surcharge: number | null;
  session_date: string | null;
  status: string | null;
  session_type: string | null;
  performed_by: string | null;
  packages: {
    clinic_id: string;
    heated_unit_price: number | null;
    unheated_unit_price: number | null;
    iv_unit_price: number | null;
    podologe_unit_price: number | null;
    trial_unit_price: number | null;
  } | null;
  performer: { id: string; name: string } | null;
}

interface DeductStat {
  staffId: string;
  staffName: string;
  count: number;
  revenue: number;
  designatedCount: number;
}

/** session_type → packages 현재 단가 컬럼 (AC-3 'current' 기준 / preconditioning은 스냅샷 fallback) */
function currentUnitPrice(row: DeductSessionRow): number {
  const pkg = row.packages;
  const snap = row.unit_price ?? 0;
  if (!pkg) return snap;
  switch (row.session_type) {
    case 'heated_laser':
      return pkg.heated_unit_price ?? snap;
    case 'unheated_laser':
      return pkg.unheated_unit_price ?? snap;
    case 'iv':
      return pkg.iv_unit_price ?? snap;
    case 'podologue':
    case 'podologe':
      return pkg.podologe_unit_price ?? snap;
    case 'trial':
      return pkg.trial_unit_price ?? snap;
    // preconditioning 등 대응 컬럼 없는 타입은 스냅샷 fallback
    default:
      return snap;
  }
}

export function SalesStaffTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // T-20260605: 귀속 기준 토글 (기본 = 차감기준 = 총괄 요청 표시값)
  const [basis, setBasis] = useState<StaffBasis>('deduction');

  // accounting_date 기준 조회 — 소급 방지의 핵심 (AC-3) / 수납기준
  const { data: payments = [], isLoading: payLoading } = useQuery<StaffPayRow[]>({
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

  // T-20260605 차감기준 조회 — package_sessions(status='used') → performed_by, session_date
  const { data: deductSessions = [], isLoading: deductLoading } = useQuery<DeductSessionRow[]>({
    queryKey: ['sales-staff-deduct', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_sessions')
        .select(`
          id, unit_price, surcharge, session_date, status, session_type, performed_by,
          packages!inner(
            clinic_id,
            heated_unit_price, unheated_unit_price, iv_unit_price,
            podologe_unit_price, trial_unit_price
          ),
          performer:staff!performed_by(id, name)
        `)
        .eq('packages.clinic_id', clinic!.id)
        .eq('status', 'used')          // AC-4: cancelled/refunded 제외
        .not('performed_by', 'is', null)
        .gte('session_date', from)     // AC-1: session_date(차감일) 기준
        .lte('session_date', to);
      if (error) throw error;
      return data as unknown as DeductSessionRow[];
    },
  });

  // T-20260522-foot-DESIGNATED-THERAPIST AC-4: 치료사별 지정환자수
  const { data: designatedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['sales-staff-designated', clinic?.id],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('designated_therapist_id')
        .eq('clinic_id', clinic!.id)
        .not('designated_therapist_id', 'is', null);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as { designated_therapist_id: string | null }[]) {
        if (row.designated_therapist_id) {
          map[row.designated_therapist_id] = (map[row.designated_therapist_id] ?? 0) + 1;
        }
      }
      return map;
    },
  });

  // ── 수납기준 집계 (AC-1 · AC-2 · AC-3) ──────────────────────────────────────
  const payStats = useMemo<StaffStat[]>(() => {
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
        designatedCount: designatedMap[staffId] ?? 0,
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
  }, [payments, designatedMap]);

  // ── 차감기준 집계 (T-20260605 AC-1) ─────────────────────────────────────────
  // performed_by(차감 치료사) 그룹 → unit_price 스냅샷 합(AC-3) + surcharge 옵션(AC-4).
  const deductStats = useMemo<DeductStat[]>(() => {
    const map = new Map<string, DeductStat>();
    for (const s of deductSessions) {
      const perf = s.performer;
      if (!perf?.id) continue;
      const base =
        DEDUCT_AMOUNT_BASIS === 'current' ? currentUnitPrice(s) : (s.unit_price ?? 0);
      const amt = base + (DEDUCT_INCLUDE_SURCHARGE ? (s.surcharge ?? 0) : 0);
      const existing = map.get(perf.id) ?? {
        staffId: perf.id,
        staffName: perf.name,
        count: 0,
        revenue: 0,
        designatedCount: designatedMap[perf.id] ?? 0,
      };
      existing.count += 1;
      existing.revenue += amt;
      map.set(perf.id, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [deductSessions, designatedMap]);

  // 검색 필터 — 직원 이름 (글로벌 필터 공통 레이어)
  const filteredPay = useMemo<StaffStat[]>(() => {
    if (!searchQuery) return payStats;
    return payStats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [payStats, searchQuery]);

  const filteredDeduct = useMemo<DeductStat[]>(() => {
    if (!searchQuery) return deductStats;
    return deductStats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [deductStats, searchQuery]);

  const payTotals = useMemo(
    () => ({
      count: filteredPay.reduce((s, x) => s + x.count, 0),
      revenue: filteredPay.reduce((s, x) => s + x.revenue, 0),
      refund: filteredPay.reduce((s, x) => s + x.refundAmount, 0),
    }),
    [filteredPay],
  );

  const deductTotals = useMemo(
    () => ({
      count: filteredDeduct.reduce((s, x) => s + x.count, 0),
      revenue: filteredDeduct.reduce((s, x) => s + x.revenue, 0),
    }),
    [filteredDeduct],
  );

  const isLoading = basis === 'payment' ? payLoading : deductLoading;

  // ── 기준 토글 바 ────────────────────────────────────────────────────────────
  const BasisToggle = (
    <div
      data-testid="sales-staff-basis-toggle"
      className="mb-2 flex items-center gap-2 text-xs"
    >
      <span className="text-muted-foreground">귀속 기준</span>
      <div className="inline-flex overflow-hidden rounded-md border">
        <button
          data-testid="sales-staff-basis-deduction"
          onClick={() => setBasis('deduction')}
          className={cn(
            'px-3 py-1 font-medium transition-colors',
            basis === 'deduction' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          차감기준
        </button>
        <button
          data-testid="sales-staff-basis-payment"
          onClick={() => setBasis('payment')}
          className={cn(
            'px-3 py-1 font-medium transition-colors',
            basis === 'payment' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          수납기준
        </button>
      </div>
      <span className="text-muted-foreground">
        {basis === 'deduction'
          ? '패키지 티켓 차감(시술) 치료사 × 차감수가'
          : '수납 시점 치료사/장비 × 결제금액'}
      </span>
    </div>
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-loading"
          className="flex items-center justify-center py-16 text-sm text-muted-foreground"
        >
          불러오는 중…
        </div>
      </div>
    );
  }

  // ── 차감기준 view (T-20260605) ─────────────────────────────────────────────
  if (basis === 'deduction') {
    if (filteredDeduct.length === 0) {
      return (
        <div>
          {BasisToggle}
          <div
            data-testid="sales-staff-deduct-empty"
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
          >
            <span className="text-sm text-muted-foreground">해당 기간에 차감 내역이 없습니다</span>
            <span className="text-xs text-muted-foreground">
              패키지 티켓 차감 시 치료사(performed_by)가 기록된 세션만 집계됩니다
            </span>
          </div>
        </div>
      );
    }

    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-deduct-tab"
          className="overflow-auto rounded-lg border bg-background text-xs"
        >
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/70">
              <tr>
                {['치료사', '차감 건수', '지정환자수', '차감 매출'].map((h) => (
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
              {filteredDeduct.map((s) => (
                <tr
                  key={s.staffId}
                  data-testid={`sales-staff-deduct-row-${s.staffId}`}
                  className="border-b transition hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{s.staffName}</td>
                  <td
                    data-testid={`sales-staff-deduct-count-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-center"
                  >
                    {s.count}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-center">
                    <span className={cn(s.designatedCount > 0 && 'font-semibold text-emerald-700')}>
                      {s.designatedCount}
                    </span>
                  </td>
                  <td
                    data-testid={`sales-staff-deduct-revenue-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-right font-semibold"
                  >
                    {formatAmount(Math.round(s.revenue))}원
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-3 py-2">합계</td>
                <td
                  data-testid="sales-staff-deduct-total-count"
                  className="px-3 py-2 tabular-nums text-center"
                >
                  {deductTotals.count}
                </td>
                <td className="px-3 py-2 tabular-nums text-center text-muted-foreground text-xs">—</td>
                <td
                  data-testid="sales-staff-deduct-total-revenue"
                  className="px-3 py-2 tabular-nums text-right"
                >
                  {formatAmount(Math.round(deductTotals.revenue))}원
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            * 차감기준: 패키지 티켓 차감(시술) 시점의 치료사에게 차감 수가 귀속 (status='used', 환불·취소 제외).
            금액 기준: {DEDUCT_AMOUNT_BASIS === 'snapshot' ? '차감 당시 단가(스냅샷)' : '현재 설정 단가'}
            {DEDUCT_INCLUDE_SURCHARGE ? ' · 추가금 포함' : ' · 추가금 미포함'}
          </p>
        </div>
      </div>
    );
  }

  // ── 수납기준 view (기존) ────────────────────────────────────────────────────
  if (filteredPay.length === 0) {
    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-empty"
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
        >
          <span className="text-sm text-muted-foreground">해당 기간에 담당직원 데이터가 없습니다</span>
          <span className="text-xs text-muted-foreground">
            수납에 치료사/장비명이 연결되지 않은 경우 표시되지 않습니다
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {BasisToggle}
      <div
        data-testid="sales-staff-tab"
        className="overflow-auto rounded-lg border bg-background text-xs"
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/70">
            <tr>
              {['직원명', '역할', '시술 건수', '지정환자수', '실적 금액', '환불 차감액', '순 실적'].map((h) => (
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
            {filteredPay.map((s) => {
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
                  {/* T-20260522-foot-DESIGNATED-THERAPIST AC-4 */}
                  <td
                    data-testid={`sales-staff-designated-${s.role}-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-center"
                  >
                    {s.role === 'therapist' ? (
                      <span className={cn(s.designatedCount > 0 && 'font-semibold text-emerald-700')}>
                        {s.designatedCount}
                      </span>
                    ) : '—'}
                  </td>
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
                {payTotals.count}
              </td>
              <td className="px-3 py-2 tabular-nums text-center text-muted-foreground text-xs">—</td>
              <td
                data-testid="sales-staff-total-revenue"
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(payTotals.revenue))}원
              </td>
              <td
                data-testid="sales-staff-total-refund"
                className="px-3 py-2 tabular-nums text-right text-red-600"
              >
                {payTotals.refund > 0 ? `-${formatAmount(Math.round(payTotals.refund))}원` : '—'}
              </td>
              <td
                data-testid="sales-staff-total-net"
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(payTotals.revenue - payTotals.refund))}원
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          * 소급 방지: 환불액은 환불 처리 당월 해당 직원 실적에서 차감 (과거 월 데이터 불변)
        </p>
      </div>
    </div>
  );
}
