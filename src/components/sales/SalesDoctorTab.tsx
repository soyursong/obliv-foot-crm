/**
 * T-20260515-foot-SALES-TAB-DOCTOR / T-20260522-foot-SETTLE-STAFF-LABEL
 * T-20260629-foot-SALESDOCTOR-INS-SPLIT (TK-ACC-2 ①)
 * T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING (A안 ADDITIVE)
 * T-20260804-foot-SALESAGG-STAFF-4METRIC-REDEFINE (②③④ 구현)
 * T-20260804-foot-SALESAGG-CONSULT-COUNT-SOURCE (① — 첫 컬럼 '오더 건수'→'상담 건 수', 案1)
 * 매출집계 탭4 — 담당실장별 통계
 *
 * ── CONSULT-COUNT (① 案1, 김주연 총괄 2026-08-04 확정) ────────────────────────
 * 첫 컬럼 라벨 '오더 건수'(payments row 카운트=구 ticketing_count, 案3 폐기) →
 *   '상담 건 수' = assigned_staff_id별 + check_ins.consultation_done=true 방문 수.
 *   = 담당실장이 맡은 고객 중 실제 상담이 완료된 방문 수(담당실장 grain).
 * 案2(consultant_id 수행자 grain)·案3(ticketing_count) 폐기. 다른 컬럼(패키지·진찰료·공단)과
 *   grain 일치(assigned_staff_id) → 별도 오독방지 UI 불요. READ-ONLY, DB 무변경.
 *   ★4METRIC-REDEFINE(②③④)와 공존: ①만 이 커밋에서 오더→상담 치환, ②③④ 값/컬럼 불변 보존.
 *
 * ── 4METRIC-REDEFINE (김주연 총괄 2026-08-04 지시, ②③④ 구현) ──────────────────
 * 총괄 원문 4개 항목 재정비 중 데이터소스가 명확한 3건 반영(비파괴·SSOT 소비):
 *   ② 패키지 = 실장별 패키지 결제 금액 SUM = 기존 packageRevenue(tax_type='선수금' net).
 *      이미 SUM 집계 → 라벨('패키지 (선수금)')·값 불변으로 AC-2 충족(현행 톤 유지).
 *   ③ 진찰료 = 급여 본인부담금만(비급여 진찰료 제외) = 기존 insuranceCopay(tax_type='급여' net).
 *      매출 급여/비급여/공단부담 산식 SSOT 준수 → 라벨 '급여 본부금' → '진찰료'만 변경, 값 불변.
 *   ④ 총 매출 = ②패키지 결제 합산 + ③급여 본인부담금 합산 (담당실장별 섹션 grain-로컬 정의).
 *      신규 최우측 컬럼(ADDITIVE). ★섹션-로컬 정의: 비급여·공단부담은 포함하지 않음(총괄 명시 산식).
 *   ① '오더 건 수' → '상담 건 수': 위 CONSULT-COUNT 案1로 확정 반영(4METRIC 커밋 당시 FOLLOWUP 보류분 완결).
 *
 * ── PKG-REVENUE (A안 ADDITIVE, 김주연 총괄 2026-07-27 확정) ────────────────────
 * 배경: tax_type='선수금'(패키지 선결제)이 기존 3축(급여/비급여/공단)에서 명시 제외 →
 *       담당실장별 화면에서 패키지 매출 0원/미표시.
 * 조치: 기존 급여/비급여 컬럼 숫자 불변(회귀 0 = 배포 게이트) 하에, 최우측에 '패키지(선수금)'
 *       컬럼 신규 추가. 선수금 버킷을 packageRevenue/packageCount로 별도 집계(ADDITIVE).
 * 인식시점: 판매(결제)시점 = accounting_date(INSERT 트리거로 판매일 세팅). 회차 차감시점 아님
 *          (회차 차감은 payments row 미생성 → 자동 제외). READ-ONLY, DB 무변경.
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

/**
 * check_ins — 상담 건 수 소스 (案1, T-20260804-foot-SALESAGG-CONSULT-COUNT-SOURCE).
 * 김주연 총괄 2026-08-04 확정: '상담 건 수' = assigned_staff_id별 + consultation_done=true 방문 수.
 * 담당실장이 맡은 고객 중 실제 상담이 완료된 방문(check_in) 건수 = 담당실장 grain.
 * 상담 수행자(consultant)가 아니라 customer.assigned_staff_id 위치로 일관 카운트(시나리오2).
 */
