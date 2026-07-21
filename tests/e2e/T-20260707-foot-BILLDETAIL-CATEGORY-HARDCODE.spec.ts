/**
 * E2E Spec — T-20260707-foot-BILLDETAIL-CATEGORY-HARDCODE
 *
 * 진료비 세부산정내역서 category 열이 하드코딩(covered?'이학요법료':'기타')되어 급여 전부가
 * '이학요법료', 비급여 전부가 '기타'로 뭉쳐 검사료/진찰료/치료 구분이 소실되던 버그 수정.
 * 서비스 종류별 HIRA 항목분류(진찰료/검사료/이학요법료/처치및수술료/기타)로 구분 표시한다.
 *
 * 수정: src/lib/footBilling.ts
 *   - footBillDetailCategory(service, covered) 매핑 함수 신설
 *     (hira_category enum 우선 → category_label 매핑 → 레거시 폴백)
 *   - buildFootBillDetailItems() L455 하드코드 → footBillDetailCategory() 로 교체
 *
 * diagnose-first(2026-07-07 live 진단):
 *   - services.hira_category(권위 enum) 는 라이브 전 항목 null → 사용불가
 *   - services.category_label 만 실 청구 line-item 에 신호 보유(기본/검사/풋케어/수액/풋화장품/제증명)
 *     → 이것으로 매핑. 미지값은 레거시 폴백(무파괴).
 *
 * 세 호출부(PaymentMiniWindow/PATH-4, DocumentPrintPanel 일괄, IssueDialog 단건)가 모두
 * 공유 SSOT buildFootBillDetailItems 를 경유 → 수정 1곳으로 양 경로 반영(AC-2).
 *
 * AC:
 *  - AC-1: category 열이 서비스 종류별 구분(전부 이학요법료/기타 로 뭉치지 않음)
 *  - AC-2: 미니결제창 / 2번차트 재출력 양 경로 동일(동일 SSOT 함수)
 *  - AC-3: 급여/비급여(is_insurance_covered) + 본인/공단 부담(copayment_amount) 회귀 0
 *  - AC-4: 동일 service_id 다회 → qty 합산 묶음 유지, 다른 항목 개별 행
 *
 * 실행: npx playwright test T-20260707-foot-BILLDETAIL-CATEGORY-HARDCODE.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  footBillDetailCategory,
  loadFootBillingItems,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, hira_category: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 진찰료(급여) + KOH검사(급여) + 레이저치료(비급여) + 화장품(비급여) + 상병코드(제외) 혼합 차트.
//   기존 하드코드라면 급여 2건(진찰료·검사)이 모두 '이학요법료'로, 비급여 2건이 모두 '기타'로 뭉쳤음.
const MIXED_CHART: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '초진진찰료-의원', service_code: 'AA154', is_insurance_covered: true, category_label: '기본', price: 18840 }), qty: 1, unitPrice: 18840 },
  { service: svc({ id: 'k1', name: '일반진균검사-KOH도말-조갑조직', service_code: 'D620300HZ', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
  { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 1, unitPrice: 350000 },
  { service: svc({ id: 'x1', name: '풋샴푸 (200ml)', is_insurance_covered: false, category_label: '풋화장품', price: 25000 }), qty: 1, unitPrice: 25000 },
  { service: svc({ id: 'd1', name: '손발톱백선', service_code: 'B351', category_label: '상병', price: 0 }), qty: 1, unitPrice: 0 },
];

test.describe('bill_detail category = 서비스별 HIRA 항목분류 구분 표시', () => {
  // ── 시나리오 1: 정상 동선 (2번차트 재출력) ──
  test('AC-1: category 가 서비스 종류별로 구분(전부 이학요법료/기타 로 뭉치지 않음)', () => {
    const fb = computeFootBilling(MIXED_CHART, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });

    // 상병코드 제외 → 가격 항목 4건
    expect(billItems).toHaveLength(4);

    const catOf = (code: string) => billItems.find((i) => i.code === code)?.category;
    const catByName = (name: string) => billItems.find((i) => i.name === name)?.category;

    // 진찰료·검사료·처치및수술료·기타 로 구분 표시
    expect(catOf('AA154')).toBe('진찰료');
    expect(catOf('D620300HZ')).toBe('검사료');
    expect(catOf('SZ035')).toBe('처치및수술료');
    expect(catByName('풋샴푸 (200ml)')).toBe('기타');

    // 핵심 회귀 가드: 급여 2건이 모두 '이학요법료' 한 값으로 뭉치지 않음
    const coveredCats = billItems.filter((i) => i.is_insurance_covered).map((i) => i.category);
    expect(new Set(coveredCats).size).toBeGreaterThan(1); // 진찰료 ≠ 검사료
    expect(coveredCats.every((c) => c === '이학요법료')).toBe(false);

    // 전체 category 종류가 2종 초과(구분됨)
    expect(new Set(billItems.map((i) => i.category)).size).toBeGreaterThanOrEqual(3);
  });

  test('AC-1: 렌더 HTML 에 진찰료/검사료/처치및수술료 셀이 각각 출력', () => {
    const fb = computeFootBilling(MIXED_CHART, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const html = buildBillDetailItemsHtml(billItems);
    expect(html).toContain('진찰료');
    expect(html).toContain('검사료');
    expect(html).toContain('처치및수술료');
  });

  // ── 시나리오 2: 미니결제창(PATH-4) 단건 = 2번차트 재출력 동일성 ──
  test('AC-2: 양 경로 동일 SSOT → 동일 입력 시 category 완전 일치', () => {
    const fb = computeFootBilling(MIXED_CHART, 'general');
    // PATH-4(PaymentMiniWindow) 와 2번차트(DocumentPrintPanel/IssueDialog) 모두 동일 함수 경유
    const pathA = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    const pathB = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });
    expect(pathA.map((i) => i.category)).toEqual(pathB.map((i) => i.category));
  });

  // ── AC-3: 급여/비급여 + 본인/공단 부담 회귀 0 (3d244c19 보존) ──
  test('AC-3: category 변경이 급여구분·본인/공단부담 split 에 영향 없음(회귀 0)', () => {
    const fb = computeFootBilling(MIXED_CHART, 'general');
    // 급여 = 진찰료 18,840 + 검사 10,540 = 29,380 → copay floor(*0.3/100)*100 = 8,800 (FLOOR canon v1.5)
    expect(fb.coveredTotal).toBe(29380);
    expect(fb.copaymentTotal).toBe(8800);

    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });

    // 급여 구분 유지
    expect(billItems.find((i) => i.code === 'AA154')!.is_insurance_covered).toBe(true);
    expect(billItems.find((i) => i.code === 'D620300HZ')!.is_insurance_covered).toBe(true);
    expect(billItems.find((i) => i.code === 'SZ035')!.is_insurance_covered).toBe(false);

    // 본인부담금 per-item 배분 합계 = copaymentTotal (진료비계산서 정합, 3d244c19 보존)
    const coveredCopaySum = billItems
      .filter((i) => i.is_insurance_covered)
      .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
    expect(coveredCopaySum).toBe(fb.copaymentTotal);

    // 비급여 항목은 급여 본인부담금 미설정(렌더 시 0)
    expect(billItems.find((i) => i.code === 'SZ035')!.copayment_amount).toBeUndefined();
  });

  // ── 시나리오 3: 엣지 — 동일 service_id 다회 qty 합산 ──
  test('AC-4: 동일 service_id 2회 → qty 합산 1행, 다른 항목 개별 행 (category 유지)', () => {
    // loadFootBillingItems 의 그룹핑 규칙과 동일: 동일 service_id 는 qty 누적.
    const grouped: FootBillingItem[] = [
      { service: svc({ id: 's1', name: '가열성 진균증 레이저 치료', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 350000 }), qty: 2, unitPrice: 350000 },
      { service: svc({ id: 'k1', name: 'KOH도말', service_code: 'D620300HZ', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
    ];
    const fb = computeFootBilling(grouped, 'general');
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-07', {
      insuranceGrade: 'general', copaymentTotal: fb.copaymentTotal,
    });

    // 서로 다른 항목 개별 행
    expect(billItems).toHaveLength(2);
    const laser = billItems.find((i) => i.code === 'SZ035')!;
    // 동일 service_id 2회 → qty 합산 묶음 유지
    expect(laser.count).toBe(2);
    // category 는 유형 유지(뭉치지 않고 처치및수술료)
    expect(laser.category).toBe('처치및수술료');
    expect(billItems.find((i) => i.code === 'D620300HZ')!.category).toBe('검사료');
  });

  // ── 매핑 함수 직접 단언 (진단 결과 반영) ──
  test('footBillDetailCategory: category_label → HIRA 항목분류 매핑', () => {
    const map = (label: string | null, covered = false) =>
      footBillDetailCategory(svc({ id: 't', name: 't', category_label: label }), covered);
    expect(map('기본')).toBe('진찰료');
    expect(map('검사')).toBe('검사료');
    expect(map('풋케어')).toBe('처치및수술료');
    expect(map('수액')).toBe('기타');
    expect(map('풋화장품')).toBe('기타');
    expect(map('제증명')).toBe('기타');
    // 미지 category_label → 레거시 폴백(무파괴)
    expect(map(null, true)).toBe('이학요법료');
    expect(map(null, false)).toBe('기타');
    expect(map('알수없음', true)).toBe('이학요법료');
  });

  test('footBillDetailCategory: hira_category(enum) 적재 시 우선 사용(미래대비)', () => {
    const withEnum = (hira: string, label: string | null) =>
      footBillDetailCategory(svc({ id: 't', name: 't', hira_category: hira, category_label: label }), false);
    // enum 이 category_label 과 달라도 enum 우선
    expect(withEnum('consultation', '풋케어')).toBe('진찰료');
    expect(withEnum('examination', '기본')).toBe('검사료');
    expect(withEnum('procedure', '검사')).toBe('처치및수술료');
    expect(withEnum('document', '기본')).toBe('기타');
  });

  test('loadFootBillingItems export 존재 확인(타입 회귀 가드)', () => {
    expect(typeof loadFootBillingItems).toBe('function');
  });
});
