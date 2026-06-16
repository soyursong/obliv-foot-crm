/**
 * 풋센터 서류 출력 빌링 — 4경로(PATH-1/2/3/4) 공유 SSOT
 *
 * T-20260608-foot-DOC-PATH12-SYNC:
 *   결제 미니창(PATH-4, PaymentMiniWindow)의 "수정사항 반영" 빌링 로직을
 *   DocumentPrintPanel(PATH-1/2/3)이 1:1 동일하게 재사용하도록 추출한 공유 모듈.
 *
 * 배경(진단):
 *   - PATH-4 는 화면 라이브 상태(selectedItems + customAmounts 수기조정가)로 서류를 빌드 →
 *     수정사항 반영됨.
 *   - PATH-1/2/3 은 `service_charges`(보험 copay 산출 감사로그) 직결로 빌드 → PMW 수기조정
 *     (= `check_in_services`)이 닿지 않아 "하나도 연동 안 됨".
 *   - PMW 의 in-memory 상태 = `check_in_services` 영속본. 따라서 이 모듈은 `check_in_services`
 *     를 PMW 와 동일한 규칙으로 재계산해, service_charges 가 비어있는 경로의 폴백 소스로 쓴다.
 *
 * 무파괴 원칙: PMW 도 `service_charges`(autobind) 가 있으면 그 값을 보존하고, 비었을 때만
 *   화면값으로 폴백한다(applyBillingFallback = blank/zero 만 채움). 본 모듈도 동일하게
 *   "service_charges 비었을 때만" 쓰여야 한다 — populate 된 경로의 기존 동작은 불변.
 *
 * getTaxClass/isCodeItem/COVERED_GRADES 는 본래 PaymentMiniWindow 로컬 정의였으나, 동일
 * 로직이 두 컴포넌트에 흩어지면 본 티켓 같은 비대칭 드리프트가 재발하므로 여기로 일원화한다.
 */
import { type InsuranceGrade, getBaseCopayRate } from './insurance';
import { supabase } from './supabase';

export type TaxClass = '비급여(과세)' | '비급여(면세)' | '급여';

/* ───────────────────────────────────────────────────────────────────────────
 * T-20260616-foot-PKG-OUTSTANDING-BALANCE — 패키지 미수금(잔금) 산출 단일소스(SSOT)
 *
 * 잔금은 캐시컬럼이 아니라 파생값이다(정합성 우선, data-architect GO 2026-06-16):
 *   패키지 잔금  = packages.total_amount    − Σ signed(package_payments.amount WHERE fee_kind='package')
 *   진료비 잔금  = packages.consultation_fee − Σ signed(package_payments.amount WHERE fee_kind='consultation')
 *   signed: payment_type='refund' → 음수.
 *
 * ★ §4-A 제약: 패키지 금액/진료비 금액(및 각 잔금)을 합산한 단일 "총금액" 표기 절대 금지.
 *   → 이 모듈은 두 잔금을 **각각** 반환하며, 합산 헬퍼를 의도적으로 제공하지 않는다.
 *
 * 성능: 패키지 목록(최대 200행)은 결제행 조인 대신 동기화 캐시 paid_amount 를 net 으로 사용해도 무방
 *   (Packages.tsx 가 결제 변경 시 paid_amount = Σpackage_payments 로 재동기화). 상세/정밀 경로는
 *   결제행에서 netPaidFromPayments() 로 정확히 산출한다.
 * ─────────────────────────────────────────────────────────────────────────── */

export type BalanceStatus = 'paid' | 'due' | 'over';

export interface PackagePaymentRow {
  amount: number;
  payment_type?: string | null;  // 'payment' | 'refund'
  fee_kind?: string | null;      // 'package' | 'consultation'
}

/** 결제행 → 순납부액(Σpayment − Σrefund). feeKind 지정 시 해당 귀속분만 합산(미지정 행은 'package'로 간주). */
export function netPaidFromPayments(
  payments: PackagePaymentRow[] | null | undefined,
  feeKind?: 'package' | 'consultation',
): number {
  if (!payments) return 0;
  return payments.reduce((sum, p) => {
    if (feeKind && (p.fee_kind ?? 'package') !== feeKind) return sum;
    const signed = p.payment_type === 'refund' ? -(p.amount ?? 0) : (p.amount ?? 0);
    return sum + signed;
  }, 0);
}