interface ConsultRow {
  customer_id: string | null;
}

// 쿼리 결과 묶음
interface StaffPayData {
  rows: PayRow[];
  charges: ChargeRow[];
  manuals: ManualRow[];
  /** 상담 완료(consultation_done=true) 내원 — 案1 상담 건 수 소스 */
  consults: ConsultRow[];
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
  /**
   * 상담 건 수 (案1, SALESAGG-CONSULT-COUNT-SOURCE) =
   *   담당실장(assigned_staff_id)이 맡은 고객의 consultation_done=true 방문 수.
   * 구 '오더 건수'(payments row 카운트, 案3 ticketing_count) 폐기 → 案1 대체.
   */
  consultCount: number;
  /** 비급여 순매출 = payments(과세/면세_비급여, NULL) net + closing_manual UNION */
  nonInsuranceRevenue: number;
  /** 급여 본인부담금 = payments(tax_type='급여') net */
  insuranceCopay: number;
  /** 공단부담액(명세) = service_charges.insurance_covered_amount SUM */
  insuranceCovered: number;
  /**
   * T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING (A안 ADDITIVE)
   * 패키지(선수금) 순매출 = payments(tax_type='선수금') net.
   * 인식시점 = 판매(결제)시점 = accounting_date(INSERT 트리거로 판매일 세팅, Sales.tsx L230).
   *   회차 차감은 payments row를 만들지 않으므로 이 버킷은 "판매시점"만 집계(차감시점 아님).
   * 별도 신규 컬럼 — 기존 급여/비급여 버킷 로직 불변(회귀 0 게이트).
   */
  packageRevenue: number;
  /** 패키지(선수금) 결제 건수 (Q3: 패키지 자체 건수 별도 표시) */
  packageCount: number;
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
      // 방어필터: is_simulation=true 고객 결제/명세 제외 (워크인 NULL 보존).
      //   payments·service_charges 모두 customer_id 보유 → 동일 sim 집합 적용.
      //   T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE
      const simIds = await getSimulationCustomerIds(clinic!.id);
      const rows = excludeSimulationPaymentRows((pays ?? []) as PayRow[], simIds);

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
      const charges = excludeSimulationPaymentRows((scData ?? []) as ChargeRow[], simIds);

      // 3. 수기수납 (closing_manual_payments, close_date 기준 — 비급여 UNION)
      // T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE: soft-void 무효행 제외(합산경로 (c) 상담의사별 비급여 매출).
      //   voided_at IS NULL 유효행만 → 담당실장별 비급여 UNION 집계가 grossTotal/SalesDailyTab(b)와 일관.
      //   forward 프리미티브 배포 시점 전건 voided_at=NULL → 합계 불변(net-zero). ((a)(b) 동일 패턴)
      const { data: cmData, error: cmErr } = await supabase
        .from('closing_manual_payments')
        .select('amount, staff_name, close_date')
        .eq('clinic_id', clinic!.id)
        .gte('close_date', from)
        .lte('close_date', to)
        .is('voided_at', null);
      if (cmErr) throw cmErr;
      const manuals = (cmData ?? []) as ManualRow[];

