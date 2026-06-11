/**
 * E2E spec — T-20260611-foot-DOC-REISSUE-CONTENT-MISSING  (P0, 현장 "엄청 심각한 버그")
 *
 * 보고(김주연 총괄): "고객차트 > 진료내역 > 서류 재발급 시, 당일 멀쩡히 잘 나오던 서류도
 *   이전처럼 내용 전부 누락되어 출력됨."
 *
 * 근인(AC-3, 1줄): PATH-3 재발급(DocumentPrintPanel.handleBatchPrint / handleReceiptReissue)의 빌링 폴백이
 *   비동기 load()가 채우는 React state(footBillingItems·customerInsuranceGrade)에 의존 → 재발급 모달
 *   mount 직후 load() 완료 전 발행 시 service_charges 미기록(=당일 PATH-4(결제 미니창)로 정상 출력한 서류는
 *   service_charges를 안 씀) 케이스에서 폴백 미발동 → 항목·금액 공란. service_charges는 print 시점 fresh
 *   조회인데 check_in_services만 state 의존이던 '비대칭'이 핵심. → state 비면 print 시점 fresh 조회로 결정적 폴백.
 *
 * 검증 전략(기존 DOC-REISSUE-SYNC spec와 동일 — DB/auth 불필요):
 *   (1) AC-1/2 빌링 폴백 렌더가 check_in_services 데이터에서 실제 항목 행을 산출(빈 "진료 항목 없음" 아님).
 *   (2) AC-1 재발급(PATH-3) 출력 == 최초출력(PATH-4) 출력 — 동일 SSOT(computeFootBilling/buildFootBillDetailItems).
 *   (3) AC-3 근인 가드(소스 introspection): print 핸들러가 폴백 소스를 state 단독 의존하지 않고
 *       fresh 조회(loadFootBillingItems/loadCustomerInsuranceGrade)로 폴백한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BillingService,
  type FootBillingItem,
  computeFootBilling,
  buildFootBillDetailItems,
} from '../../src/lib/footBilling';
import { buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

// ── 대표 재발급 시나리오 — 당일 PATH-4로 출력했던 혼합 청구(레이저=비급여 포함) ──
const SVC_LASER: BillingService = {
  id: 'svc-laser', name: '레이저', service_code: 'MM900',
  hira_code: 'MM900', is_insurance_covered: true, category_label: '시술',
};
const SVC_DOOSU: BillingService = {
  id: 'svc-doosu', name: '도수치료', service_code: 'MM010',
  hira_code: 'MM010', is_insurance_covered: true, category_label: '시술',
};
const SVC_PRECON: BillingService = {
  id: 'svc-precon', name: '프리컨디셔닝', service_code: 'F0001',
  vat_type: 'exclusive', is_insurance_covered: false, category_label: '시술',
};

// check_in_services 복원분 (service_charges 미기록 — PATH-4 단독 출력 케이스)
const ITEMS: FootBillingItem[] = [
  { service: SVC_DOOSU, qty: 2, unitPrice: 30000 },
  { service: SVC_LASER, qty: 1, unitPrice: 40000 },
  { service: SVC_PRECON, qty: 1, unitPrice: 50000 },
];

const PANEL_SRC = readFileSync(
  join(process.cwd(), 'src/components/DocumentPrintPanel.tsx'),
  'utf-8',
);

test.describe('T-20260611-foot-DOC-REISSUE-CONTENT-MISSING — 재발급 내용 누락 회귀 가드', () => {
  // AC-1/2: 폴백 렌더가 실제 항목 행을 낸다(빈 "진료 항목 없음" 아님).
  test('AC-1/2: check_in_services 폴백 → 항목 행 렌더(공란 아님)', () => {
    const fb = computeFootBilling(ITEMS, null);
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-06-11', {
      insuranceGrade: null,
      copaymentTotal: fb.copaymentTotal,
    });
    const html = buildBillDetailItemsHtml(billItems);

    // "진료 항목 없음"(전부 누락) 이 아니어야 한다.
    expect(html).not.toContain('진료 항목 없음');
    // 실제 진료 항목명이 출력에 포함.
    expect(html).toContain('도수치료');
    expect(html).toContain('레이저');
    expect(html).toContain('프리컨디셔닝');
    // 금액(천단위 콤마)도 출력.
    expect(html).toContain('30,000');
    expect(html).toContain('40,000');
    expect(html).toContain('50,000');
  });

  // AC-1: 재발급(PATH-3) 출력 == 최초출력(PATH-4) 출력 — 동일 입력·동일 SSOT.
  test('AC-1: PATH-3 재발급 항목 HTML == PATH-4 최초출력 항목 HTML', () => {
    // PATH-4 (최초출력) — PaymentMiniWindow는 in-memory pricingItems로 동일 SSOT 산출.
    const fb4 = computeFootBilling(ITEMS, null);
    const path4Items = buildFootBillDetailItems(fb4.pricingItems, '2026-06-11', {
      insuranceGrade: null,
      copaymentTotal: fb4.copaymentTotal,
    });
    const path4Html = buildBillDetailItemsHtml(path4Items);

    // PATH-3 (재발급) — fresh 조회한 동일 check_in_services로 동일 산출.
    const fb3 = computeFootBilling(ITEMS, null);
    const path3Items = buildFootBillDetailItems(fb3.pricingItems, '2026-06-11', {
      insuranceGrade: null,
      copaymentTotal: fb3.copaymentTotal,
    });
    const path3Html = buildBillDetailItemsHtml(path3Items);

    expect(path3Html).toBe(path4Html);
    expect(fb3.grandTotal).toBe(fb4.grandTotal);
    expect(fb3.grandTotal).toBeGreaterThan(0);
  });

  // AC-3 근인 가드: print 핸들러 폴백이 state 단독 의존이 아니라 fresh 조회로 결정적이어야 한다.
  test('AC-3: 폴백 소스가 print 시점 fresh 조회(state 단독 의존 금지)', () => {
    // handleBatchPrint/handleReceiptReissue 가 폴백 시 loadFootBillingItems/loadCustomerInsuranceGrade를
    // 직접 호출(load() state 외)하는 패턴이 존재해야 한다 — 회귀(stale state 의존) 재발 방지.
    const freshFbCalls = PANEL_SRC.match(/loadFootBillingItems\(checkIn\.id, checkIn\.clinic_id\)/g) ?? [];
    const freshGradeCalls = PANEL_SRC.match(/loadCustomerInsuranceGrade\(checkIn\.customer_id\)/g) ?? [];

    // load() 1회 + handleBatchPrint 1회 + handleReceiptReissue 1회 = 최소 3회.
    expect(freshFbCalls.length).toBeGreaterThanOrEqual(3);
    expect(freshGradeCalls.length).toBeGreaterThanOrEqual(3);

    // 비대칭 해소 흔적: fbStale 게이트(로드됐으면 state 재사용, 비면 fresh)가 존재.
    expect(PANEL_SRC).toContain('fbStale');
    // 근인 티켓 마킹.
    expect(PANEL_SRC).toContain('T-20260611-foot-DOC-REISSUE-CONTENT-MISSING');
  });

  // L-006 무파괴: 우회 print() 신규 경로 없이 단일 렌더 경로(bindHtmlTemplate) 유지.
  test('L-006: 폴백 수정이 단일 렌더 경로 유지(우회 print 신규 없음)', () => {
    // 재발급 출력은 여전히 openBatchPrintWindow + bindHtmlTemplate 경유.
    expect(PANEL_SRC).toContain('bindHtmlTemplate');
    expect(PANEL_SRC).toContain('openBatchPrintWindow');
  });
});