/** 잔금 = 총액 − 순납부액. 음수면 과수(환불검토). 반올림(정수원 도메인). */
export function computeOutstanding(
  totalAmount: number | null | undefined,
  netPaid: number | null | undefined,
): number {
  return Math.round((totalAmount ?? 0) - (netPaid ?? 0));
}

/** 잔금 상태: >0 미수(due) / <0 과수(over) / 0 완납(paid). */
export function balanceStatus(outstanding: number): BalanceStatus {
  if (outstanding > 0) return 'due';
  if (outstanding < 0) return 'over';
  return 'paid';
}

/** 상태 한국어 라벨(뱃지·배너용). */
export function balanceStatusLabel(status: BalanceStatus): string {
  return status === 'due' ? '미수' : status === 'over' ? '과수' : '완납';
}

/**
 * T-20260610-foot-PKGCLASS-SESSION1-SINGLE — 회수=1 패키지 = 단건 결제 자동 분류.
 *
 * 결제 분류의 1차 키는 **패키지 총 회수(total_sessions)**. 회수≥2 만 패키지(package_payments),
 * 회수≤1(=1회 또는 0회 degenerate)은 단건(payments)으로 분류한다. 금액은 보조 신호일 뿐
 * 분류 키가 아니다(reporter 김주연 총괄, 2026-06-10).
 *
 * 관계 정합:
 *   - RECEIPT-PKG-ALWAYS(305b0ad): "영수증 = 항상 package_payments" 를 **회수=1 케이스에 한해 supersede**.
 *   - TRIAL-REVENUE-ZERO(b5bbf28, isTrialService): 체험권(=1회 즉시결제)을 단건 처리한 선례의 **일반화**.
 *     체험권은 total_sessions=1 이므로 본 규칙으로 동일하게 단건으로 수렴한다(회귀 없음).
 *
 * 경계: "회수≥2 → 패키지" 의 여집합. 따라서 1 이하는 모두 단건(0회 degenerate 패키지도 단건 처리해 안전).
 */
export function isSinglePaymentByCount(totalSessions: number | null | undefined): boolean {
  return (totalSessions ?? 0) <= 1;
}

/**
 * T-20260526-foot-COPAY-MINI-BUG AC-1:
 * 건보 유효 등급(일반/차상위/의료급여/6세미만/65세정액) + hira_code 보유 항목 → 급여 분류.
 */
export const COVERED_GRADES = new Set<InsuranceGrade>([
  'general', 'low_income_1', 'low_income_2',
  'medical_aid_1', 'medical_aid_2', 'infant', 'elderly_flat',
]);

/** getTaxClass / isCodeItem 가 참조하는 service 의 구조적 최소 형태 (Service 와 호환). */
export interface BillingService {
  id: string;
  name: string;
  service_code?: string | null;
  hira_code?: string | null;
  vat_type?: 'none' | 'exclusive' | 'inclusive' | string | null;
  is_insurance_covered?: boolean | null;
  category_label?: string | null;
  price?: number;
}

/**
 * 세금/급여 분류 — PaymentMiniWindow.getTaxClass 와 1:1 동일.
 * 건보 유효 등급 + hira_code → 급여. is_insurance_covered → 급여. vat_type → 과세/면세.
 */
export function getTaxClass(svc: BillingService, insuranceGrade: InsuranceGrade | null = null): TaxClass {
  if (insuranceGrade && COVERED_GRADES.has(insuranceGrade) && svc.hira_code) {
    return '급여';
  }
  if (svc.is_insurance_covered) return '급여';
  if (svc.vat_type === 'exclusive' || svc.vat_type === 'inclusive') return '비급여(과세)';
  return '비급여(면세)';
}

/** 서비스 항목이 "코드 전용"(상병코드·처방약)인지 — PaymentMiniWindow.isCodeItem 와 1:1 동일. */
export function isCodeItem(svc: BillingService): boolean {
  const label = svc.category_label ?? '';
  return label === '상병' || label === '처방약';
}

export interface FootBillingItem {
  service: BillingService;
  qty: number;
  /** 단가 (수기조정 customAmounts 반영분 = check_in_services.price). */
  unitPrice: number;
}