      // 3b. 상담 건 수 소스 (案1) — check_ins(consultation_done=true), checked_in_at 윈도잉(KST).
      //   T-20260804-foot-SALESAGG-CONSULT-COUNT-SOURCE: assigned_staff_id별 상담완료 방문 수.
      //   sim 고객 제외(방어필터 동일 집합). 취소/삭제 방문은 상담완료로 서지 않으나 명시 제외.
      const { data: ciData, error: ciErr } = await supabase
        .from('check_ins')
        .select('customer_id')
        .eq('clinic_id', clinic!.id)
        .eq('consultation_done', true)
        .is('deleted_at', null)
        .neq('status', 'cancelled')
        .gte('checked_in_at', `${from}T00:00:00+09:00`)
        .lte('checked_in_at', `${to}T23:59:59+09:00`);
      if (ciErr) throw ciErr;
      const consults = ((ciData ?? []) as ConsultRow[]).filter(
        (c) => !c.customer_id || !simIds.has(c.customer_id),
      );

      // 4. customer_ids(payments ∪ service_charges ∪ 상담내원) → customers(assigned_staff_id)
      const custIds = [...new Set([
        ...rows.map((r) => r.customer_id),
        ...charges.map((c) => c.customer_id),
        ...consults.map((c) => c.customer_id),
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

      return { rows, charges, manuals, consults, custStaffMap, staffNameMap, nameToStaffId };
    },
  });

