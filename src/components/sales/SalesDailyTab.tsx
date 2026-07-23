/**
 * T-20260515-foot-SALES-TAB-DAILY
 * 일일결산 마감 뷰 — 듀얼 매트릭스 (발생기준 + 수납수단별) + 현금 시재 추적
 *
 * AC-1: 좌측 발생기준(세금속성별) / 우측 수납수단×세금속성 교차 매트릭스
 * AC-2: 좌우 합계 대사 — 불일치 시 경고 배너
 * AC-3: 현금 시재 (전일이월 + 당일수납 = 잔액)
 * AC-4: 글로벌 SalesFilterState.dateRange(accounting_date) 사용
 *
 * READ-ONLY — DB 변경 없음. payments + package_payments + service_charges + daily_closings 조회만.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX (Stage A)
 *   이 화면엔 grain이 2개다 (DA CONSULT-REPLY / revenue_insurance_split_spec §0·§2-3).
 *   ① 발생(청구)기준 급여 3값(급여총액·본부금·공단청구액) = 명세 grain = service_charges.
 *      공단부담(insurance_covered_amount)은 payments에 영원히 없음(공단이 기관에 직접 지급).
 *      → 좌측 급여 섹션은 service_charges(WHERE is_insurance_covered=TRUE)에서만 산출.
 *        기간 = 진료(charge)일 = calculated_at 기준(C3). payments.tax_type='급여' predicate 완전 제거(C1).
 *   ② 수납기준 비급여/선수금 = 수납 grain = payments(accounting_date). 공단부담 없음.
 *   좌우 대사(AC-2)는 수납(cash) grain끼리만 유효 → 급여(발생기준) 제외하고 비급여+선수금만 대사.
 *   Stage B(수납수단별 급여 열, C4 payment↔service_charge 링크 확인) = 별도 stage.
 *   ADDITIVE: 신규 컬럼/enum/마이그 0, service_charges는 읽기만(ALTER 금지, C2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * T-20260723-foot-SALESDAILY-INSCOL-READSIDE-RESOURCE (Stage B / C4 read-side)
 *   우측 매트릭스 '급여' 열 소스 re-source = payments.service_charge_id FK →
 *   service_charges.is_insurance_covered=TRUE 조인. (parent a1 write-path deployed 후 착지.)
 *   · 급여 귀속 판정은 오직 FK(is_insurance_covered)로만 — tax_type='급여' 저장/신설 금지
 *     (DA canon ruling: tax_type=VAT축[과세/면세], is_insurance_covered=보험축 → conflation 금지).
 *     copay payment 는 write-path에서 tax_type=NULL(면세) + service_charge_id FK 로 적재됨.
 *   · 좌측 FK skip: 급여 copay payment 는 발생기준(service_charges)으로 이미 집계됨 →
 *     좌측 비급여/선수금 버킷에서 skip(중복계상 방지). (pre-C4: tax_type=NULL → taxfree 로 잘못 유입,
 *     즉 baseTotal[copay 포함] + taxfree[copay payment] = copay 이중계상 status quo 를 C4가 봉합.)
 *   · legacy tax_type='급여' 잔존행 방어: FK 부재 시 tax_type='급여' 도 급여 귀속 인정(현재 0건).
 *   ADDITIVE·no-DDL: FK 컬럼(payments.service_charge_id)은 parent canonical(mig 20260715160000) 재사용.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// 상수 / 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 우측 매트릭스 컬럼 — 세금속성 4종 */
const TAX_COLS = ['과세', '면세', '급여', '선수금'] as const;
type TaxCol = (typeof TAX_COLS)[number];

/** 우측 매트릭스 행 — 결제수단 4종 */
const METHOD_ROWS = ['현금', '카드', '이체', '선수금차감'] as const;
type MethodRow = (typeof METHOD_ROWS)[number];

/** DB method 값 → 한국어 행 매핑 */
const DB_METHOD_TO_ROW: Record<string, MethodRow> = {
  cash: '현금',
  card: '카드',
  transfer: '이체',
  membership: '선수금차감',
};

/**
 * 급여 귀속 판정 (C4 read-side) — service_charge_id FK → is_insurance_covered=TRUE 만.
 *   copay payment 는 write-path에서 tax_type=NULL(면세) + service_charge_id FK 로 적재됨.
 *   legacy tax_type='급여' 잔존행 방어(FK 부재 시에도 급여 인정, 현재 0건).
 *   tax_type(VAT축)을 급여(보험축) 판정에 쓰지 않는다 — conflation 금지(DA canon).
 */
