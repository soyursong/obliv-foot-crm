/**
 * T-20260515-foot-SALES-TAB-DOCTOR / T-20260522-foot-SETTLE-STAFF-LABEL
 * T-20260629-foot-SALESDOCTOR-INS-SPLIT (TK-ACC-2 ①)
 * 매출집계 탭4 — 담당실장별 통계
 *
 * AC-1 (SETTLE-STAFF-LABEL): "담당의별" → "담당실장별" 라벨 변경
 * AC-2 (SETTLE-STAFF-LABEL): 데이터소스 consultant_id(deprecated) → customers.assigned_staff_id
 *   - DAILY-SETTLE-STAFF(9a97d5a) 동일 소스: 2번차트 1구역 담당자 드롭
 *   - 3-step join: payments(customer_id) → customers(assigned_staff_id) → staff(name)
 *   - NULL assigned_staff → '미지정' 포함 (DAILY-SETTLE-STAFF AC-3 일관성)
 * AC-3: 글로벌 필터(기간·검색) + 집계 기준: accounting_date
 *
 * ── INS-SPLIT (revenue_insurance_split_spec.md §2, DA SSOT 기준) ──────────────
 * AC-1: ediClaim 0 하드코딩 제거 → 공단부담액 = service_charges.insurance_covered_amount
 *       staff별·기간별 SUM (명세 grain, EDI 전송 무관 — calc_copayment RPC 차지 생성시 산출).
 * AC-2: 라벨 "공단청구액(EDI)" → "공단부담액(명세)". 명세기준 추정값(공단 심사삭감 전).
 * AC-3: 비급여 집계에 closing_manual_payments UNION (수기수납 누락경로 보강).
 * AC-4: grain 분리 준수 — 급여 본인부담금=payments(tax_type='급여')[수납 권위],
 *       비급여=payments(tax_type IN 과세_비급여/면세_비급여, NULL→면세_비급여 귀속)
 *       + closing_manual_payments UNION [수납 권위]. 선수금은 별도 버킷(3축 제외).
 *       공단부담액=service_charges[명세 권위]. 단일 테이블 집계 금지 — 소스별 조회 후 staff 병합.
 * AC-5: 할인/수기조정 전용 컬럼 부재(SSOT §6 알려진 공백) → "할인 미반영" 명시 라벨.
 *
 * 스키마 정합(foot prod 확인): service_charges{clinic_id, customer_id, is_insurance_covered,
 *   insurance_covered_amount, calculated_at}(staff_id 없음 → customer_id로 assigned_staff 매핑),
 *   closing_manual_payments{clinic_id, close_date, staff_name, amount}(customer FK 없음 →
 *   staff_name(결제담당) best-effort 귀속, 미매칭 시 미지정).
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

const UNASSIGNED = '__UNASSIGNED__';

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

/** service_charges — 명세 grain (공단부담액 권위 소스, SSOT §2-2) */
interface ChargeRow {
  customer_id: string | null;
  insurance_covered_amount: number | null;
}

/** closing_manual_payments — 수기수납 (비급여 UNION, SSOT §2-1/§4) */
interface ManualRow {
  amount: number | null;
  staff_name: string | null;
}

// 쿼리 결과 묶음
interface StaffPayData {
  rows: PayRow[];
  charges: ChargeRow[];
  manuals: ManualRow[];
  /** customer_id → staff_id */
  custStaffMap: Map<string, string>;
  /** staff_id → name */
  staffNameMap: Map<string, string>;
  /** name → staff_id (closing_manual 결제담당 귀속용) */
  nameToStaffId: Map<string, string>;
}

// ─── 집계 타입 ────────────────────────────────────────────────────────────────

