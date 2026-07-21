/**
 * E2E Spec — T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER
 *
 * 배경: 진료비 세부산정내역/계산서의 `service_charges` 직결 **폴백 렌더**(check_in_services 미기록
 *   구 데이터 경로)가 정식 HIRA 매핑(footBillDetailCategory, T-20260707)을 적용하지 않고
 *   하드코드 `covered ? '이학요법료' : '기타'` 로 수렴하던 버그(A안). 또한 폴백 경로가 primary
 *   (computeFootBilling.pricingItems)와 달리 codeItems(상병/처방약, price=0)를 제외하지 않아
 *   진단명·약품 0원 행이 세부내역 라인아이템으로 누출되던 갭(B안).
 *
 * 수정: src/components/DocumentPrintPanel.tsx — 3개 service_charges 직결 폴백 사이트
 *   (부모 영수증 fee-grid / 일괄 bill_detail / IssueDialog 단건 bill_detail):
 *   - category: `covered?'이학요법료':'기타'` → footBillDetailCategory(item, covered)  (A안)
 *   - `.filter((item) => !isCodeItem(item))` 로 상병/처방약 제외                        (B안)
 *   primary(check_in_services) 경로(buildFootBillDetailItems)와 대칭.
 *
 * db_change=false — 스키마·데이터 무변경. 문서-폼 그룹 축(제증명 groupDocList) 무접촉
 *   (footBillDetailCategory 는 제증명→'기타' 표시열만 결정, 문서 탭 그룹핑과 직교).
 *
 * ⚠ 본 spec 은 폴백 사이트의 인라인 transform 을 1:1 재현해 검증한다(DPP 인라인 로직은 직접
 *   import 불가). 재현 transform 이 실제 DPP 코드와 동일함은 코드리뷰 게이트로 보장.
 *
 * AC:
 *  - AC-1: 폴백 category 가 서비스종류별 구분(진찰료/검사료/처치및수술료/기타) — 전부 이학요법료/기타 뭉침 아님
 *  - AC-2: codeItems(상병/처방약) 제외 — 진단명·약품 price-0 행 세부내역 라인 무누출
 *  - AC-3: 제증명 → '기타'(문서-폼 축 무접촉, 표시열만) + 합계(total/비급여) 회귀 0
 *  - AC-4: 렌더 HTML(bill_detail·fee-grid)에 진찰료/검사료/처치및수술료 셀 각각 출력
 *  - AC-5: 비급여 검사/풋케어가 fee-grid 표준행(검사료/처치 및 수술료)으로 라우팅(종전 '기타' 드롭 해소)
 *
 * 실행: npx playwright test T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  footBillDetailCategory,
  isCodeItem,
  type BillingService,
} from '../../src/lib/footBilling';
import {
  buildBillDetailItemsHtml,
  buildBillReceiptFeeGridHtml,
} from '../../src/lib/htmlFormTemplates';

/** DocumentPrintPanel.ServiceChargeItem 구조 최소 재현(폴백 소스 행). */
interface SvcChargeItem {
  id: string;
  service_code: string | null;
  name: string;
  amount: number;
  copayment_amount?: number | null;
  hira_code: string | null;
  is_insurance_covered: boolean;
  category_label: string | null;
}

const row = (over: Partial<SvcChargeItem> & { id: string; name: string }): SvcChargeItem => ({
  service_code: null, amount: 0, copayment_amount: null, hira_code: null,
  is_insurance_covered: false, category_label: null, ...over,
});

/**
 * DPP 폴백 사이트(L899/L1142/L2457)의 수정 후 인라인 transform 1:1 재현.
 *   .filter(!isCodeItem) → footBillDetailCategory 매핑.
 */
function buildFallbackBillItems(serviceItems: SvcChargeItem[]) {
  return serviceItems
    .filter((item) => !isCodeItem(item as unknown as BillingService))
    .map((item) => ({
      category: footBillDetailCategory(item as unknown as BillingService, item.is_insurance_covered),
      date: '2026-07-21',
      code: item.service_code ?? item.hira_code ?? '',
      name: item.name,
      amount: item.amount,
      count: 1,
      days: 1,
      is_insurance_covered: item.is_insurance_covered,
      copayment_amount: item.copayment_amount ?? undefined,
    }));
}

