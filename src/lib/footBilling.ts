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
import { type InsuranceGrade, getBaseCopayRate, copayFromBase } from './insurance';
import { supabase } from './supabase';
import { formatAmount, parseAmount } from './format';

// [CI-UNBLOCK] getBaseCopayRate 재수출(facade). footBilling 은 급여 본인부담 산정의 SSOT 파사드라
//   copay 기본률 조회를 이 모듈 표면에서 함께 노출한다. T-20260715-FOOTBILLING-COPAY-CEIL-SWEEP-VERIFY
//   /T-20260526-COPAY-MINI-BUG spec 이 '../lib/footBilling' 에서 import(원 소스=insurance.ts) →
//   미재수출로 Playwright 전체 collection 이 module-load SyntaxError 로 abort 되던 것 복구.
//   순수 re-export(런타임/behavior 무변) — insurance.ts 가 유일 정의 소스.
export { getBaseCopayRate } from './insurance';

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

/**
 * T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-FIX — 패키지 net-paid 산출 SSOT 중앙화(R1).
 *
 * 배경(DIAG): 파생 미수(pkg_due)를 `package_payments` 만으로 산출하면, package_payments 를
 *   **의도적으로** 만들지 않는 두 정당 경로의 결제가 반영되지 않아 **phantom 미수**가 뜬다:
 *     (a) 회수1 단건(PKGCLASS-SESSION1-SINGLE, 매출 이중계상 방지): 영수증/추가결제가 payments 로만
 *         기록되고 packages.paid_amount 에 직접 가산된다(package_payments 미생성).
 *     (b) 양도 승계(PACKAGE-TRIPLE-DEFECT): 승계행을 만들지 않고 승계액을 paid_amount 에만 반영.
 *   두 경우 모두 결제행(package_payments)이 비어 있고 net-paid 의 유일 소스는 paid_amount 다.
 *
 * 규칙: **결제행이 비어 있으면서**((a)단건 또는 (b)양도) → paid_amount 를 net-paid 로 사용,
 *   그 외 전부 → 기존대로 netPaidFromPayments(rows, 'package'). 결제행이 존재하면(회수≥2 분할결제
 *   진행중 등) 항상 결제행이 권위 소스이므로 폴백 미개입 → 회귀 0(기존 8콜러 정상 미수 표시 불변).
 *
 * ⚠ 매출 split 무관: 본 헬퍼는 **미수(pkg_due) 파생에만** 관여한다. 매출 source/insurance split
 *   경로(payments·service_charges)는 미접촉이므로 single≠package revenue 규칙 불변(AC3).
 * ⚠ archive 무개입: status 필터는 콜러 책임(loadCustomerOutstanding 은 status='active' 한정).
 *   본 헬퍼는 net-paid 값만 계산할 뿐 어떤 패키지를 포함할지는 결정하지 않는다 → archive 패키지의
 *   paid_amount 를 미수/매출에 재유입시키지 않는다(F-4857 38cfc0d4 검증).
 */
export function effectiveNetPaid(
  pkg: {
    total_sessions?: number | null;
    paid_amount?: number | null;
    transferred_from?: string | null;
  },
  rows: PackagePaymentRow[] | null | undefined,
): number {
  const rowsEmpty = (rows?.length ?? 0) === 0;
  if (rowsEmpty && (isSinglePaymentByCount(pkg.total_sessions) || pkg.transferred_from)) {
    return pkg.paid_amount ?? 0;
  }
  return netPaidFromPayments(rows, 'package');
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

/* ───────────────────────────────────────────────────────────────────────────
 * T-20260616-foot-PKG-OUTSTANDING-BALANCE ②③④ — 고객별 패키지 미수금 배치 조회.
 *
 * 대기열·예약 '잔금 O원' 뱃지(②)/체크인 미납 팝업(③)/결제 잔금 프리필(④)의 공유 소스.
 * 활성 패키지의 패키지 잔금(fee_kind='package')만 합산한다(§4-A: 진료비 합산 금지 —
 * 진료비 잔금은 별도 표기/별도 결제). per-package outstanding>0 분만 합산(과수는 미반영).
 * 결제행 직접 산출(netPaidFromPayments)로 fee_kind 분리 정확. 리스트 N은 작아 1+1 쿼리로 충분.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface CustomerOutstanding {
  /** 패키지 잔금 합(fee_kind='package', per-package due>0만 합산). */
  packageDue: number;
  /** 진료비 잔금 합(fee_kind='consultation', per-package due>0만 합산). §4-A: 패키지 잔금과 별도. */
  consultationDue: number;
  /** 잔금>0인 활성 패키지 1건(프리필 대상). 여러 건이면 가장 최근 due 패키지. */
  duePackageId: string | null;
}

/**
 * T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 미수(빨강) 배지 노출 조건 predicate.
 * 산출은 loadCustomerOutstanding 결과(SSOT) 재사용 — 신규 산출 로직 없음.
 * 패키지 잔금 또는 진료비 잔금 중 하나라도 0보다 크면 미수(true).
 */
export function hasOutstandingDue(data?: CustomerOutstanding | null): boolean {
  if (!data) return false;
  return (data.packageDue ?? 0) > 0 || (data.consultationDue ?? 0) > 0;
}

