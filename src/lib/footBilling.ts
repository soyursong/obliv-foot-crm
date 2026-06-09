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