export interface FootBillingResult {
  /** 코드 항목(상병·처방약) 제외한 가격 산정 항목. */
  pricingItems: FootBillingItem[];
  totalByTax: Record<TaxClass, number>;
  coveredTotal: number;
  copaymentTotal: number;
  grandTotal: number;
  nonCoveredTotal: number;
  /** applyBillingFallback 에 그대로 전달하는 라이브 산출값 (PMW 와 동일 정의). */
  liveBillingValues: { insuranceCovered: number; copayment: number; nonCovered: number };
}

/**
 * PMW(PATH-4) 의 totalByTax / coveredTotal / copaymentTotal 산출을 1:1 재현.
 * (PaymentMiniWindow.tsx L1209~1234, L1472~1475 와 동일 규칙.)
 */
export function computeFootBilling(
  items: FootBillingItem[],
  insuranceGrade: InsuranceGrade | null,
): FootBillingResult {
  const pricingItems = items.filter((i) => !isCodeItem(i.service));
  const amountOf = (i: FootBillingItem) => i.unitPrice * i.qty;
  const grandTotal = pricingItems.reduce((s, i) => s + amountOf(i), 0);

  const totalByTax: Record<TaxClass, number> = {
    '비급여(과세)': 0,
    '비급여(면세)': 0,
    급여: 0,
  };
  for (const item of pricingItems) {
    totalByTax[getTaxClass(item.service, insuranceGrade)] += amountOf(item);
  }

  const coveredTotal = totalByTax['급여'];
  const copayRate = insuranceGrade && COVERED_GRADES.has(insuranceGrade)
    ? getBaseCopayRate(insuranceGrade)
    : null;
  // 100원 절상 — copayCalc.ts / PMW 와 동일 규칙
  const copaymentTotal = copayRate !== null && coveredTotal > 0
    ? Math.min(Math.ceil((coveredTotal * copayRate) / 100) * 100, coveredTotal)
    : 0;

  const nonCoveredTotal = (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0);

  return {
    pricingItems,
    totalByTax,
    coveredTotal,
    copaymentTotal,
    grandTotal,
    nonCoveredTotal,
    liveBillingValues: {
      insuranceCovered: Math.max(0, coveredTotal - copaymentTotal),
      copayment: copaymentTotal,
      nonCovered: nonCoveredTotal,
    },
  };
}

/**
 * `check_in_services`(= PMW 영속 시술/수기조정가) 를 로드해 FootBillingItem 으로 환원.
 * PaymentMiniWindow 의 복원 로직(L746~764)과 동일하게 service_id 별 그룹핑·단가 복원.
 *
 * @returns 항목 0건이면 빈 배열 — 호출부는 비었을 때만 폴백으로 사용해야 한다(무파괴).
 */
export async function loadFootBillingItems(
  checkInId: string,
  // clinic 스코프는 check_in_id 가 단일 클리닉에 종속되어 현재 미사용 — 호출부 시그니처 호환 위해 유지.
  _clinicId?: string,
): Promise<FootBillingItem[]> {
  const { data: cis } = await supabase
    .from('check_in_services')
    .select('service_id, price')
    .eq('check_in_id', checkInId);

  const rows = (cis ?? []) as { service_id: string; price: number | null }[];
  if (rows.length === 0) return [];

  const serviceIds = [...new Set(rows.map((r) => r.service_id))];
  const { data: svcData } = await supabase
    .from('services')
    .select('id, name, service_code, hira_code, vat_type, is_insurance_covered, category_label, price')
    .in('id', serviceIds);

  const svcMap = new Map<string, BillingService>(
    ((svcData ?? []) as BillingService[]).map((s) => [s.id, s]),
  );

  // service_id 별 그룹핑 — qty = 행 수, unitPrice = 저장 단가(수기조정 반영분)
  const grouped = new Map<string, FootBillingItem>();
  for (const r of rows) {
    const svc = svcMap.get(r.service_id);
    if (!svc) continue;
    const existing = grouped.get(r.service_id);
    if (existing) {
      existing.qty += 1;
    } else {
      grouped.set(r.service_id, {
        service: svc,
        qty: 1,
        unitPrice: r.price ?? svc.price ?? 0,
      });
    }
  }
  return [...grouped.values()];
}

/**
 * 고객 건보 등급 로드 (customers.insurance_grade) — PMW L697~705 와 동일.
 */