/** 고객 id 목록 → 고객별 패키지/진료비 미수금 Map. clinic 스코프 한정. */
export async function loadCustomerOutstanding(
  customerIds: string[],
  clinicId: string,
): Promise<Map<string, CustomerOutstanding>> {
  const result = new Map<string, CustomerOutstanding>();
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0 || !clinicId) return result;

  const { data: pkgs } = await supabase
    .from('packages')
    // T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-FIX: total_sessions·paid_amount·transferred_from
    //   동반 조회 → effectiveNetPaid 회수1/양도 폴백. status='active' 필터 유지(archive 무재유입).
    .select('id, customer_id, total_amount, consultation_fee, created_at, total_sessions, paid_amount, transferred_from')
    .eq('clinic_id', clinicId)
    .eq('status', 'active')
    .in('customer_id', ids);
  const pkgRows = (pkgs ?? []) as Array<{
    id: string; customer_id: string; total_amount: number | null;
    consultation_fee: number | null; created_at: string;
    total_sessions: number | null; paid_amount: number | null; transferred_from: string | null;
  }>;
  if (pkgRows.length === 0) return result;

  const pkgIds = pkgRows.map((p) => p.id);
  const { data: pays } = await supabase
    .from('package_payments')
    .select('package_id, amount, payment_type, fee_kind')
    .in('package_id', pkgIds);
  const payByPkg = new Map<string, PackagePaymentRow[]>();
  for (const pay of (pays ?? []) as Array<PackagePaymentRow & { package_id: string }>) {
    const arr = payByPkg.get(pay.package_id) ?? [];
    arr.push(pay);
    payByPkg.set(pay.package_id, arr);
  }

  // created_at 최신 우선 — duePackageId 가 가장 최근 due 패키지를 가리키도록.
  const sorted = [...pkgRows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  for (const pkg of sorted) {
    const rows = payByPkg.get(pkg.id);
    // 패키지 잔금: effectiveNetPaid(회수1/양도 = paid_amount 폴백, 그 외 = 결제행) — phantom 미수 치유.
    const pkgDue = computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, rows));
    // 진료비 잔금: consultation_fee 는 단건 폴백과 무관(별도 축) → 결제행 그대로(§4-A).
    const consultDue = computeOutstanding(pkg.consultation_fee ?? 0, netPaidFromPayments(rows, 'consultation'));
    const prev = result.get(pkg.customer_id) ?? { packageDue: 0, consultationDue: 0, duePackageId: null };
    if (pkgDue > 0) prev.packageDue += pkgDue;
    if (consultDue > 0) prev.consultationDue += consultDue;
    if ((pkgDue > 0 || consultDue > 0) && prev.duePackageId === null) prev.duePackageId = pkg.id;
    result.set(pkg.customer_id, prev);
  }
  return result;
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
  /**
   * HIRA 항목분류 enum(services.hira_category, insurance.ts HiraCategory) — 권위 소스이나
   * 현재 라이브 미적재(전 항목 null, T-20260707-BILLDETAIL-CATEGORY diagnose 확인).
   * 미래 적재 시 우선 사용하도록 optional 로 보유. 미적재 시 category_label 로 폴백.
   */
  hira_category?: string | null;
  /**
   * HIRA 소정점수(services.hira_score) — 급여 수가 = ROUND(hira_score × clinics.hira_unit_value).
   * T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE: 급여항목 copay base 는 이 점수 파생이 권위
   *   (§2-2-1, DA da_decision_foot_hira_copay_base_grain_reconcile_20260723). services.price 를
   *   급여 base 로 쓰던 것은 §2-2-1 위반(잠복 버그) — price 는 비급여 base 전용.
   */
  hira_score?: number | null;
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
  // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (REOPEN/RC): 등급 미상(copayRate=null) 급여 방문의
  //   본인부담 폴백 정책을 호출 컨텍스트별로 분리. 기본값 'covered_full' = 기존 DOCPRINT-RECUR 그대로
  //   (서류출력 경로 회귀 0). 수납잔액(payments grain)만 'general_default' 를 지정한다(§아래 주석).
  // T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE (C안): 급여항목 copay base 이원화 해소.
  //   opts.hiraUnitValue 전달 시 급여(getTaxClass='급여')×hira_score 존재 항목의 base 를 서버
  //   calc_copayment 와 동일하게 ROUND(hira_score × hira_unit_value) 로 산출(services.price 사용 중단).
  //   미전달(undefined/null) 시 = 기존 price base 그대로(전 호출부 회귀 0 · backward-compat).
  opts?: { unknownGradeCopay?: 'covered_full' | 'general_default'; hiraUnitValue?: number | null },
): FootBillingResult {
  const pricingItems = items.filter((i) => !isCodeItem(i.service));
  // ── 급여 base 권위 소스 (DA da_decision_…_20260723 Q1): ROUND(hira_score × hira_unit_value).
  //   적용 대상 = 급여(getTaxClass='급여') AND hira_score 존재 AND hira_unit_value(clinics, §2-2-0) 전달.
  //   그 외(비급여 / hira_score NULL / hira_unit_value 미전달) = 기존 unitPrice(price) base 유지.
  //   하드코딩·연도 상수 금지 — hira_unit_value 는 호출부(clinics)에서 취득해 주입한다.
  const hiraUnitValue = opts?.hiraUnitValue ?? null;
  const coveredBaseUnit = (svc: BillingService): number | null => {
    if (
      hiraUnitValue != null &&
      svc.hira_score != null &&
      getTaxClass(svc, insuranceGrade) === '급여'
    ) {
      return Math.round(svc.hira_score * hiraUnitValue);
    }
    return null; // price base 유지
  };
  const amountOf = (i: FootBillingItem) => (coveredBaseUnit(i.service) ?? i.unitPrice) * i.qty;
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
  // ★ 등급→copay = copayFromBase 단일 SSOT 헬퍼(copayCalc.ts, RPC calc_copayment v1.6 미러) 소비.
  //   병렬 재계산 경로 신설 금지(DA §제약1: SSOT 단일소비). 정액(의급 1·2종·차상위2)/면제(차상위1)/
  //   정률(general·infant)/노인 4구간 분기가 이 경로(수납·서류 grain)에도 동일 적용된다.
  //   ▷ RC(T-20260720-foot-COPAY-GRADE-BRANCH-MISSING): 종전 이 계산기는 rate×base(round100)만 적용해
  //     정액/면제 등급 분기가 누락 → 차상위·의급 환자 본인부담이 RPC 와 divergence. copayFromBase 로 통일.
  //   정률경로/노인 정률구간 = 100원 미만 절사(FLOOR). CIT-2026-001/002 + revenue_insurance_split §2-2 v1.12.
  //   종전 CEIL(절상)=초과징수 → FLOOR 정정 유지(CEIL 복귀 금지, T-20260715).
  //   footBilling 은 집계 grain(per-service override 없음) → copayFromBase hasOverride=false.
  //
  // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR (총괄 확정 스펙, slack ts 1783974675.205029):
  //   건보 조회 실패 / insurance_grade=null / coverage_rate(=copayRate) null 방문의 **서류 렌더** →
  //   본인부담금 = 급여 진료비 전액, 공단부담금 = 0 (빈칸/공란 절대 금지). = 'covered_full'(기본).
  //
  // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (REOPEN RC):
  //   위 '본인=전액' 폴백을 **수납잔액**(payments grain)에 그대로 재사용하면, 등급 미상 급여 방문에서
  //   공단(NHIS) 몫까지 환자 수납액에 포함되어 3배가량 과다청구된다(현장 P0, 자부담 8,900 기대 vs 공단포함
  //   표시). 라이브 고객 89%(301/338)가 insurance_grade=null 이므로 사실상 모든 급여 방문이 영향. 수납 경로는
  //   'general_default' 로 외래 급여 기본률 general(30%, getBaseCopayRate)을 적용해 본인부담을 산정한다.
  //   (grade='general'/유효등급은 copayRate≠null 로 기존 100원 절상 그대로 — 회귀 0. 유효등급과 미상등급이
  //    동일 general 30% 로 수렴 → 신규출력/현장 기대값 일치.) ⚠ 표시·payments 산출값만 폴백 분기.
  //    DB insurance_grade/service_charges 무접촉(AC-4). 서류출력 copaymentTotal 은 default('covered_full') 유지.
  //
  //   ★ DA CONSULT-REPLY(MSG-20260714-121317-pq2t) §구현제약3 divergence 명시 & ratification 요청:
  //     DA 는 SSOT §2-2-1 기준 "grade=null general → 전액본인부담(공단=0)" 을 상기했으나, 그것은 **명세
  //     (service_charges/calc_copayment) grain** 규칙이다. 이 default('covered_full') 로 명세 grain 은 그대로
  //     보존한다. 그러나 그 규칙을 **수납 grain** 에 적용하면 등급 미상 급여환자에게 전액(=공단 포함) 청구 →
  //     현장 P0(총괄 요구 자부담 8,900)와 정면 배치. 수납 grain 은 임상 관행상 미검증 환자를 general 30% 로
  //     기본 청구(등급 확정 후 정정)하는 것이 정합 → 'general_default' 채택. 두 grain 분리 = 본 티켓의 본질.
  //     (planner FOLLOWUP 로 DA/총괄 ratification 요청함 — 정책 확정 시 이 분기 조정 가능.)
  const copaymentTotal = coveredTotal > 0
    ? (copayRate !== null
        ? copayFromBase(insuranceGrade!, coveredTotal, copayRate, false)
        : (opts?.unknownGradeCopay === 'general_default'
            ? copayFromBase('general', coveredTotal, getBaseCopayRate('general'), false) // 수납: 등급 미상 → 외래 기본 30%
            : coveredTotal))                                       // 서류(기본): 본인 전액(공단=0) 폴백(DOCPRINT-RECUR)
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
    .select('id, name, service_code, hira_code, hira_category, hira_score, vat_type, is_insurance_covered, category_label, price')
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
 * T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE — clinics.hira_unit_value(환산지수, 원) 로드.
 *
 * 급여항목 base = ROUND(hira_score × hira_unit_value) 산출에 주입하는 점당단가.
 *   §2-2-0(stale-drift 안티패턴 금지): 환산지수는 매년 고시(2025=94.1 → 2026=95.60)되므로
 *   코드 하드코딩·연도 상수 박기 금지 → clinics 에서만 취득한다. NULL(미세팅)이면 급여 base 는
 *   기존 price 로 폴백(computeFootBilling 이 hiraUnitValue=null → coveredBaseUnit null → price base).
 */
export async function loadClinicHiraUnitValue(
  clinicId: string | null | undefined,
): Promise<number | null> {
  if (!clinicId) return null;
  const { data } = await supabase
    .from('clinics')
    .select('hira_unit_value')
    .eq('id', clinicId)
    .maybeSingle();
  return (data?.hira_unit_value ?? null) as number | null;
}

/**
 * T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK — 급여구분 붕괴 방지용 유효 건보 등급.
 *
 * RC(가설 A · 무스키마): 진료비 세부산정내역(bill_detail)·계산서 출력의 급여 분류(getTaxClass)와
 *   본인부담/공단부담 split(computeFootBilling copaymentTotal)은 customers.insurance_grade 를
 *   유일 소스로 삼는다. 그런데 신규 방문에서는 접수 시점에 grade 가 아직 null(고객이
 *   InsuranceGradeSelect 로 명시 입력하기 전)이라, getTaxClass(svc, null)+copayRate=null 로
 *   급여 항목이 비급여로 오분류되거나 본인/공단이 0/공란으로 붕괴 → "신규출력 시 급여구분 공란".
 *   2번 차트에서 등급 입력 후 재출력하면 grade 가 채워져 정상 표시되던 조건부 버그(현장 보고와 일치).
 *
 * 해소(AC-2 무재산정·무날조): live customers.insurance_grade 가 있으면 그대로 사용(기존 동작 불변).
 *   비어(null) 있을 때만, 이 방문(check_in_id)의 service_charges 에 이미 영속된
 *   customer_grade_at_charge — 즉 급여 계산 당시 실제 적용 등급(InsuranceCopaymentPanel.persistCharges
 *   L165: applied_grade) — 를 폴백한다. 저장된 사실값이므로 임의 등급 날조가 아니며, 신규출력·재출력이
 *   동일 저장 등급으로 수렴한다(AC-3). 급여 charge 가 없는 무보험 방문은 유효 covered 등급이 없어
 *   null 반환 → 비급여로 정상 표기(무파괴).
 */
export async function loadEffectiveInsuranceGrade(
  customerId: string | null | undefined,
  checkInId: string,
): Promise<InsuranceGrade | null> {
  const live = await loadCustomerInsuranceGrade(customerId);
  if (live) return live; // 등급 존재 → 기존 경로 그대로(회귀 0)

  // 폴백: 이 방문에 저장된 급여 계산 당시 등급(service_charges.customer_grade_at_charge).
  //   is_insurance_covered 급여 행에서만 채택('manual'/비급여 행 제외) — 유효 covered 등급만.
  const { data } = await supabase
    .from('service_charges')
    .select('customer_grade_at_charge, is_insurance_covered')
    .eq('check_in_id', checkInId);
  for (const r of (data ?? []) as Array<{
    customer_grade_at_charge: string | null;
    is_insurance_covered: boolean | null;
  }>) {
    const g = r.customer_grade_at_charge as InsuranceGrade | null;
    if (r.is_insurance_covered && g && COVERED_GRADES.has(g)) return g;
  }
  return null;
}

/**
 * 진료비 세부산정내역서 category 열 = 서비스별 HIRA 항목분류 표시값.
 *
 * T-20260707-foot-BILLDETAIL-CATEGORY-HARDCODE:
 *   기존 하드코드 `covered ? '이학요법료' : '기타'` 는 급여 전부를 '이학요법료',
 *   비급여 전부를 '기타'로 뭉쳐 검사료/진찰료/치료 구분이 소실됐다. 서비스 종류별로
 *   HIRA 항목분류(진찰료/검사료/이학요법료/처치및수술료/기타)를 구분 표시한다.
 *
 * 매핑 소스 우선순위(diagnose-first 확정, 2026-07-07 live 데이터 진단):
 *   1) service.hira_category(enum) — 권위 소스. 단 현재 전 항목 null(미적재) → 미래 대비.
 *   2) service.category_label — 실 청구 line-item 에 유일하게 신호가 있는 소스
 *      (기본/검사/풋케어/수액/풋화장품/제증명). 이것으로 매핑.
 *   3) 둘 다 불명(null/미지값) → 레거시 폴백(covered ? '이학요법료' : '기타') 로 무파괴.
 *
 * ⚠ 이 함수는 표시 category 열만 결정한다. 급여구분(is_insurance_covered)·본인/공단부담
 *   (copayment_amount) split 은 별개 축(3d244c19)이라 미접촉 → 회귀 0.
 *   문서-폼 그룹핑('제증명' 탭, DocumentPrintPanel groupDocList) 도 별개 축 → 미접촉.
 */
export function footBillDetailCategory(service: BillingService, covered: boolean): string {
  // 1) HIRA enum(권위) 우선 — 미래 적재 대비
  switch (service.hira_category) {
    case 'consultation': return '진찰료';
    case 'examination':  return '검사료';
    case 'procedure':    return '처치및수술료';
    case 'medication':   return '기타';
    case 'document':     return '기타';
    // 'prescription' 등은 코드항목(isCodeItem)이라 pricingItems 에 미포함 → 도달 안 함
  }
  // 2) category_label(서비스 유형) 매핑 — 라이브 유일 신호
  switch (service.category_label) {
    case '기본':     return '진찰료';       // 초진/재진 진찰료
    case '검사':     return '검사료';       // KOH도말·일반진균검사·피검사
    case '풋케어':   return '처치및수술료'; // 레이저 시술·프리컨디셔닝 등 치료
    case '수액':     return '기타';         // 주사/수액
    case '풋화장품': return '기타';         // 화장품
    case '제증명':   return '기타';         // 제증명료(진단서·소견서 등)
  }
  // 3) 미지 category_label/(null) → 레거시 폴백(무파괴)
  return covered ? '이학요법료' : '기타';
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
      // T-20260707-foot-BILLDETAIL-CATEGORY-HARDCODE: 서비스별 HIRA 항목분류 구분 표시
      //   (기존 하드코드 covered?'이학요법료':'기타' → footBillDetailCategory 매핑으로 교체)
      category: footBillDetailCategory(service, covered),
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

  const coveredSum = covered.reduce((s, x) => s + x.total, 0);
  // ★ 등급→copay = copayFromBase 단일 SSOT 헬퍼(copayCalc.ts, RPC calc_copayment v1.6 미러) 소비.
  //   병렬 재계산 경로 신설 금지(DA §제약1). 정액(의급·차상위2)/면제(차상위1)/정률/노인 4구간 동일 적용.
  //   RC(T-20260720-COPAY-GRADE-BRANCH-MISSING): 종전 rate×base 만 적용 → 정액/면제 분기 누락, RPC divergence.
  //   정률경로 100원 미만 절사(FLOOR). CIT-2026-001/002 + revenue_insurance_split §2-2 v1.12. CEIL 복귀 금지.
  //
  // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR (총괄 확정 스펙): grade/coverage(=copayRate) null →
  //   본인부담금 = 급여 진료비 전액, 공단부담금 = 0. computeFootBilling 과 동일 역전 규칙(Path A 정합).
  //   과거엔 copayRate null → early-return(미개입) 이라 급여 항목 본인/공단이 0/공란 잔존했다 → 폴백 채움.
  //   (anyExisting=DB 권위 값이 있으면 위에서 이미 미개입). footBilling 집계 grain → hasOverride=false.
  const copaymentTotal = copayRate !== null
    ? copayFromBase(insuranceGrade!, coveredSum, copayRate, false)
    : coveredSum; // grade/coverage null → 본인 전액(공단=0) 폴백

  if (copaymentTotal <= 0) {
    // 급여 본인부담 0 등급(예: 차상위1종 면제=copay 0): 0 명시 → 공단부담금=급여전액 정상 산출.
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

/**
 * T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-② — 진료비 세부산정내역 '끝처리 조정금액' 10원 단위 절사.
 *
 * 대상 = 환자 실납부액(payable) = 급여 본인부담금 + 비급여 (공단 제외).
 *   GONGDAN-HIDE B안(T-20260714) / A안 canon(김주연 총괄 2026-07-19 확정) — 합계에서 공단부담금 제외.
 *
 * ▷ diagnose-first (copayment FLOOR 이중적용 없음):
 *   copayment(본인부담금)는 이미 100원 절사(round-DOWN, computeFootBilling/fillBillItemCopayment)된 값이다.
 *   본 절사는 그 위에서 (본인부담금 + 비급여) '합'을 10원 배수로 내림하는 별개 레벨의 연산으로,
 *   copayment 산출 레벨과 직교한다. copayment 가 이미 100원 배수여도 비급여가 10원 미만 우수리를 가지면
 *   payable 이 10원 배수가 아닐 수 있어 adjustment 가 유효하다. payable 이 이미 10원 배수면 adjustment=0
 *   (예: 308,800 → 0). 이중 절사·중복 상쇄가 발생하지 않는다.
 *
 * @param payable 본인부담금 + 비급여 (계 행 총액, 절사 전)
 * @returns adjustment = floor(payable/10)*10 - payable (≤ 0, 끝처리 조정금액 행),
 *          roundedTotal = floor(payable/10)*10 (합계 행, 절사 반영)
 */
export function computeBillDetailRounding(
  payable: number,
): { adjustment: number; roundedTotal: number } {
  const safe = Number.isFinite(payable) && payable > 0 ? payable : 0;
  const roundedTotal = Math.floor(safe / 10) * 10;
  return { adjustment: roundedTotal - safe, roundedTotal };
}

/**
 * T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-② — 진료비 계산서·영수증 신양식 비급여 항목행 category 분해.
 *
 * 배경(버그): 신양식(bill_receipt_new)은 급여 split(본인/공단)을 진찰료 행에 aggregate 표기(3FIX)하고,
 *   비급여(non_covered)는 전부 '기타' 행 하나에 뭉쳐 표기했다. 그 결과 foot 비급여 시술인
 *   '처치 및 수술료'(풋케어)·'검사료'(검사)가 자기 행에 표시되지 못하고 '기타'로만 나와 "항목 누락"으로 보였다.
 *
 * 해소(표시 전용·집계 grain 무변경): buildFootBillDetailItems 가 category(footBillDetailCategory)·
 *   is_insurance_covered 를 이미 부여한 billItems 를 category 별로 재집계해, 비급여분을
 *   처치및수술료 / 검사료 / 기타 세 버킷으로 분해한다. 세 버킷 합 = non_covered(aggregate)로 항상 정합
 *   → 합계 ④({{non_covered}})·매출 Insurance Split SSOT 불변(표시≠grain 변경). 급여(covered)분은 분해하지
 *   않고 진찰료 행 aggregate({{copayment}}/{{insurance_covered}}) 표기 유지 → 3FIX 급여 배치·야간가산 fold
 *   (applyNightHolidaySurcharge → copayment/insurance_covered) 경로 무접촉(회귀 0).
 *
 * ⚠ 폴백 경로(service_charges 직결, category='이학요법료'/'기타')는 처치/검사 매핑이 없어 전부 기타로 수렴
 *   → 기존 동작과 동일(무파괴). check_in_services 보유 차트(정상 경로)만 처치/검사 행이 채워진다.
 */
export function computeBillReceiptNewCategoryBreakdown(
  billItems: Array<{
    category?: string;
    amount: number;
    count?: number;
    days?: number;
    is_insurance_covered: boolean;
  }>,
): { procNonCov: number; examNonCov: number; etcNonCov: number } {
  let procNonCov = 0;
  let examNonCov = 0;
  let etcNonCov = 0;
  for (const it of billItems) {
    if (it.is_insurance_covered) continue; // 급여는 진찰료 행 aggregate 표기 유지(중복표기 방지)
    const total = (it.amount ?? 0) * (it.count ?? 1) * (it.days ?? 1);
    if (!(total > 0)) continue;
    if (it.category === '처치및수술료') procNonCov += total;
    else if (it.category === '검사료') examNonCov += total;
    else etcNonCov += total;
  }
  return { procNonCov, examNonCov, etcNonCov };
}

/**
 * T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-② 신양식 비급여 항목행 category 토큰 주입(표시 전용).
 *   {{proc_noncov}}=처치및수술료 비급여 / {{exam_noncov}}=검사료 비급여 / {{etc_noncov}}=잔여 비급여(기타 행).
 *   3버킷 합 = {{non_covered}}(④ 합계) 이므로 집계 grain 불변. 급여분은 진찰료 행 aggregate 유지(미접촉).
 *
 * T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 A: 종전 DocumentPrintPanel 로컬 정의였으나, 결제미니창
 *   (PaymentMiniWindow, PATH-4)이 동일 토큰을 주입하지 못해 결제창 인쇄 시 처치/검사 행이 공란이던 비대칭
 *   드리프트를 없애기 위해 footBilling SSOT 로 승격(export). 두 컴포넌트가 동일 인자·동일 로직으로 소비한다.
 *   순수 이전(로직/시그니처 무변) — DPP 기존 동작 회귀 0.
 */
export function applyBillReceiptNewCategoryTokens(
  values: Record<string, string>,
  billItems: Parameters<typeof computeBillReceiptNewCategoryBreakdown>[0],
): void {
  const bd = computeBillReceiptNewCategoryBreakdown(billItems);
  values.proc_noncov = bd.procNonCov > 0 ? formatAmount(bd.procNonCov) : '';
  values.exam_noncov = bd.examNonCov > 0 ? formatAmount(bd.examNonCov) : '';
  values.etc_noncov = bd.etcNonCov > 0 ? formatAmount(bd.etcNonCov) : '';
}

/**
 * T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함A — 신양식(bill_receipt_new) 급여 항목행
 *   category별 (본인/공단) 분해. 별지 제6호서식은 진찰료·검사료가 별개 법정 분류행이므로 급여 검사(KOH
 *   균검사 등)는 '검사료' 행 급여열에 귀속돼야 한다(진찰료 aggregate 흡수 = 사실오류 표기). DA CANON-GATE
 *   CONSULT-REPLY(MSG-20260722-105813-70hx) = GO(별도표기=canon).
 *
 * ▷ BINDING-1 (★CRITICAL, §2-2-6 인접): copay/fund split 은 **기존 buildFootBillDetailItems/fillBillItemCopayment
 *   가 채운 항목별 copayment_amount 를 그대로 집계**한다 — 새 인라인 copay/fund 경로 발명 금지.
 *   fund(공단) = 항목 급여총액 − copay. grade=null covered 는 상위(fillBillItemCopayment L650-652)에서
 *   copay=급여전액으로 채워지므로 여기선 fund=0(공단=0) 이 자동 성립 → naive 30/70 미적용(phantom NHIS 방지).
 *   copay ≤ 항목총액이 상위에서 보장(Math.min)되므로 fund ≥ 0.
 *
 * ▷ BINDING-2 (총계 불변 = 흡수 전제): 진찰료 행 = **최종 aggregate 잔여(remainder)**.
 *   진찰료_copay = 최종 aggregate {{copayment}} − Σ(비진찰료 카테고리 copay), 공단 동일.
 *   aggregate 는 이미 급여 검사분 leg 를 포함(buildFootBillDetailItems 가 copaymentTotal 을 전 급여항목에
 *   비례배분) → 검사료행 신설은 흡수돼 있던 leg 의 재배치일 뿐 총계 증가 아님(구조적 canon-safe).
 *   remainder ≥ 0 (aggregate ≥ Σ카테고리 copay). 방어적 max(0, ...) 로 음수 클램프.
 * ▷ BINDING-3: aggregate 키({{copayment}}/{{insurance_covered}}, 합계①②·⑦)는 무접촉 — remainder 는
 *   표시 전용 신 토큰(consult_copay/consult_ins)에만 실린다.
 */
export function computeBillReceiptNewCoveredBreakdown(
  billItems: Array<{
    category?: string;
    amount: number;
    count?: number;
    days?: number;
    is_insurance_covered: boolean;
    copayment_amount?: number;
  }>,
): {
  examCovered: number; examCopay: number;
  procCovered: number; procCopay: number;
} {
  let examCovered = 0, examCopay = 0, procCovered = 0, procCopay = 0;
  for (const it of billItems) {
    if (!it.is_insurance_covered) continue;
    const total = (it.amount ?? 0) * (it.count ?? 1) * (it.days ?? 1);
    if (!(total > 0)) continue;
    // BINDING-1: 상위가 채운 항목별 copayment_amount 재사용(신규 산출 금지).
    const copay = Math.min(it.copayment_amount ?? 0, total);
    if (it.category === '검사료') { examCovered += total; examCopay += copay; }
    else if (it.category === '처치및수술료') { procCovered += total; procCopay += copay; }
    // 그 외 급여(진찰료/기타/이학요법료)는 진찰료 행 remainder 로 자연 흡수 — 별도 버킷 없음.
  }
  return { examCovered, examCopay, procCovered, procCopay };
}

/**
 * T-20260722 결함A 토큰 주입 — 반드시 **applyNightHolidaySurcharge 이후**(최종 aggregate 기준)에 호출.
 *   야간가산분(진찰료 성격)이 fold 된 최종 {{copayment}}/{{insurance_covered}} 를 remainder 계산에 사용해야
 *   Σ(행별)=합계 가 안 깨진다(핸드오프 §3.3 순서강제).
 *
 *   {{consult_copay}}/{{consult_ins}}  = 진찰료 행(= aggregate 잔여)
 *   {{exam_copay}}/{{exam_ins}}        = 검사료 행 급여 본인/공단(급여 검사 存 시)
 *   {{proc_copay}}/{{proc_ins}}        = 처치 및 수술료 행 급여 본인/공단(foot 통상 0 = 공란)
 *
 * 불변식: consult_copay + exam_copay + proc_copay == {{copayment}},
 *         consult_ins  + exam_ins  + proc_ins  == {{insurance_covered}}.
 */
export function applyBillReceiptNewCoveredTokens(
  values: Record<string, string>,
  billItems: Parameters<typeof computeBillReceiptNewCoveredBreakdown>[0],
): void {
  const cb = computeBillReceiptNewCoveredBreakdown(billItems);
  const examFund = Math.max(0, cb.examCovered - cb.examCopay);
  const procFund = Math.max(0, cb.procCovered - cb.procCopay);
  const aggCopay = parseAmount(values.copayment ?? '');            // 최종 aggregate 본인부담(①, post-surcharge)
  const aggIns = parseAmount(values.insurance_covered ?? '');      // 최종 aggregate 공단부담(②, post-surcharge)
  // 진찰료 행 = aggregate 잔여(비진찰료 카테고리 차감). 음수 방어(구조적으로 ≥0).
  const consultCopay = Math.max(0, aggCopay - cb.examCopay - cb.procCopay);
  const consultIns = Math.max(0, aggIns - examFund - procFund);
  // 진찰료 행: 종전 {{copayment}}/{{insurance_covered}} aggregate 표기를 remainder 로 승계(항상 표기, 0→'0').
  values.consult_copay = formatAmount(consultCopay);
  values.consult_ins = formatAmount(consultIns);
  // 검사료/처치 급여 행: 급여 항목 존재 시에만 표기(0 이어도 '0' 명시 = 급여 행 canon, buildBillReceiptFeeGridHtml 동형).
  values.exam_copay = cb.examCovered > 0 ? formatAmount(cb.examCopay) : '';
  values.exam_ins = cb.examCovered > 0 ? formatAmount(examFund) : '';
  values.proc_copay = cb.procCovered > 0 ? formatAmount(cb.procCopay) : '';
  values.proc_ins = cb.procCovered > 0 ? formatAmount(procFund) : '';
}

/**
 * T-20260723-foot-BILLRECEIPT-PAIDBOX-NONCOV-MISROUTED 유효작업#1 — 납부박스 불변식 가드(순수 판정).
 *
 *   법정 별지 제6호서식 산식을 코드로 강제: **⑧ 환자부담총액 = ⑨ 이미납부 + ⑪ 실수납 + 미납.**
 *   `applyBillReceiptPaidBoxTokens` 의 `max(0,…)` 클램프가 발동하면(⑨>⑧ → ⑩ 클램프, ⑪>⑩ → 미납 클램프)
 *   합이 어긋난다 = PKGSESSION 미배선發 정합 이탈 신호. 이를 **표면화(플래그+진단사유)** 한다.
 *
 *   ★Stage1 = warn-only (GO 판정 Q2, 2026-07-23): 호출부는 이 결과를 **로그로만** 쓰고 발행은 통과시킨다.
 *     일시 클램프이상이 정당영수증 발행까지 막으면 현재 증상(표시 오류)보다 나쁜 field-blocking 회귀이기 때문.
 *   ★Stage2 = hard-block(발행보류): PKGSESSION-LINK-UNWIRED deployed 후 **별도 GO** 에서 활성화(본 스코프 밖).
 *
 *   silent 절단 금지 취지 충족: 이상을 삼키지 않고 clampFired/violations 로 항상 표면화(어느 케이스가 새는지
 *   진단 근거로 축적) — 다만 발행 흐름은 끊지 않음.
 */
export interface PaidBoxInvariantResult {
  /** 클램프 미발동 && ⑧=⑨+⑪+미납 성립. */
  ok: boolean;
  /** max(0,…) 절사 발동(⑨>⑧ or ⑪>⑩) — silent 절단 진단 근거. */
  clampFired: boolean;
  /** 사람이 읽는 위반 사유(로그·테스트용). */
  violations: string[];
  patientAmount: number; // ⑧
  alreadyPaid: number;   // ⑨ (10원 절사 후)
  paidTotal: number;     // ⑪
  dueAmount: number;     // ⑩
  unpaid: number;        // 미납
}

export function checkBillReceiptPaidBoxInvariant(
  patientAmount: number,
  alreadyPaid: number,
  paidTotal: number,
  dueAmount: number,
  unpaid: number,
): PaidBoxInvariantResult {
  const violations: string[] = [];
  let clampFired = false;
  // ⑨>⑧ → ⑩=max(0,⑧−⑨) 클램프(선수금이 총액 초과 = 그레인/배선 이탈).
  if (alreadyPaid > patientAmount) {
    clampFired = true;
    violations.push(`⑨ 이미납부(${alreadyPaid}) > ⑧ 환자부담총액(${patientAmount}) → ⑩ 클램프`);
  }
  // ⑪>⑩ → 미납=max(0,⑩−⑪) 클램프(실수납이 납부할금액 초과 = 과납/오배선).
  if (paidTotal > dueAmount) {
    clampFired = true;
    violations.push(`⑪ 실수납(${paidTotal}) > ⑩ 납부할금액(${dueAmount}) → 미납 클램프`);
  }
  // 법정 산식 불변식: ⑧ = ⑨ + ⑪ + 미납.
  const sum = alreadyPaid + paidTotal + unpaid;
  if (sum !== patientAmount) {
    violations.push(`불변식 위반: ⑧(${patientAmount}) ≠ ⑨+⑪+미납(${sum})`);
  }
  return {
    ok: violations.length === 0,
    clampFired,
    violations,
    patientAmount,
    alreadyPaid,
    paidTotal,
    dueAmount,
    unpaid,
  };
}

/**
 * T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함B — 신양식 ⑪ 납부한 금액 박스 payments 배선.
 *   법정서식 ⑪은 **실수납(payments 원장) 결제수단별** 기재(세법 공제 직결). 종전 {{prepaid_amount}} =
 *   납부할금액 가정값(FE 비영속) 전파 → 완납 가정(허위영수증) 위험 → payments method별 groupBy 로 교체.
 *
 *   ⚠ 합계 전파로 퉁치기 금지(REVERIFY-2 CRITICAL): 카드/현금/현금영수증 칸을 method별 각각 배선.
 *   {{card_amount}}=카드 / {{cashreceipt_amount}}=현금영수증(현금·이체 中 현금영수증 발급분) /
 *   {{cash_amount}}=그 외(현금·이체·멤버십) / {{paid_total}}=Σ(3칸)=실수납 총액 / {{unpaid_amount}}=⑩−⑪.
 *
 *   payments 는 status='active' 만 전달(호출부 필터, CHECKIN-RECEIPT-SOFTVOID-PHANTOM 계승 — 취소결제 미표시).
 *
 * @param patientAmount ⑧ 환자부담총액(10원 절사 후).
 * @param alreadyPaid ⑨ 이미 납부한 금액(선수금/패키지 차감 = check_in_services.is_package_session 환자부담분).
 *                    ⑩ due_amount = max(0, ⑧ − ⑨). unpaid = max(0, ⑩ − paidTotal). 기본 0(직접결제건 회귀 0).
 *
 * T-20260722-foot-BILLRECEIPT-MASTER-FIXES:
 *   §1 ⑨ '이미 납부한 금액' 칸 신설 + ⑩ 토큰 분리({{due_amount}}=⑧−⑨). ⑨만 채우고 ⑩을 patient_amount 로
 *      두면 "⑧-⑨" 라벨과 산술모순=허위영수증 재점화 → ⑩ 전용 토큰 필수(codex 배포차단급).
 *   §2 refund(payment_type='refund') 순액 차감 — 환불 양수·active 가 결제로 이중합산되던 오집계 정정.
 *   §6 dedup: 패키지 전액차감(method='membership') 결제행은 ⑨(already_paid)에 이미 반영 → ⑪ 버킷에서 제외
 *      (⑨·⑪ 이중계상 방지). 그 외 method 는 종전대로 groupBy.
 */
export function applyBillReceiptPaidBoxTokens(
  values: Record<string, string>,
  payments: Array<{ method?: string | null; amount?: number | null; cash_receipt_issued?: boolean | null; payment_type?: string | null }>,
  patientAmount: number,
  alreadyPaid: number = 0,
): void {
  let card = 0, cash = 0, cashReceipt = 0;
  for (const p of payments) {
    const amt = p.amount ?? 0;
    if (amt === 0) continue;
    // §6 dedup: 멤버십(패키지 전액차감) 결제행은 ⑨ '이미 납부한 금액'에 표기 → ⑪ 이중계상 방지.
    if (p.method === 'membership') continue;
    // §2 refund 순액: 환불(payment_type='refund')은 해당 결제수단 버킷에서 차감(paidTotal=Σ결제−Σ환불).
    const signed = p.payment_type === 'refund' ? -amt : amt;
    if (p.method === 'card') card += signed;
    else if (p.cash_receipt_issued) cashReceipt += signed; // 현금/이체 中 현금영수증 발급분
    else cash += signed;                                    // 현금·이체 등(멤버십 제외)
  }
  const paidTotal = card + cash + cashReceipt;
  values.card_amount = card > 0 ? formatAmount(card) : '';
  values.cash_amount = cash > 0 ? formatAmount(cash) : '';
  values.cashreceipt_amount = cashReceipt > 0 ? formatAmount(cashReceipt) : '';
  values.paid_total = paidTotal > 0 ? formatAmount(paidTotal) : '';
  // 종전 템플릿 ⑪ 합계 토큰({{prepaid_amount}}) 호환 유지 — paid_total 과 동일값으로 동기화.
  values.prepaid_amount = values.paid_total;
  // §1 ⑨ 이미 납부한 금액(선수금/패키지 차감). 0 이면 공란(직접결제건 회귀 0 — 종전 빈 셀 유지).
  //   T-20260723-foot-BILLRECEIPT-PAIDBOX-NONCOV-MISROUTED 유효작업#2 [10원 절사 정합]:
  //   ⑧(patientAmount)은 호출부에서 computeBillDetailRounding 로 10원 절사돼 넘어오는데, ⑨(alreadyPaid)는
  //   SSOT(copayment 100원절사 + nonCovered raw)의 10원 미만 우수리를 그대로 안고 있어 ⑩=⑧−⑨ 가 10원
  //   비배수가 될 여지가 있었다. ⑨에도 ⑧과 **동일한 절사규칙**(computeBillDetailRounding=내림)을 적용해
  //   ⑧·⑨·⑩ 모두 10원 grain 으로 정합시킨다. 내림이므로 ⑨↓ → 원장에 없는 돈을 만들지 않음(허위표기 아님).
  const alreadyPaidSafe = computeBillDetailRounding(alreadyPaid).roundedTotal; // ≥0 · 10원 배수
  values.already_paid = alreadyPaidSafe > 0 ? formatAmount(alreadyPaidSafe) : '';
  // §1 ⑩ 납부할 금액 = ⑧ − ⑨ (전용 토큰 분리 — patient_amount 하드코딩 폐기). ⑧·⑨ 모두 10원 배수 → ⑩ 정합.
  const dueAmount = Math.max(0, patientAmount - alreadyPaidSafe);
  values.due_amount = formatAmount(dueAmount);
  // 미납 = ⑩ − ⑪(실수납). 선수금 완납건이면 ⑩=잔액, paidTotal=잔액 → 미납=0.
  const unpaid = Math.max(0, dueAmount - paidTotal);
  values.unpaid_amount = formatAmount(unpaid);

  // 유효작업#1 [불변식 가드 — Stage1 warn-only]. ⑧=⑨+⑪+미납 성립 여부를 판정해 이상을 표면화한다.
  //   클램프(⑨>⑧ or ⑪>⑩) 발동 = PKGSESSION 미배선發 어긋남 → 플래그+로그. ★발행은 통과(Stage1).
  //   hard-block(발행보류)은 PKGSESSION deployed 후 Stage2 별도 GO 에서 활성화(본 스코프에선 금지).
  const invariant = checkBillReceiptPaidBoxInvariant(patientAmount, alreadyPaidSafe, paidTotal, dueAmount, unpaid);
  // 비템플릿 진단 마커(렌더 무영향 — 템플릿에 {{_paidbox_invariant}} 토큰 없음). 테스트/디버깅용.
  values._paidbox_invariant = invariant.ok ? 'ok' : 'warn';
  if (!invariant.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      '[BILLRECEIPT-PAIDBOX invariant warn][T-20260723-foot-BILLRECEIPT-PAIDBOX-NONCOV-MISROUTED]',
      invariant.violations.join(' / '),
      invariant,
    );
  }
}

/**
 * T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1 — ⑨ '이미 납부한 금액' 소스 로더.
 *   alreadyPaid = 이 방문(check_in_id)의 선수금/패키지 차감분의 **환자부담분**.
 *   소스 = check_in_services.price WHERE is_package_session=true (Closing.tsx:504 가 이미 쓰는 정합 소스).
 *   ⚠ package_payments 원장 금지 — 패키지 단위 할부총액이라 단건 영수증 그레인 오염(codex 확인).
 *
 *   급여패키지 그레인 가드(codex): check_in_services.price=급여총액인데 ⑧=copay 만 → full price 를 ⑨에
 *   넣으면 ⑩ 음수. 따라서 raw price 합이 아니라 computeFootBilling(SSOT) 의 환자부담분
 *   (copaymentTotal + nonCoveredTotal)을 반환 → 급여패키지면 본인부담분으로 자동 한정, 비급여패키지면
 *   전액(=price). 산식 canon 무접촉(기존 SSOT read-only 소비). 옵션은 수납 grain 과 동일(general_default).
 */
export async function loadAlreadyPaidAmount(
  checkInId: string,
  insuranceGrade: InsuranceGrade | null,
): Promise<number> {
  const { data: cis } = await supabase
    .from('check_in_services')
    .select('service_id, price, is_package_session')
    .eq('check_in_id', checkInId)
    .eq('is_package_session', true);

  const rows = (cis ?? []) as { service_id: string; price: number | null; is_package_session: boolean | null }[];
  if (rows.length === 0) return 0;

  const serviceIds = [...new Set(rows.map((r) => r.service_id))];
  const { data: svcData } = await supabase
    .from('services')
    .select('id, name, service_code, hira_code, hira_category, hira_score, vat_type, is_insurance_covered, category_label, price')
    .in('id', serviceIds);
  const svcMap = new Map<string, BillingService>(
    ((svcData ?? []) as BillingService[]).map((s) => [s.id, s]),
  );

  // service_id 별 그룹핑 — loadFootBillingItems 와 동일 규칙(qty=행수, unitPrice=저장 단가).
  const grouped = new Map<string, FootBillingItem>();
  for (const r of rows) {
    const svc = svcMap.get(r.service_id);
    if (!svc) continue;
    const existing = grouped.get(r.service_id);
    if (existing) existing.qty += 1;
    else grouped.set(r.service_id, { service: svc, qty: 1, unitPrice: r.price ?? svc.price ?? 0 });
  }
  const pkgItems = [...grouped.values()];
  if (pkgItems.length === 0) return 0;

  // SSOT 소비: 환자부담분(급여 본인부담 + 비급여 전액) = 실제 선수금으로 납부된 금액. 산식 canon 무변경.
  const b = computeFootBilling(pkgItems, insuranceGrade, { unknownGradeCopay: 'general_default' });
  return Math.max(0, b.copaymentTotal + b.nonCoveredTotal);
}
