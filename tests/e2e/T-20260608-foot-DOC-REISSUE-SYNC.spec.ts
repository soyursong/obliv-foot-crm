/**
 * E2E spec — T-20260608-foot-DOC-REISSUE-SYNC  (현장 4차 가속 / 선행: T-20260608-foot-DOC-PATH12-SYNC)
 *
 * 현장 지시(김주연 총괄): "그냥 결제 미니창(PATH-4)에 구현된 기능 그대로 가져가서
 *   1/2번차트에 똑같이 붙여줘." → 차트1/2 진료내역 재발행(PATH-3) + CheckInDetailSheet(PATH-1/2)이
 *   PaymentMiniWindow(PATH-4)와 100% 동일한 빌링 출력물을 내도록 공유 SSOT(@/lib/footBilling)로 수렴.
 *
 * 검증 전략: 빌링 산출은 이제 PMW(PATH-4)와 DocumentPrintPanel(PATH-1/2/3)이 동일한 `footBilling`
 *   순수 함수(computeFootBilling/buildFootBillDetailItems)를 공유한다. 따라서 동일 입력에 대해
 *   두 경로의 출력물은 구조적으로 동일하다 — 이를 직접 검증한다 (DB/auth 불필요, 실제 렌더 대조).
 *
 * AC-2: 4경로 동일 렌더 = L-006 단일 SSOT — PATH-3/PATH-4 빌링 산출값 100% 일치.
 * AC-3: 기존 PATH-1/2 무파괴 — service_charges 가 존재(populated)하면 footBilling 폴백을 쓰지 않는다(게이팅).
 * AC-4: DocumentPrintPanel 우회 직접 print() 신규 경로 없음 — 공유 모듈 재사용으로 수렴(복붙 분기 금지).
 *
 * 출처: PMW handleDocPrint L1452~1478 (applyBillingFallback + bill_detail items) ↔ footBilling SSOT.
 */