export async function loadCustomerInsuranceGrade(
  customerId: string | null | undefined,
): Promise<InsuranceGrade | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from('customers')
    .select('insurance_grade')
    .eq('id', customerId)
    .maybeSingle();
  return (data?.insurance_grade ?? null) as InsuranceGrade | null;
}

/**
 * bill_detail(진료비세부산정내역) items_html 입력행 빌드 — PMW L1480~1492 와 1:1 동일.
 *
 * T-20260609-foot-DOCFORM-3FIX 이슈1 [버그]: 본인부담금/공단부담금 per-item 컬럼 공란.
 *   computeFootBilling 이 집계 copaymentTotal(본인부담금 총액)은 산출하나, 이 빌더가 per-item
 *   본인/공단 분리값을 누락 → service_charges 폴백 경로(check_in_services)에서 급여 항목의
 *   본인부담금/공단부담금이 '0'으로 비어 출력됨. (= "데이터는 보험계산에 존재·렌더 바인딩 누락" 패턴,
 *   DOC-FIELD-MISSING-3 와 동일.)
 *   → copayInfo 전달 시 집계 copaymentTotal 을 급여 항목별로 비례 배분(최대잔차 보정)해 per-item
 *     copayment_amount 를 채운다. 컬럼 합계가 copaymentTotal 과 정확히 일치하므로 진료비계산서
 *     {{copayment}} 와 정합(AC-2). 급여 분류는 computeFootBilling 과 동일 기준(getTaxClass).
 *   copayInfo 미전달 시 기존 동작 보존(무파괴).
 */
export function buildFootBillDetailItems(
  pricingItems: FootBillingItem[],
  visitDate: string,
  copayInfo?: { insuranceGrade: InsuranceGrade | null; copaymentTotal: number },
): Array<{
  category: string;
  date: string;
  code: string;
  name: string;
  amount: number;
  count: number;
  days: number;
  is_insurance_covered: boolean;
  copayment_amount?: number;
}> {
  const grade = copayInfo?.insuranceGrade ?? null;
  // 급여 분류 — copayInfo 있으면 computeFootBilling 과 동일 기준(getTaxClass), 없으면 기존 동작
  const isCovered = (item: FootBillingItem): boolean =>
    copayInfo
      ? getTaxClass(item.service, grade) === '급여'
      : (item.service.is_insurance_covered ?? false);

  // per-item 본인부담금 배분: 집계 copaymentTotal 을 급여 항목 금액 비례로 나누되,
  // 합계가 copaymentTotal 과 정확히 일치하도록 소수부(잔차)를 큰 순서로 1원씩 보정.
  const perItemCopay = new Map<number, number>();
  if (copayInfo && copayInfo.copaymentTotal > 0) {
    const covered = pricingItems
      .map((it, i) => ({ i, amt: it.unitPrice * it.qty }))
      .filter((x) => isCovered(pricingItems[x.i]) && x.amt > 0);
    const coveredSum = covered.reduce((s, x) => s + x.amt, 0);
    if (coveredSum > 0) {
      let allocated = 0;
      const fracs: Array<{ i: number; frac: number; cap: number }> = [];
      for (const x of covered) {
        const raw = (copayInfo.copaymentTotal * x.amt) / coveredSum;
        const floor = Math.min(Math.floor(raw), x.amt);
        perItemCopay.set(x.i, floor);
        allocated += floor;
        fracs.push({ i: x.i, frac: raw - Math.floor(raw), cap: x.amt - floor });
      }
      let remainder = copayInfo.copaymentTotal - allocated;
      fracs.sort((a, b) => b.frac - a.frac);
      for (const f of fracs) {
        if (remainder <= 0) break;
        const add = Math.min(remainder, f.cap);
        perItemCopay.set(f.i, (perItemCopay.get(f.i) ?? 0) + add);
        remainder -= add;
      }
    }
  }

  return pricingItems.map(({ service, qty, unitPrice }, idx) => {
    const covered = isCovered(pricingItems[idx]);
    return {
      category: covered ? '이학요법료' : '기타',
      date: visitDate,
      code: service.service_code ?? '',
      name: service.name,
      amount: unitPrice,
      count: qty,
      days: 1,
      is_insurance_covered: covered,
      // copayInfo 있을 때만 per-item 본인부담금 주입(없으면 미설정=기존 동작).
      // 급여 항목은 copay 0(예: 의료급여 1종)이라도 0 명시 → 공단부담금=전액 정상 산출.
      copayment_amount: covered && copayInfo ? (perItemCopay.get(idx) ?? 0) : undefined,
    };
  });
}