interface StaffStat {
  staffId: string;     // staff UUID or '__UNASSIGNED__'
  staffName: string;   // 실명 or '미지정'
  orderCount: number;
  /** 비급여 순매출 = payments(과세/면세_비급여, NULL) net + closing_manual UNION */
  nonInsuranceRevenue: number;
  /** 급여 본인부담금 = payments(tax_type='급여') net */
  insuranceCopay: number;
  /** 공단부담액(명세) = service_charges.insurance_covered_amount SUM */
  insuranceCovered: number;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // ── fetch: payments(수납) + service_charges(명세) + closing_manual(수기) ─────
  // SSOT §0: 단일 테이블 집계 금지. 소스 grain별 조회 후 staff 단위로 병합.
  const { data, isLoading } = useQuery<StaffPayData>({
    queryKey: ['sales-doctor-ins-split', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      // 1. 결제 내역 (payments, accounting_date 기준 — 수납 grain)
      const { data: pays, error: payErr } = await supabase
        .from('payments')
        .select('id, amount, payment_type, tax_type, accounting_date, customer_id')
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (payErr) throw payErr;
      const rows = (pays ?? []) as PayRow[];

      // 2. 공단부담액 명세 (service_charges, 명세 grain — EDI 무관)
      //    calculated_at(차지 산출시각) 기준 윈도잉. 급여 항목(is_insurance_covered)만.
      const { data: scData, error: scErr } = await supabase
        .from('service_charges')
        .select('customer_id, insurance_covered_amount, is_insurance_covered, calculated_at')
        .eq('clinic_id', clinic!.id)
        .eq('is_insurance_covered', true)
        .gte('calculated_at', from)
        .lte('calculated_at', `${to}T23:59:59.999`);
      if (scErr) throw scErr;
      const charges = (scData ?? []) as ChargeRow[];

      // 3. 수기수납 (closing_manual_payments, close_date 기준 — 비급여 UNION)
      const { data: cmData, error: cmErr } = await supabase
        .from('closing_manual_payments')
        .select('amount, staff_name, close_date')
        .eq('clinic_id', clinic!.id)
        .gte('close_date', from)
        .lte('close_date', to);
      if (cmErr) throw cmErr;
      const manuals = (cmData ?? []) as ManualRow[];

      // 4. customer_ids(payments ∪ service_charges) → customers(assigned_staff_id)
      const custIds = [...new Set([
        ...rows.map((r) => r.customer_id),
        ...charges.map((c) => c.customer_id),
      ].filter(Boolean) as string[])];

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

      // 5. clinic staff 전체 → id↔name (closing_manual 결제담당 매칭 포함)
      const staffNameMap = new Map<string, string>(); // staff_id → name
      const nameToStaffId = new Map<string, string>(); // name → staff_id
      const { data: staffList, error: staffErr } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic!.id);
      if (staffErr) throw staffErr;
      for (const s of (staffList ?? []) as StaffNameRow[]) {
        staffNameMap.set(s.id, s.name);
        if (s.name) nameToStaffId.set(s.name, s.id);
      }

      return { rows, charges, manuals, custStaffMap, staffNameMap, nameToStaffId };
    },
  });

  // ── 담당실장별 집계 ────────────────────────────────────────────────────────
  // NULL assigned_staff → key='__UNASSIGNED__', name='미지정' (DAILY-SETTLE-STAFF AC-3 일관)
  const stats = useMemo<StaffStat[]>(() => {
    const {
      rows = [], charges = [], manuals = [],
      custStaffMap = new Map(), staffNameMap = new Map(), nameToStaffId = new Map(),
    } = data ?? {};
    const map = new Map<string, StaffStat>();

    const ensure = (staffId: string): StaffStat => {
      let stat = map.get(staffId);
      if (!stat) {
        stat = {
          staffId,
          staffName: staffId === UNASSIGNED ? '미지정' : (staffNameMap.get(staffId) ?? '알 수 없음'),
          orderCount: 0,
          nonInsuranceRevenue: 0,
          insuranceCopay: 0,
          insuranceCovered: 0,
        };
        map.set(staffId, stat);
      }
      return stat;
    };

    // payments — 급여 본인부담금 / 비급여 (선수금 제외, SSOT §2-1 AC-4)
    for (const p of rows) {
      const staffId = (p.customer_id ? custStaffMap.get(p.customer_id) : undefined) ?? UNASSIGNED;
      const stat = ensure(staffId);
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;

      stat.orderCount += 1;
      if (p.tax_type === '급여') {
        stat.insuranceCopay += netAmt;                 // 급여 본인부담금 [수납 권위]
      } else if (p.tax_type === '선수금') {
        // 선수금(이연매출) — 3축 집계 제외, 별도 버킷 (SSOT §2-1)
      } else {
        // 과세_비급여 / 면세_비급여 / NULL(→면세_비급여 귀속) = 비급여 [수납 권위]
        stat.nonInsuranceRevenue += netAmt;
      }
    }

    // service_charges — 공단부담액(명세) [명세 권위, EDI 무관]
    for (const c of charges) {
      const staffId = (c.customer_id ? custStaffMap.get(c.customer_id) : undefined) ?? UNASSIGNED;
      ensure(staffId).insuranceCovered += c.insurance_covered_amount ?? 0;
    }

    // closing_manual_payments — 비급여 UNION (수기수납, 결제담당 best-effort 귀속)
    for (const m of manuals) {
      const staffId = (m.staff_name && nameToStaffId.get(m.staff_name)) || UNASSIGNED;
      ensure(staffId).nonInsuranceRevenue += m.amount ?? 0;
    }

    return Array.from(map.values()).sort((a, b) => {
      // '미지정'은 항상 맨 아래
      if (a.staffId === UNASSIGNED) return 1;
      if (b.staffId === UNASSIGNED) return -1;
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
      covered: filtered.reduce((s, x) => s + x.insuranceCovered, 0),
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
            {['담당실장', '오더 건수', '비급여 순매출', '급여 본부금', '공단부담액 (명세)'].map((h) => (
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
              <td className={cn('px-3 py-2 font-medium', s.staffId === UNASSIGNED && 'text-muted-foreground')}>
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
              <td
                data-testid={`sales-doctor-covered-${s.staffId}`}
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(s.insuranceCovered))}원
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
            <td
              data-testid="sales-doctor-total-covered"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.covered))}원
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-[10px] leading-relaxed text-muted-foreground">
        * 담당실장: 고객 2번차트 지정 기준 · 공단부담액(명세)은 수가표 기준 추정값(공단 심사 전 — 실제 청구확정액과 다를 수 있음)
        <br />
        * 수기수납(closing_manual)은 결제담당 기준 귀속 · <span className="font-medium text-amber-700">할인 미반영</span>(할인/수기조정 전용 항목 미도입)
      </p>
    </div>
  );
}
