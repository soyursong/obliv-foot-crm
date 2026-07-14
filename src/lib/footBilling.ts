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
    .select('id, customer_id, total_amount, consultation_fee, created_at')
    .eq('clinic_id', clinicId)
    .eq('status', 'active')
    .in('customer_id', ids);
  const pkgRows = (pkgs ?? []) as Array<{
    id: string; customer_id: string; total_amount: number | null;
    consultation_fee: number | null; created_at: string;
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
    const pkgDue = computeOutstanding(pkg.total_amount, netPaidFromPayments(rows, 'package'));
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
  opts?: { unknownGradeCopay?: 'covered_full' | 'general_default' },
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
  // 100원 절상 — copayCalc.ts / PMW 와 동일 규칙.
  const round100 = (base: number, rate: number) =>
    Math.min(Math.ceil((base * rate) / 100) * 100, base);
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
        ? round100(coveredTotal, copayRate)
        : (opts?.unknownGradeCopay === 'general_default'
            ? round100(coveredTotal, getBaseCopayRate('general')) // 수납: 등급 미상 → 외래 기본 30% 본인부담
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
    .select('id, name, service_code, hira_code, hira_category, vat_type, is_insurance_covered, category_label, price')
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
  // 100원 절상 — computeFootBilling / copayCalc / PMW 와 동일 규칙.
  //
  // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR (총괄 확정 스펙): grade/coverage(=copayRate) null →
  //   본인부담금 = 급여 진료비 전액, 공단부담금 = 0. computeFootBilling 과 동일 역전 규칙(Path A 정합).
  //   과거엔 copayRate null → early-return(미개입) 이라 급여 항목 본인/공단이 0/공란 잔존했다 → 폴백 채움.
  //   유효 등급은 100원 절상 기존 산식 그대로 — 회귀 0. (anyExisting=DB 권위 값이 있으면 위에서 이미 미개입)
  const copaymentTotal = copayRate !== null
    ? Math.min(Math.ceil((coveredSum * copayRate) / 100) * 100, coveredSum)
    : coveredSum; // grade/coverage null → 본인 전액(공단=0) 폴백

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