/**
 * T-20260616-foot-DOCFORM-3FIX-REGRESSION — service_charges 직결 경로(Path A) per-item 본인부담금 보강.
 *
 * 회귀 RC: T-20260609-foot-DOCFORM-3FIX(0cbbdc2)는 `check_in_services` 폴백 경로(Path B,
 *   buildFootBillDetailItems)만 비례배분으로 채웠다. `service_charges` 기록을 보유한 차트는
 *   DocumentPrintPanel 의 Path A(serviceItems 직결)로 빌드되는데, 이 경로는 per-item 배분 없이
 *   `service_charges.copayment_amount`(흔히 null)에만 의존 → 급여 항목 본인/공단 컬럼이 '0'/공란
 *   잔존(=박민석 케이스). 0cbbdc2 의 미커버 경로.
 *
 * 해소: copayInfo 비례배분과 동일 규칙을 service_charges 빌아이템에 적용한다. 단 무파괴 —
 *   covered 항목 중 하나라도 copayment_amount 가 이미 있으면 DB 권위로 보고 미개입한다. 등급이
 *   covered 가 아니면(무보험·copayRate null) 미개입(=본인부담 분리 불가, 데이터 조건). 합계는
 *   진료비계산서 {{copayment}}(copaymentTotal)와 정합. billItems 를 in-place 변형한다.
 */
export function fillBillItemCopayment(
  billItems: Array<{
    amount: number;
    count?: number;
    days?: number;
    is_insurance_covered: boolean;
    copayment_amount?: number;
  }>,
  insuranceGrade: InsuranceGrade | null,
): void {
  const covered = billItems
    .map((it, i) => ({ i, total: it.amount * (it.count ?? 1) * (it.days ?? 1) }))
    .filter((x) => billItems[x.i].is_insurance_covered && x.total > 0);
  if (covered.length === 0) return;

  // 무파괴: covered 항목 중 하나라도 copayment_amount 가 이미 채워져 있으면 DB 권위 → 미개입.
  const anyExisting = covered.some((x) => billItems[x.i].copayment_amount != null);
  if (anyExisting) return;

  const copayRate = insuranceGrade && COVERED_GRADES.has(insuranceGrade)
    ? getBaseCopayRate(insuranceGrade)
    : null;
  // 무보험·비대상 등급: 본인/공단 분리 자체가 성립 안 함(데이터 조건) → 미개입(기존 동작 보존).
  if (copayRate === null) return;

  const coveredSum = covered.reduce((s, x) => s + x.total, 0);
  // 100원 절상 — computeFootBilling / copayCalc / PMW 와 동일 규칙
  const copaymentTotal = Math.min(Math.ceil((coveredSum * copayRate) / 100) * 100, coveredSum);

  if (copaymentTotal <= 0) {
    // 급여 본인부담 0 등급(예: 의료급여 1종): 0 명시 → 공단부담금=급여전액 정상 산출.
    for (const x of covered) billItems[x.i].copayment_amount = 0;
    return;
  }

  // 비례 배분 + 잔차 보정(소수부 큰 순서 1원씩) — buildFootBillDetailItems 와 동일 규칙.
  let allocated = 0;
  const fracs: Array<{ i: number; frac: number; cap: number }> = [];
  for (const x of covered) {
    const raw = (copaymentTotal * x.total) / coveredSum;
    const floor = Math.min(Math.floor(raw), x.total);
    billItems[x.i].copayment_amount = floor;
    allocated += floor;
    fracs.push({ i: x.i, frac: raw - Math.floor(raw), cap: x.total - floor });
  }
  let remainder = copaymentTotal - allocated;
  fracs.sort((a, b) => b.frac - a.frac);
  for (const f of fracs) {
    if (remainder <= 0) break;
    const add = Math.min(remainder, f.cap);
    billItems[f.i].copayment_amount = (billItems[f.i].copayment_amount ?? 0) + add;
    remainder -= add;
  }
}
