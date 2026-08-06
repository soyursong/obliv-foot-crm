/**
 * T-20260806-foot-SALESDOCTOR-COLUMN-REBUILD-4COL (김주연 총괄, C0ATE5P6JTH, human_confirmed)
 * 매출집계 > 담당실장별 탭 — 컬럼 전면 재구성. 기존 6컬럼 전면 대체(SUPERSEDE):
 *   삭제: 담당실장/상담 건 수/비급여 순매출/진찰료/공단부담액(명세)/패키지(선수금)
 *   신규 4열만 유지: [실장] [누적매출] [환불금] [총 매출]
 *   → 07-27 PKG-REVENUE-MISSING + 08-04 STAFF-4METRIC-REDEFINE + 08-04 CONSULT-COUNT-SOURCE
 *     컬럼세트를 reporter '싹 다 제거' 명시 지시로 정당 대체(policy_superseded).
 *
 * ── 컬럼 정의 (원문 4항목 직접 지정) ─────────────────────────────────────────────
 *  ① [실장]      = 담당 실장 이름 (사람 grain = staff.id).
 *  ② [누적매출]  = 상담·치료사 배정 > [랭킹] 월매출과 '동일 숫자'로 연동(AC-3).
 *                  ★신규 산식 창작 금지 — 랭킹 SSOT(fetchConsultantPerf.total_amount)를 verbatim 소비.
 *                  랭킹과 직접 대조 검증 가능해야 하므로 재집계하지 않고 그 값을 그대로 표시한다.
 *                  랭킹 귀속축 = customers.assigned_consultant_id(RPC foot_stats_consultant_admin 내부).
 *  ③ [환불금]    = 고객 카드 담당 실장(customers.assigned_staff_id = '2번차트 담당자', human_confirmed)
 *                  기준 귀속 + 그 실장이 '환불처리한 월'(= 환불 트랜잭션 월) 기준 집계(AC-4).
 *                  ★환불처리월 = 환불 payments 행의 accounting_date. sales_common_db 트리거상
 *                    INSERT 시 accounting_date=처리일(now KST)로 세팅되고 origin_tx_date=원거래일이므로,
 *                    accounting_date 윈도우 필터 = '환불처리월'(원 결제월·원 매출발생월 아님)에 정확히 해당.
 *  ④ [총 매출]   = 누적매출 − 환불금 (렌더 시 실시간 계산, AC-5).
 *
 * ── grain 정합 판단(dev, 비블로킹) ────────────────────────────────────────────
 *  누적매출 축(assigned_consultant_id, 랭킹) ≠ 환불금 축(assigned_staff_id, 2번차트). 별개 컬럼이므로
 *  각 컬럼을 reporter 지정 축으로 각각 집계하고, 표는 사람(staff.id) 단위로 병합한다.
 *  누적매출은 랭킹 값 verbatim → AC-3 '동일 숫자' 대조 검증 보장. 랭킹 미포함 실장(환불만 존재)은
 *  누적 0 + 환불금만 표기(숨김 없음). '미지정'(assigned_staff NULL 환불) = 맨 아래.
 *  ※ 랭킹 total_amount 는 이미 환불 차감된 net(consultant축·accounting_date)이라, 본 총매출=누적−환불은
 *    환불을 '2번차트 담당자축·처리월' 기준으로 추가 차감한다(축·날짜기준이 다른 reporter 지정 KPI).
 *    이 semantic 은 planner FOLLOWUP 으로 통보(비블로킹) — 구현은 명시 스펙(AC-3 verbatim + AC-5)대로.
 *
 * ── surface 격리 ────────────────────────────────────────────────────────────
 *  본 컴포넌트는 Sales.tsx(매출집계) 전용. 통계>MTM '04 실장별 실적'(lib/mtmSales.ts)은 별도 surface
 *  (로직 복제본)로 본 티켓 미대상 → 무접촉(무회귀). /admin/sales = RoleGuard admin/manager/director
 *  → fetchConsultantPerf(admin-gated SECDEF) 정당 소비자(회로 42501 위험 없음).
 *
 * READ-ONLY. DB 변경 없음(db_change=false, DDL 0).
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
import { fetchConsultantPerf, type ConsultantRow } from '@/lib/stats';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

const UNASSIGNED = '__UNASSIGNED__';

// ─── DB row types ────────────────────────────────────────────────────────────

/** 환불 payments 행 — 환불금(처리월) 소스 (accounting_date=처리일). */
interface RefundRow {
  amount: number;
  customer_id: string | null;
}

interface StaffNameRow {
  id: string;
  name: string;
}

// 쿼리 결과 묶음
interface DoctorTabData {
  /** 랭킹 SSOT(누적매출 verbatim) — consultant_id·name·total_amount */
  perfRows: ConsultantRow[];
  /** 환불 payments(처리월 accounting_date 윈도우) */
  refunds: RefundRow[];
  /** customer_id → assigned_staff_id (환불금 귀속: 2번차트 담당자) */
  custStaffMap: Map<string, string>;
  /** staff_id → name (랭킹 미포함 환불 실장 이름 해석) */
  staffNameMap: Map<string, string>;
}