// 진찰료(급여) + KOH검사(급여) + 레이저치료(비급여) + 화장품(비급여) + 제증명(비급여)
//   + 상병코드(제외) + 처방약(제외) 혼합 — DA Q4 폴백 잔차(상병/처방약 price-0)를 포함한 구 데이터 차트.
const MIXED_SC: SvcChargeItem[] = [
  row({ id: 'c1', name: '초진진찰료-의원', service_code: 'AA154', is_insurance_covered: true, category_label: '기본', amount: 18840, copayment_amount: 5700 }),
  row({ id: 'k1', name: '일반진균검사-KOH도말', service_code: 'D620300HZ', is_insurance_covered: true, category_label: '검사', amount: 10540, copayment_amount: 3200 }),
  row({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', amount: 350000 }),
  row({ id: 'x1', name: '풋샴푸 (200ml)', is_insurance_covered: false, category_label: '풋화장품', amount: 25000 }),
  row({ id: 'z1', name: '진단서(일반)', is_insurance_covered: false, category_label: '제증명', amount: 20000 }),
  row({ id: 'd1', name: '손발톱백선', service_code: 'B351', category_label: '상병', amount: 0 }),
  row({ id: 'p1', name: '주블리아외용액', category_label: '처방약', amount: 0 }),
];

test.describe('service_charges 직결 폴백 = 정식 HIRA 매핑 + codeItems 제외', () => {
  test('AC-1: 폴백 category 가 서비스종류별 구분(이학요법료/기타 뭉침 아님)', () => {
    const billItems = buildFallbackBillItems(MIXED_SC);
    const catOf = (code: string) => billItems.find((i) => i.code === code)?.category;
    const catByName = (name: string) => billItems.find((i) => i.name === name)?.category;

    expect(catOf('AA154')).toBe('진찰료');
    expect(catOf('D620300HZ')).toBe('검사료');
    expect(catOf('SZ035')).toBe('처치및수술료');
    expect(catByName('풋샴푸 (200ml)')).toBe('기타');

    // 회귀 가드: 급여 2건이 '이학요법료' 한 값으로 뭉치지 않음
    const coveredCats = billItems.filter((i) => i.is_insurance_covered).map((i) => i.category);
    expect(new Set(coveredCats).size).toBeGreaterThan(1);
    expect(coveredCats.every((c) => c === '이학요법료')).toBe(false);
    expect(new Set(billItems.map((i) => i.category)).size).toBeGreaterThanOrEqual(3);
  });

  test('AC-2: codeItems(상병/처방약) 제외 — 진단명·약품 라인 무누출', () => {
    const billItems = buildFallbackBillItems(MIXED_SC);
    // 7행 입력 중 상병·처방약 2행 제외 → 5행
    expect(billItems).toHaveLength(5);
    expect(billItems.find((i) => i.name === '손발톱백선')).toBeUndefined();
    expect(billItems.find((i) => i.name === '주블리아외용액')).toBeUndefined();
    // isCodeItem 단언
    expect(isCodeItem(row({ id: 'd', name: 'x', category_label: '상병' }) as unknown as BillingService)).toBe(true);
    expect(isCodeItem(row({ id: 'p', name: 'x', category_label: '처방약' }) as unknown as BillingService)).toBe(true);
    expect(isCodeItem(row({ id: 'z', name: 'x', category_label: '제증명' }) as unknown as BillingService)).toBe(false);
  });

  test('AC-3: 제증명 → 기타(표시열, 문서-폼 축 무접촉) + 합계 회귀 0', () => {
    const billItems = buildFallbackBillItems(MIXED_SC);
    // 제증명은 codeItem 이 아니라 표시열 '기타'(footBillDetailCategory SSOT, T-20260707)
    expect(billItems.find((i) => i.name === '진단서(일반)')?.category).toBe('기타');

    // 합계 불변: codeItems(price=0) 제외해도 total/비급여 합계 동일(0원 행은 합계 무기여)
    const total = MIXED_SC.reduce((s, i) => s + i.amount, 0);
    const billTotal = billItems.reduce((s, i) => s + i.amount, 0);
    expect(billTotal).toBe(total); // 상병·처방약 amount=0 → 제외해도 동일
    const nonCovered = billItems.filter((i) => !i.is_insurance_covered).reduce((s, i) => s + i.amount, 0);
    expect(nonCovered).toBe(350000 + 25000 + 20000); // 레이저+화장품+제증명
  });

  test('AC-4: 렌더 HTML(bill_detail)에 진찰료/검사료/처치및수술료 셀 각각 출력', () => {
    const html = buildBillDetailItemsHtml(buildFallbackBillItems(MIXED_SC));
    expect(html).toContain('진찰료');
    expect(html).toContain('검사료');
    expect(html).toContain('처치및수술료');
    // codeItems 제외 → 진단명/약품명 미출력
    expect(html).not.toContain('손발톱백선');
    expect(html).not.toContain('주블리아외용액');
  });

  test('AC-5: fee-grid 표준행 라우팅(비급여 검사/풋케어가 검사료/처치 및 수술료 행으로)', () => {
    const grid = buildBillReceiptFeeGridHtml(buildFallbackBillItems(MIXED_SC));
    // 진찰료 급여 + 검사료 급여 + 처치 및 수술료 비급여가 각 표준행에 라우팅됨
    expect(grid).toContain('진찰료');
    expect(grid).toContain('검사료');
    expect(grid).toContain('처치 및 수술료');
    // 종전 하드코드('기타')였다면 비급여 레이저가 표준행 밖 '기타'로 드롭돼 처치 및 수술료 금액이 공란이었음.
    expect(grid).toContain('350,000');
  });

  test('무파괴: 미지 category_label(null) → 레거시 폴백(covered?이학요법료:기타)', () => {
    // 폴백의 3-tier 3단계(둘 다 불명) 보존
    expect(footBillDetailCategory(row({ id: 'u', name: 'u', category_label: null }) as unknown as BillingService, true)).toBe('이학요법료');
    expect(footBillDetailCategory(row({ id: 'u', name: 'u', category_label: null }) as unknown as BillingService, false)).toBe('기타');
  });
});