  // ── 담당실장별 집계 ────────────────────────────────────────────────────────
  // NULL assigned_staff → key='__UNASSIGNED__', name='미지정' (DAILY-SETTLE-STAFF AC-3 일관)
  const stats = useMemo<StaffStat[]>(() => {
    const {
      rows = [], charges = [], manuals = [], consults = [],
      custStaffMap = new Map(), staffNameMap = new Map(), nameToStaffId = new Map(),
    } = data ?? {};
    const map = new Map<string, StaffStat>();

    const ensure = (staffId: string): StaffStat => {
      let stat = map.get(staffId);
      if (!stat) {
        stat = {
          staffId,
          staffName: staffId === UNASSIGNED ? '미지정' : (staffNameMap.get(staffId) ?? '알 수 없음'),
          consultCount: 0,
          nonInsuranceRevenue: 0,
          insuranceCopay: 0,
          insuranceCovered: 0,
          packageRevenue: 0,
          packageCount: 0,
        };
        map.set(staffId, stat);
      }
      return stat;
    };

    // 상담 건 수 (案1) — consultation_done=true 방문을 담당실장(assigned_staff_id) grain으로 카운트.
    //   담당실장≠상담수행자 방문도 assigned_staff_id 위치로 일관 카운트(시나리오2).
    for (const c of consults) {
      const staffId = (c.customer_id ? custStaffMap.get(c.customer_id) : undefined) ?? UNASSIGNED;
      ensure(staffId).consultCount += 1;
    }

    // payments — 급여 본인부담금 / 비급여 (선수금 제외, SSOT §2-1 AC-4)
    for (const p of rows) {
      const staffId = (p.customer_id ? custStaffMap.get(p.customer_id) : undefined) ?? UNASSIGNED;
      const stat = ensure(staffId);
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;

      if (p.tax_type === '급여') {
        stat.insuranceCopay += netAmt;                 // 급여 본인부담금 [수납 권위]
      } else if (p.tax_type === '선수금') {
        // 선수금(패키지 선결제) — 기존 3축(급여/비급여/공단)에서는 제외 유지(회귀 0).
        // T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING: 별도 '패키지' 컬럼으로 집계(ADDITIVE).
        //   판매(결제)시점 기준(accounting_date=판매일). 회차 차감은 payments row 미생성 → 자동 제외.
        stat.packageRevenue += netAmt;
        stat.packageCount += 1;
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
      consults: filtered.reduce((s, x) => s + x.consultCount, 0),
      nonIns: filtered.reduce((s, x) => s + x.nonInsuranceRevenue, 0),
      copay: filtered.reduce((s, x) => s + x.insuranceCopay, 0),
      covered: filtered.reduce((s, x) => s + x.insuranceCovered, 0),
      pkg: filtered.reduce((s, x) => s + x.packageRevenue, 0),
      pkgCount: filtered.reduce((s, x) => s + x.packageCount, 0),
      // ④ 총 매출(섹션-로컬) = 패키지 결제 합산 + 급여 본인부담금 합산 (비급여·공단 제외).
      sectionTotal: filtered.reduce((s, x) => s + x.packageRevenue + x.insuranceCopay, 0),
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
            {['담당실장', '상담 건 수', '비급여 순매출', '진찰료', '공단부담액 (명세)', '패키지 (선수금)', '총 매출'].map((h) => (
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
              <td
                data-testid={`sales-doctor-consultcount-${s.staffId}`}
                className="px-3 py-2 tabular-nums text-center"
              >
                {s.consultCount}
              </td>
              <td
                data-testid={`sales-doctor-nonins-${s.staffId}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right font-semibold',
                  s.nonInsuranceRevenue < 0 && 'text-red-600',
                )}
              >
                {formatAmount(Math.round(s.nonInsuranceRevenue))}원
              </td>
              {/* 진찰료 = 급여 본인부담금(payments tax_type='급여' net). T-20260804 ③ 라벨 '진찰료'. */}
              <td
                data-testid={`sales-doctor-jinchalryo-${s.staffId}`}
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(s.insuranceCopay))}원
              </td>
              <td
                data-testid={`sales-doctor-covered-${s.staffId}`}
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(s.insuranceCovered))}원
              </td>
              {/* T-20260727-foot-SALESDOCTOR-PKG-REVENUE-MISSING: 패키지(선수금) 컬럼 (최우측, ADDITIVE) */}
              <td
                data-testid={`sales-doctor-package-${s.staffId}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right font-semibold',
                  s.packageRevenue < 0 && 'text-red-600',
                )}
              >
                {formatAmount(Math.round(s.packageRevenue))}원
                {s.packageCount > 0 && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    ({s.packageCount}건)
                  </span>
                )}
              </td>
              {/* T-20260804 ④ 총 매출(섹션-로컬) = 패키지 결제 + 급여 본인부담금(진찰료). 비급여·공단 제외. */}
              <td
                data-testid={`sales-doctor-sectiontotal-${s.staffId}`}
                className={cn(
                  'px-3 py-2 tabular-nums text-right font-semibold',
                  (s.packageRevenue + s.insuranceCopay) < 0 && 'text-red-600',
                )}
              >
                {formatAmount(Math.round(s.packageRevenue + s.insuranceCopay))}원
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-3 py-2">합계</td>
            <td
              data-testid="sales-doctor-total-consultcount"
              className="px-3 py-2 tabular-nums text-center"
            >
              {totals.consults}
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
            <td
              data-testid="sales-doctor-total-package"
              className="px-3 py-2 tabular-nums text-right"
            >
              {formatAmount(Math.round(totals.pkg))}원
              {totals.pkgCount > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  ({totals.pkgCount}건)
                </span>
              )}
            </td>
            {/* T-20260804 ④ 총 매출 합계 = 패키지 결제 합산 + 급여 본인부담금 합산 */}
            <td
              data-testid="sales-doctor-total-sectiontotal"
              className="px-3 py-2 tabular-nums text-right font-semibold text-teal-700"
            >
              {formatAmount(Math.round(totals.sectionTotal))}원
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-1.5 text-right text-[10px] leading-relaxed text-muted-foreground">
        * 담당실장: 고객 2번차트 지정 기준 · 공단부담액(명세)은 수가표 기준 추정값(공단 심사 전 — 실제 청구확정액과 다를 수 있음)
        <br />
        * 상담 건 수 = 담당실장이 맡은 고객 중 상담완료(consultation_done) 방문 수 · 진찰료 = 급여 본인부담금만(비급여 진찰료 제외) · <span className="font-medium text-teal-700">총 매출 = 패키지 결제 + 진찰료</span>(이 섹션 전용 합계 — 비급여·공단부담은 포함하지 않음)
        <br />
        * 수기수납(closing_manual)은 결제담당 기준 귀속 · <span className="font-medium text-amber-700">할인 미반영</span>(할인/수기조정 전용 항목 미도입)
      </p>
    </div>
  );
}