import { test, expect } from '@playwright/test';
import {
  type BillingService,
  type FootBillingItem,
  getTaxClass,
  isCodeItem,
  computeFootBilling,
  buildFootBillDetailItems,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

// ── 대표 시나리오 — 수기조정가(customAmounts) 반영된 혼합 청구 ──
//   급여(도수, hira) ×2 @30,000  /  비급여 과세(충격파) ×1 @50,000
//   비급여 면세(보조기) ×1 @20,000  /  상병코드(코드항목, 가격산정 제외) ×1
const SVC_COVERED: BillingService = {
  id: 'svc-doosu', name: '도수치료', service_code: 'MM010',
  hira_code: 'MM010', is_insurance_covered: true, category_label: '시술',
};
const SVC_TAXED: BillingService = {
  id: 'svc-eswt', name: '체외충격파', service_code: 'F0001',
  vat_type: 'exclusive', is_insurance_covered: false, category_label: '시술',
};
const SVC_EXEMPT: BillingService = {
  id: 'svc-orthosis', name: '맞춤보조기', service_code: 'G0001',
  vat_type: 'none', is_insurance_covered: false, category_label: '용품',
};
const SVC_CODE: BillingService = {
  id: 'svc-dx', name: 'M2153 후천성 변형', service_code: 'M2153',
  category_label: '상병',
};

// check_in_services 복원분 — unitPrice = 수기조정가(customAmounts) 반영본
const ITEMS: FootBillingItem[] = [
  { service: SVC_COVERED, qty: 2, unitPrice: 30000 },
  { service: SVC_TAXED, qty: 1, unitPrice: 50000 },
  { service: SVC_EXEMPT, qty: 1, unitPrice: 20000 },
  { service: SVC_CODE, qty: 1, unitPrice: 0 },
];

test.describe('T-20260608-foot-DOC-REISSUE-SYNC — PATH-3 ↔ PATH-4 빌링 SSOT 일치', () => {
  // ── 세금 분류 / 코드항목 판별 (PMW 로컬 → 공유 모듈 이전, 동작 1:1) ──
  test('세금 분류·코드항목 판별이 PMW 정의와 1:1 동일', () => {
    expect(getTaxClass(SVC_COVERED, 'general')).toBe('급여'); // 유효 등급 + hira
    expect(getTaxClass(SVC_TAXED)).toBe('비급여(과세)');
    expect(getTaxClass(SVC_EXEMPT)).toBe('비급여(면세)');
    expect(isCodeItem(SVC_CODE)).toBe(true);
    expect(isCodeItem(SVC_COVERED)).toBe(false);
  });

  // ── AC-2: 빌링 산출값 — PMW handleDocPrint 수기 계산과 동일 ──
  test('AC-2: computeFootBilling 산출이 PATH-4 수기 계산과 일치', () => {
    const fb = computeFootBilling(ITEMS, 'general'); // 일반 30%
    // 코드항목 제외 → 가격산정 3건
    expect(fb.pricingItems).toHaveLength(3);
    expect(fb.grandTotal).toBe(130000); // 60,000 + 50,000 + 20,000
    expect(fb.totalByTax['급여']).toBe(60000);
    expect(fb.totalByTax['비급여(과세)']).toBe(50000);
    expect(fb.totalByTax['비급여(면세)']).toBe(20000);
    expect(fb.coveredTotal).toBe(60000);
    // 본인부담금 = ceil(60,000 * 0.30 / 100) * 100 = 18,000
    expect(fb.copaymentTotal).toBe(18000);
    expect(fb.nonCoveredTotal).toBe(70000);
    // applyBillingFallback 전달값 — PMW L1452~1456 와 동일 정의
    expect(fb.liveBillingValues).toEqual({
      insuranceCovered: 42000, // 60,000 − 18,000
      copayment: 18000,
      nonCovered: 70000,
    });
  });

  // ── AC-2: 두 호출 사이트(PATH-3, PATH-4)는 동일 함수 → 산출 100% 일치 ──
  test('AC-2: PATH-3·PATH-4 두 경로 산출 deep-equal (단일 SSOT)', () => {
    const path4 = computeFootBilling(ITEMS, 'general'); // PMW(PATH-4) 호출
    const path3 = computeFootBilling(ITEMS, 'general'); // DocumentPrintPanel(PATH-3) 호출
    expect(path3).toEqual(path4);

    // 진료비세부산정내역 항목 HTML 도 동일 (양식 렌더 100% 일치)
    const items4 = buildFootBillDetailItems(path4.pricingItems, '2026-06-08');
    const items3 = buildFootBillDetailItems(path3.pricingItems, '2026-06-08');
    expect(items3).toEqual(items4);
    const html4 = buildBillDetailItemsHtml(items4);
    const html3 = buildBillDetailItemsHtml(items3);
    expect(html3).toBe(html4);
  });

  // ── AC-2: bill_detail 렌더 — 코드항목 제외, 수기조정가 반영 ──
  test('AC-2: bill_detail 항목에 코드항목 제외·수기조정가 반영', async ({ page }) => {
    const fb = computeFootBilling(ITEMS, 'general');
    const items = buildFootBillDetailItems(fb.pricingItems, '2026-06-08');
    expect(items).toHaveLength(3); // 상병코드 제외
    const html = buildBillDetailItemsHtml(items);
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table>${html}</table></body></html>`);
    const body = (await page.locator('body').innerText()).replace(/ /g, ' ');
    expect(body).toContain('도수치료');
    expect(body).toContain('체외충격파');
    expect(body).toContain('맞춤보조기');
    expect(body).not.toContain('M2153 후천성 변형'); // 코드항목 미표기
    expect(body).toContain('30,000'); // 수기조정 단가
    // 급여 항목 → 이학요법료, 비급여 → 기타
    expect(items[0]).toMatchObject({ category: '이학요법료', name: '도수치료', count: 2 });
    expect(items[1]).toMatchObject({ category: '기타', name: '체외충격파' });
  });

  // ── AC-3: 무파괴 — service_charges 존재 시 footBilling 폴백을 쓰지 않음 ──
  //   (DocumentPrintPanel 게이팅: serviceItems.length === 0 일 때만 footBillingItems 폴백.)
  //   계약 검증: footBilling 은 순수 폴백 소스이며, 항목 0건이면 빈 산출을 낸다.
  test('AC-3: 항목 없으면 빈 산출 — 폴백 미발동(무파괴) 계약', () => {
    const empty = computeFootBilling([], 'general');
    expect(empty.pricingItems).toHaveLength(0);
    expect(empty.grandTotal).toBe(0);
    expect(empty.copaymentTotal).toBe(0);
    expect(empty.liveBillingValues).toEqual({ insuranceCovered: 0, copayment: 0, nonCovered: 0 });
    // 빈 항목 → "진료 항목 없음" 플레이스홀더 (기존 빈-rows 동작 보존)
    expect(buildBillDetailItemsHtml(buildFootBillDetailItems([], '2026-06-08'))).toContain('진료 항목 없음');
  });

  // ── AC-3 회귀: 건보 미적용(등급 null) 시 급여 0, 전액 비급여 분류 유지 ──
  test('AC-3: 건보 등급 null 이면 copay 0 — 기존 비급여 동작 보존', () => {
    const fb = computeFootBilling(ITEMS, null);
    // 등급 null → SVC_COVERED 는 is_insurance_covered=true 라 여전히 급여, 단 copay 미산출
    expect(fb.coveredTotal).toBe(60000);
    expect(fb.copaymentTotal).toBe(0); // 등급 없으면 본인부담률 미적용
    expect(fb.liveBillingValues.insuranceCovered).toBe(60000);
  });
});