function isGyeoubPayment(p: RawPayment): boolean {
  const fkCovered = !!p.service_charge_id && p.service_charges?.is_insurance_covered === true;
  return fkCovered || p.tax_type === '급여';
}

/** payment → 우측 매트릭스 열 매핑. 급여=FK 기준(위), 그 외 tax_type(VAT축) 기준. 미분류는 면세 보수. */
function paymentToCol(p: RawPayment): TaxCol {
  if (isGyeoubPayment(p)) return '급여';
  if (p.tax_type === '과세_비급여') return '과세';
  if (p.tax_type === '면세_비급여') return '면세';
  if (p.tax_type === '선수금') return '선수금';
  return '면세'; // null or unknown → 면세(비급여)
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 타입
// ─────────────────────────────────────────────────────────────────────────────

interface RawPayment {
  method: string | null;
  tax_type: string | null;
  amount: number;
  payment_type: string | null;
  /** 매출 방어필터용 — T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE */
  customer_id: string | null;
  /**
   * T-20260723-foot-SALESDAILY-INSCOL-READSIDE-RESOURCE (C4): 급여 copay ↔ 명세 링크 FK.
   *   parent canonical(payments.service_charge_id, mig 20260715160000). package_payments엔 없음(항상 미정의).
   */
  service_charge_id?: string | null;
  /** FK 임베드(PostgREST to-one) — service_charges.is_insurance_covered. 급여 귀속 판정 소스. */
  service_charges?: { is_insurance_covered: boolean } | null;
}

interface DailyClosingRow {
  close_date: string;
  actual_cash_total: number;
  status: string;
}

/**
 * T-20260618-foot-MANUALPAY-STATS-REFLECT
 * 일마감 수기 결제내역(closing_manual_payments). 일마감은 이를 amount 직접 합산하나
 * 매출집계는 누락 → 합계 불일치 + '지출' 0 표시. closing_manual_payments는 tax_type/
 * payment_type 컬럼이 없고 amount(integer) 부호로 수입(양수)/지출(음수) 구분.
 * 입력 폼은 현재 양수만 허용하나, 향후/직접 입력된 음수도 부호 그대로 net 반영(ADDITIVE, DDL 불요).
 */
interface RawManual {
  method: string | null;
  amount: number;
}

/**
 * T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX — 발생(청구)기준 급여 명세.
 * service_charges(명세 grain). 공단부담(insurance_covered_amount)은 payments에 없어 여기서만 산출.
 * 불변식: base_amount = copayment_amount + insurance_covered_amount + exempt_amount.
 */
interface RawServiceCharge {
  base_amount: number;
  copayment_amount: number;
  insurance_covered_amount: number;
  exempt_amount: number;
  customer_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 환불은 음수, 일반 결제는 양수 */
function net(p: RawPayment): number {
  return p.payment_type === 'refund' ? -p.amount : p.amount;
}

function fmtPrevDate(from: string): string {
  const d = new Date(from);
  return format(subDays(d, 1), 'yyyy-MM-dd');
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  filter: SalesFilterState;
}

export function SalesDailyTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const prevDate = fmtPrevDate(from);

  // ── 단건 결제 (accounting_date 기준) ───────────────────────────────────────
  const { data: payments = [], isLoading: payLoading } = useQuery<RawPayment[]>({
    queryKey: ['sales-daily-payments', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        // C4: service_charge_id FK + 임베드 조인(is_insurance_covered)로 급여 귀속 re-source.
        .select('method, tax_type, amount, payment_type, customer_id, service_charge_id, service_charges(is_insurance_covered)')
        .eq('clinic_id', clinic!.id)
        .neq('status', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      // C4: PostgREST to-one 임베드는 런타임에 object(또는 일부 버전 array) → 단일 object 로 정규화.
      const rows = (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        service_charges: Array.isArray(r.service_charges)
          ? (r.service_charges[0] ?? null)
          : (r.service_charges ?? null),
      })) as unknown as RawPayment[];
      // 방어필터: is_simulation=true 고객 결제 제외 (워크인 NULL 보존)
      const simIds = await getSimulationCustomerIds(clinic!.id);
      return excludeSimulationPaymentRows(rows, simIds);
    },
  });

  // ── 패키지 결제 (accounting_date 기준) ─────────────────────────────────────
  const { data: pkgPayments = [], isLoading: pkgLoading } = useQuery<RawPayment[]>({
    queryKey: ['sales-daily-pkg-payments', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_payments')
        .select('method, tax_type, amount, payment_type, customer_id')
        .eq('clinic_id', clinic!.id)
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      // 방어필터: is_simulation=true 고객 결제 제외 (워크인 NULL 보존)
      const simIds = await getSimulationCustomerIds(clinic!.id);
      return excludeSimulationPaymentRows((data ?? []) as RawPayment[], simIds);
    },
  });

  // ── 발생(청구)기준 급여 명세 (service_charges, calculated_at=진료일 기준) ────
  //   T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX (C1·C3):
  //   급여총액·본부금·공단청구액의 권위 grain = 명세(service_charges). WHERE is_insurance_covered=TRUE.
  //   공단부담(insurance_covered_amount)은 payments에 없음 → calc_copayment가 차지 생성 시 즉시 적재
  //   (EDI/insurance_claims 무관 항상 값 존재). SalesDoctorTab와 동일 canonical(§0, cross-CRM 일치).
  const { data: serviceCharges = [], isLoading: scLoading } = useQuery<RawServiceCharge[]>({
    queryKey: ['sales-daily-service-charges', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_charges')
        .select('base_amount, copayment_amount, insurance_covered_amount, exempt_amount, customer_id')
        .eq('clinic_id', clinic!.id)
        .eq('is_insurance_covered', true)
        .gte('calculated_at', from)
        .lte('calculated_at', `${to}T23:59:59.999`);
      if (error) throw error;
      // 방어필터: is_simulation=true 고객 명세 제외 (워크인 NULL 보존) — payments와 동일 sim 집합.
      const simIds = await getSimulationCustomerIds(clinic!.id);
      return excludeSimulationPaymentRows((data ?? []) as RawServiceCharge[], simIds);
    },
  });

  // ── 수기 결제내역 (close_date 기준) ────────────────────────────────────────
  //   일마감 결제내역 탭에서 수기 추가/수정한 항목. 일마감과 동일하게 amount 부호 그대로 net 합산.
  const { data: manualEntries = [], isLoading: manualLoading } = useQuery<RawManual[]>({
    queryKey: ['sales-daily-manual', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      // T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE: soft-void 무효행 제외(합산경로 (b) 비급여버킷).
      //   revenue_insurance_split §2-1 산식 소스 — 수기수납은 tax_type 없어 비급여(면세)로 집계됨.
      //   voided_at IS NULL 유효행만 → left.taxfree/우측매트릭스/현금시재 전부 무효행 배제. 전건 NULL → net-zero.
      const { data, error } = await supabase
        .from('closing_manual_payments')
        .select('method, amount')
        .eq('clinic_id', clinic!.id)
        .gte('close_date', from)
        .lte('close_date', to)
        .is('voided_at', null);
      if (error) throw error;
      return (data ?? []) as RawManual[];
    },
  });

  // ── 전일 마감 레코드 (현금 시재 이월용) ───────────────────────────────────
  const { data: prevClosing } = useQuery<DailyClosingRow | null>({
    queryKey: ['sales-daily-prev-closing', clinic?.id, prevDate],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_closings')
        .select('close_date, actual_cash_total, status')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', prevDate)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as DailyClosingRow | null) ?? null;
    },
  });

  const isLoading = payLoading || pkgLoading || scLoading || manualLoading;
  const allPayments = useMemo<RawPayment[]>(() => [...payments, ...pkgPayments], [payments, pkgPayments]);

  // ── 좌측 매트릭스: 발생 기준 집계 ──────────────────────────────────────────
  //   급여(급여총액·본부금·공단청구액) = 발생(청구)기준 · service_charges(명세) grain (C1)
  //   비급여(과세+면세)·선수금 = 수납기준 · payments(accounting_date) grain
  //   T-20260715 FIX: payments.tax_type='급여' predicate 제거. 급여 3값은 service_charges에서만 산출.
  const left = useMemo(() => {
    // (발생기준) 급여 3값 — 명세 grain. is_insurance_covered=TRUE 명세만 조회됨.
    //   불변식: base_amount = copayment_amount + insurance_covered_amount + exempt_amount.
    let baseTotal = 0;  // 급여총액 = SUM(base_amount)
    let copay = 0;      // 본부금(본인부담) = SUM(copayment_amount)
    let claim = 0;      // 공단청구액 = SUM(insurance_covered_amount)
    let exempt = 0;     // 면제분 = SUM(exempt_amount)
    for (const sc of serviceCharges) {
      baseTotal += sc.base_amount;
      copay += sc.copayment_amount;
      claim += sc.insurance_covered_amount;
      exempt += sc.exempt_amount;
    }

    // (수납기준) 비급여/선수금 — payments grain. tax_type='급여'는 여기서 집계하지 않음(발생기준으로 이관).
    let taxable = 0;  // 비급여 과세
    let taxfree = 0;  // 비급여 면세
    let prepaid = 0;  // 선수금차감
    for (const p of allPayments) {
      const n = net(p);
      const tt = p.tax_type ?? '';
      if (isGyeoubPayment(p)) {
        // C4 좌측 FK skip: 급여 copay(본인부담)는 발생기준(service_charges)으로 이미 집계됨 →
        //   좌측 비급여/선수금 버킷에서 skip(이중계상 방지). 귀속 판정 = service_charge_id FK
        //   (is_insurance_covered) 우선 + legacy tax_type='급여' 방어. 수납수단별 급여 열은 우측(C4)이 표시.
        continue;
      } else if (tt === '과세_비급여') {
        taxable += n;
      } else if (tt === '면세_비급여') {
        taxfree += n;
      } else if (tt === '선수금') {
        prepaid += n;
      } else {
        // null or 미분류 → 면세 비급여 보수 처리
        taxfree += n;
      }
    }

    // T-20260618-foot-MANUALPAY-STATS-REFLECT: 수기결제는 tax_type 없음 → 면세(비급여) 보수 분류.
    //   amount 부호 그대로 합산(양수=수입, 음수=지출). 일마감 합산과 동일하게 net 반영.
    for (const m of manualEntries) {
      taxfree += m.amount;
    }

    // 총진료비(발생기준) = 급여총액(명세 base) + 비급여(과세+면세) + 선수금.
    const total = baseTotal + taxable + taxfree + prepaid;
    // 수납(cash) grain 소계 — 좌우 대사(AC-2) 대상. 급여(발생기준)는 대사 제외.
    const cashTotal = taxable + taxfree + prepaid;
    return { baseTotal, copay, claim, exempt, taxable, taxfree, prepaid, discount: 0, total, cashTotal };
  }, [serviceCharges, allPayments, manualEntries]);

  // ── 우측 매트릭스: 수납수단 × 세금속성 교차 ────────────────────────────────
  type Matrix = Record<MethodRow, Record<TaxCol, number>>;

  const rightMatrix = useMemo<Matrix>(() => {
    const m: Matrix = {
      '현금': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '카드': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '이체': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '선수금차감': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
    };
    for (const p of allPayments) {
      const row = DB_METHOD_TO_ROW[p.method ?? ''];
      const col = paymentToCol(p); // C4: 급여 열 = service_charge_id FK 기준(tax_type 아님)
      if (row) m[row][col] += net(p);
    }
    // T-20260618-foot-MANUALPAY-STATS-REFLECT: 수기결제 method → 행 매핑, tax_type 없음 → 면세 열.
    for (const me of manualEntries) {
      const row = DB_METHOD_TO_ROW[me.method ?? ''];
      if (row) m[row]['면세'] += me.amount;
    }
    return m;
  }, [allPayments, manualEntries]);

  const rightRowTotals = useMemo<Record<MethodRow, number>>(() => {
    const t = {} as Record<MethodRow, number>;
    for (const row of METHOD_ROWS) {
      t[row] = TAX_COLS.reduce((s, col) => s + rightMatrix[row][col], 0);
    }
    return t;
  }, [rightMatrix]);

  const rightColTotals = useMemo<Record<TaxCol, number>>(() => {
    const t = {} as Record<TaxCol, number>;
    for (const col of TAX_COLS) {
      t[col] = METHOD_ROWS.reduce((s, row) => s + rightMatrix[row][col], 0);
    }
    return t;
  }, [rightMatrix]);

  const totalRight = TAX_COLS.reduce((s, col) => s + rightColTotals[col], 0);

  // AC-2: 좌우 대사 — 수납(cash) grain끼리만 유효. 급여(발생기준·명세 grain)는 대사 제외.
  //   T-20260715 FIX: 좌측 급여가 service_charges(발생기준)로 이관되어 payments(수납)와 grain이 다름.
  //   → 대사는 비급여+선수금(좌측 cashTotal) vs 우측 급여 열 제외 소계로 apples-to-apples.
  //   C4: 우측 급여 열 = FK(service_charge_id→is_insurance_covered) 기준 copay 수납분. 좌측도 동일
  //   copay payment 를 skip(FK skip) → 양변 모두 급여 copay 제외 → 대사 grain 정합 유지.
  const rightCashTotal = totalRight - rightColTotals['급여'];
  const hasAnyRow = allPayments.length > 0 || serviceCharges.length > 0 || manualEntries.length > 0;
  const mismatch = hasAnyRow && Math.abs(left.cashTotal - rightCashTotal) >= 1;

  // ── AC-3: 현금 시재 ────────────────────────────────────────────────────────
  const cashCarryover = prevClosing?.actual_cash_total ?? 0;
  // T-20260618-foot-MANUALPAY-STATS-REFLECT:
  //   당일 현금수납 = 단건/패키지 현금 net + 수기 현금 수입(양수).
  //   지출 = 수기 현금 출금(음수 amount의 절댓값 합). 부호로 구분(DDL 불요).
  //   잔액 = 이월금 + 현금수납 − 지출.  ⇒ 현금수납−지출 = 우측 매트릭스 '현금' 행 합과 정합.
  const cashIn = useMemo(() => {
    const paymentCash = allPayments.filter(p => p.method === 'cash').reduce((s, p) => s + net(p), 0);
    const manualCashIn = manualEntries
      .filter(m => m.method === 'cash' && m.amount > 0)
      .reduce((s, m) => s + m.amount, 0);
    return paymentCash + manualCashIn;
  }, [allPayments, manualEntries]);
  const cashExpense = useMemo(
    () => manualEntries
      .filter(m => m.method === 'cash' && m.amount < 0)
      .reduce((s, m) => s + Math.abs(m.amount), 0),
    [manualEntries],
  );
  const cashBalance = cashCarryover + cashIn - cashExpense;

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        데이터 로딩 중…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="sales-daily-tab">
      {/* AC-2: 대사 불일치 경고 */}
      {mismatch && (
        <div
          data-testid="sales-daily-mismatch-warning"
          className="flex items-start gap-2.5 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <span>
            <strong>수납 대사 불일치 감지</strong> — 비급여·선수금(수납기준){' '}
            <strong>{formatAmount(left.cashTotal)}원</strong>과 실수납 합계(급여 제외){' '}
            <strong>{formatAmount(rightCashTotal)}원</strong>이 다릅니다.
            차이: <strong>{formatAmount(Math.abs(left.cashTotal - rightCashTotal))}원</strong>.
            결제 데이터를 확인해 주세요. (급여는 발생기준·명세 집계로 대사 대상 아님)
          </span>
        </div>
      )}

      {/* ── 듀얼 매트릭스 ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

        {/* 좌측: 발생 기준 집계 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">발생 기준 집계</CardTitle>
            <p className="text-xs text-muted-foreground">
              급여=발생(청구)기준·명세 (진료일) / 비급여·선수금=수납기준 (accounting_date)
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              data-testid="sales-daily-left-matrix"
            >
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-20">구분</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">항목</th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-28">금액</th>
                </tr>
              </thead>
              <tbody>
                {/* 급여 — 발생(청구)기준·명세(service_charges) grain. 불변식: 급여총액=본부금+공단청구액+면제 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 align-middle text-xs font-medium border-r bg-blue-50/50" rowSpan={3}>
                    급여
                    <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">발생(청구)기준</div>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">급여총액</td>
                  <td
                    className="py-2 px-3 text-right tabular-nums font-medium"
                    data-testid="sales-daily-ins-base"
                  >
                    {formatAmount(left.baseTotal)}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">본부금(본인부담)</td>
                  <td
                    className="py-2 px-3 text-right tabular-nums"
                    data-testid="sales-daily-ins-copay"
                  >
                    {formatAmount(left.copay)}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">공단청구액</td>
                  <td
                    className="py-2 px-3 text-right tabular-nums"
                    data-testid="sales-daily-ins-claim"
                  >
                    {formatAmount(left.claim)}
                  </td>
                </tr>

                {/* 비급여 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 align-middle text-xs font-medium border-r bg-emerald-50/50" rowSpan={2}>
                    비급여
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">과세</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.taxable)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">면세</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.taxfree)}</td>
                </tr>

                {/* 선수금 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs font-medium border-r bg-purple-50/50">선수금</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">선수금차감</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.prepaid)}</td>
                </tr>

                {/* 할인 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs font-medium border-r bg-muted/30">할인</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">할인금액</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                    {left.discount > 0 ? `−${formatAmount(left.discount)}` : '—'}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td
                    colSpan={2}
                    className="py-3 px-3 font-semibold text-sm"
                  >
                    총진료비
                  </td>
                  <td
                    className={cn(
                      'py-3 px-3 text-right tabular-nums font-semibold text-base',
                      mismatch ? 'text-orange-700' : 'text-emerald-700',
                    )}
                    data-testid="sales-daily-left-total"
                  >
                    {formatAmount(left.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {/* 우측: 수납수단 × 세금속성 교차 매트릭스 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">수납 수단별 집계</CardTitle>
            <p className="text-xs text-muted-foreground">결제수단 × 세금속성 교차 매트릭스</p>
          </CardHeader>
          <CardContent className="overflow-auto p-0">
            <table
              className="w-full min-w-[340px] text-sm"
              data-testid="sales-daily-right-matrix"
            >
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-24">수단</th>
                  {TAX_COLS.map(col => (
                    <th key={col} className="py-2 px-2 text-right text-xs font-medium text-muted-foreground">
                      {col}
                    </th>
                  ))}
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">소계</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ROWS.map(row => (
                  <tr key={row} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3 text-xs font-medium">{row}</td>
                    {TAX_COLS.map(col => (
                      <td key={col} className="py-2 px-2 text-right tabular-nums text-xs">
                        {rightMatrix[row][col] !== 0
                          ? formatAmount(rightMatrix[row][col])
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {formatAmount(rightRowTotals[row])}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="py-3 px-3 font-semibold text-sm">합계</td>
                  {TAX_COLS.map(col => (
                    <td
                      key={col}
                      className="py-3 px-2 text-right tabular-nums text-xs font-medium"
                      data-testid={`sales-daily-right-coltotal-${col}`}
                    >
                      {rightColTotals[col] !== 0
                        ? formatAmount(rightColTotals[col])
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                  <td
                    className={cn(
                      'py-3 px-3 text-right tabular-nums font-semibold text-base',
                      mismatch ? 'text-orange-700' : 'text-emerald-700',
                    )}
                    data-testid="sales-daily-right-total"
                  >
                    {formatAmount(totalRight)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* AC-3: 현금 시재 추적표 */}
      <Card data-testid="sales-daily-cash-tracker">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">현금 시재 추적</CardTitle>
          <p className="text-xs text-muted-foreground">
            전일 이월금 + 당일 현금수납 = 잔액
            {prevClosing
              ? prevClosing.status === 'closed'
                ? ` (${prevDate} 마감 확정)`
                : ` (${prevDate} 임시저장)`
              : ' (전일 마감 레코드 없음 — 이월금 0 처리)'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* 전일 이월금 */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">전일 이월금</div>
              <div className="tabular-nums text-sm font-semibold">{formatAmount(cashCarryover)}</div>
              {prevClosing && prevClosing.status !== 'closed' && (
                <div className="mt-0.5 text-[10px] font-medium text-amber-600">미확정</div>
              )}
            </div>

            {/* 당일 현금수납 */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">당일 현금수납</div>
              <div
                data-testid="sales-daily-cash-in"
                className="tabular-nums text-sm font-semibold text-emerald-700"
              >
                + {formatAmount(cashIn)}
              </div>
            </div>

            {/* 지출 (현금 출금) — 수기결제 음수 amount */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">지출</div>
              <div
                data-testid="sales-daily-cash-expense"
                className={cn(
                  'tabular-nums text-sm font-semibold',
                  cashExpense > 0 ? 'text-rose-700' : 'text-muted-foreground',
                )}
              >
                {cashExpense > 0 ? `− ${formatAmount(cashExpense)}` : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">일마감 수기 처리</div>
            </div>

            {/* 잔액 */}
            <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-center">
              <div className="mb-1 text-xs font-medium text-teal-700">남은 현금 (추정)</div>
              <div
                data-testid="sales-daily-cash-balance"
                className="tabular-nums text-sm font-bold text-teal-700"
              >
                {formatAmount(cashBalance)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 빈 상태 */}
      {!hasAnyRow && (
        <div
          data-testid="sales-daily-empty"
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 py-12 text-center"
        >
          <span className="text-sm font-medium text-muted-foreground">결제 내역이 없습니다</span>
          <span className="text-xs text-muted-foreground">
            {from === to ? from : `${from} ~ ${to}`}
          </span>
        </div>
      )}
    </div>
  );
}