// ─── 집계 타입 ────────────────────────────────────────────────────────────────

interface StaffStat {
  staffId: string;    // staff UUID or '__UNASSIGNED__'
  staffName: string;  // 실명 or '미지정'
  /** ② 누적매출 = 랭킹 total_amount(verbatim). 랭킹 미포함 실장 = 0. */
  cumulativeRevenue: number;
  /** ③ 환불금 = assigned_staff_id 귀속 + 환불처리월(accounting_date) SUM (양수 magnitude). */
  refundAmount: number;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export function SalesDoctorTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  const { data, isLoading } = useQuery<DoctorTabData>({
    queryKey: ['sales-doctor-4col', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      // 1. 누적매출 = 랭킹 SSOT(fetchConsultantPerf) verbatim 소비.
      //    ★AC-3: 랭킹 탭 월매출과 '동일 숫자'(직접 대조 검증) → 재집계 금지, 이 값을 그대로 표시.
      //    admin-gated RPC(foot_stats_consultant_admin) — /admin/sales RoleGuard(admin/manager/director)
      //    통과분만 도달하므로 42501 위험 없음.
      const perfRows = await fetchConsultantPerf(clinic!.id, from, to);

      // 2. 환불금 = 환불 payments(payment_type='refund'), accounting_date=처리일 윈도우.
      //    sales_common_db 트리거: INSERT 시 accounting_date=처리일(now KST) → 처리월 윈도우 = AC-4.
      const { data: refData, error: refErr } = await supabase
        .from('payments')
        .select('amount, customer_id')
        .eq('clinic_id', clinic!.id)
        .eq('payment_type', 'refund')
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (refErr) throw refErr;
      // 방어필터: is_simulation=true 고객 환불 제외(테스트 데이터 오염 방지, 워크인 NULL 보존).
      const simIds = await getSimulationCustomerIds(clinic!.id);
      const refunds = excludeSimulationPaymentRows((refData ?? []) as RefundRow[], simIds);

      // 3. 환불 고객 → assigned_staff_id(2번차트 담당자) 매핑
      const custIds = [
        ...new Set(refunds.map((r) => r.customer_id).filter(Boolean) as string[]),
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

      // 4. staff id↔name (랭킹 미포함 환불 실장 이름 해석)
      const staffNameMap = new Map<string, string>();
      const { data: staffList, error: staffErr } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic!.id);
      if (staffErr) throw staffErr;
      for (const s of (staffList ?? []) as StaffNameRow[]) {
        staffNameMap.set(s.id, s.name);
      }

      return { perfRows, refunds, custStaffMap, staffNameMap };
    },
  });

  // ── 담당실장별 집계 (사람 grain = staff.id) ──────────────────────────────────
  const stats = useMemo<StaffStat[]>(() => {
    const {
      perfRows = [], refunds = [], custStaffMap = new Map(), staffNameMap = new Map(),
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

    // ② 누적매출 = 랭킹 total_amount verbatim (consultant_id = staff.id). AC-3 대조 검증 보장.
    for (const r of perfRows) {
      const stat = ensure(r.consultant_id);
      stat.cumulativeRevenue += r.total_amount ?? 0;
      // 랭킹 이름을 우선 채택(랭킹 표기와 일치)
      if (r.name) stat.staffName = r.name;
    }

    // ③ 환불금 = assigned_staff_id 귀속 + 처리월 SUM(양수 magnitude).
    for (const rf of refunds) {
      const staffId =
        (rf.customer_id ? custStaffMap.get(rf.customer_id) : undefined) ?? UNASSIGNED;
      ensure(staffId).refundAmount += Math.abs(rf.amount ?? 0);
    }

    return Array.from(map.values()).sort((a, b) => {
      // '미지정'은 항상 맨 아래
      if (a.staffId === UNASSIGNED) return 1;
      if (b.staffId === UNASSIGNED) return -1;
      // 랭킹과 동일하게 누적매출 desc → 총매출 desc → 이름(ko)
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
          상담·치료사 배정 &gt; 랭킹에 매출이 잡힌 실장이 없으면 표시되지 않습니다
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
                {/* ② 누적매출 (랭킹 연동) */}
                <td
                  data-testid={`sales-doctor-cumulative-${s.staffId}`}
                  className={cn(
                    'px-3 py-2 tabular-nums text-right font-semibold',
                    s.cumulativeRevenue < 0 && 'text-red-600',
                  )}
                >
                  {formatAmount(Math.round(s.cumulativeRevenue))}원
                </td>
                {/* ③ 환불금 (2번차트 담당자·처리월) */}
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
        * 누적매출 = 상담·치료사 배정 &gt; <span className="font-medium text-teal-700">랭킹</span>의 월매출과 동일 값(연동)
        <br />
        * 환불금 = 고객 카드 담당 실장(2번차트 담당자) 기준 · <span className="font-medium text-red-600">환불처리한 달</span> 기준 집계
        <br />
        * <span className="font-medium text-teal-700">총 매출 = 누적매출 − 환불금</span>
      </p>
    </div>
  );
}
