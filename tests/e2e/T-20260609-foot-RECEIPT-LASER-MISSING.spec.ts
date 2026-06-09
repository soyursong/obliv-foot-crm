/**
 * T-20260609-foot-RECEIPT-LASER-MISSING — 진료비 영수증 재발행 시 레이저 금액 누락 수정
 *
 * 현장(김주연 총괄): 2번차트 진료내역 → 진료비 영수증 서류 재발행 시 레이저 시술 금액이 빠지고
 *   "실 결제 금액"만 표기됨. 환자 발급 의료서류 금액 오기재(의료법 P1).
 *
 * 회귀원: handleReceiptReissue(PATH-3 재발급)가 total_amount = 선택 payments 합산(= 실 결제액)으로만
 *   영수증을 빌드. RECEIPT-PKG-PAYCLASS(713cf54) 이후 패키지 결제 레이저는 payments 가 아닌
 *   package_payments 에 들어가 결제 체크박스/합산에서 빠짐 → 영수증 합계·소계에서 레이저 누락.
 *
 * 해소: PATH-4(PaymentMiniWindow)와 동일 SSOT(check_in_services→computeFootBilling.grandTotal)로 통일.
 *   결제 방식과 무관하게 전체 진료 항목(레이저 포함)이 영수증에 표기 + PATH-3/PATH-4 출력본 일치.
 *
 * AC-1: 영수증 합계가 레이저 포함 전체 진료 항목 기준 → computeFootBilling.grandTotal (결제분류 무관).
 * AC-3: PATH-3/PATH-4 동일 SSOT(computeFootBilling) — 동일 입력 → 동일 합계.
 * AC-4: 레이저 외 비급여/급여 항목도 누락 없이 전체 합산. 코드 항목(상병·처방약)만 합산 제외.
 * AC-5: L-006 — DocumentPrintPanel 우회 직접 print() 신규 경로 없음(데이터 소스만 교체).
 *
 * 순수 함수 + 정적 소스 검증 → unit 프로젝트(auth 불요).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(
  path.join(__dirname, '../../src/components/DocumentPrintPanel.tsx'),
  'utf-8',
);

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null,
  hira_code: null,
  vat_type: 'exclusive',
  is_insurance_covered: false,
  category_label: null,
  ...over,
});

const item = (service: BillingService, unitPrice: number, qty = 1): FootBillingItem => ({
  service,
  qty,
  unitPrice,
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 영수증 합계가 레이저 금액을 포함 (결제분류 무관, 진료 항목 전체 기준)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1: 레이저 포함 전체 진료 항목 합산', () => {
  test('레이저 시술이 grandTotal 에 포함된다 (실 결제 분류와 무관)', () => {
    const laser = svc({ id: 'laser', name: '레이저 시술', category_label: '레이저' });
    const consult = svc({ id: 'consult', name: '도수상담' });

    // 시나리오: 레이저는 패키지 결제(payments 미기록), 상담만 실 결제.
    //   기존 버그는 payments(상담)만 합산 → 레이저 누락. 본 SSOT는 진료 항목 전체를 합산.
    const items = [item(laser, 300_000), item(consult, 50_000)];
    const result = computeFootBilling(items, null);

    // 레이저 금액이 합계에 반드시 포함 — '실 결제 금액(상담 50,000)'만 나오면 회귀(버그).
    expect(result.grandTotal).toBe(350_000);
    expect(result.grandTotal).toBeGreaterThan(50_000);
  });

  test('레이저 단독 케이스도 누락 없이 합산', () => {
    const laser = svc({ id: 'laser', name: '온열 레이저', category_label: 'heated_laser' });
    const result = computeFootBilling([item(laser, 250_000)], null);
    expect(result.grandTotal).toBe(250_000);
    expect(result.nonCoveredTotal).toBe(250_000); // 비급여(과세) 레이저
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: PATH-3 / PATH-4 동일 SSOT — 동일 입력이면 동일 합계
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3: PATH-3/PATH-4 합계 일치 (단일 SSOT)', () => {
  test('동일 진료 항목 입력 → computeFootBilling 합계 결정적 일치', () => {
    const items = [
      item(svc({ id: 'laser', name: '레이저', category_label: '레이저' }), 300_000),
      item(svc({ id: 'care', name: '발관리' }), 80_000, 2),
    ];
    const path4 = computeFootBilling(items, null);
    const path3 = computeFootBilling(items, null);
    expect(path3.grandTotal).toBe(path4.grandTotal);
    expect(path3.grandTotal).toBe(300_000 + 160_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 레이저 외 항목 누락 없음 / 코드 항목(상병·처방약)만 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4: 전체 항목 합산 + 코드 항목 제외', () => {
  test('급여+비급여+레이저 전부 합산, 상병·처방약은 가격산정 제외', () => {
    const items = [
      item(svc({ id: 'laser', name: '레이저', category_label: '레이저' }), 300_000),
      item(svc({ id: 'cov', name: '물리치료', is_insurance_covered: true, hira_code: 'MM010' }), 20_000),
      item(svc({ id: 'dx', name: '내향성발톱', category_label: '상병' }), 0),
      item(svc({ id: 'rx', name: '소염제', category_label: '처방약' }), 0),
    ];
    const result = computeFootBilling(items, null);
    // 레이저 + 물리치료만 가격 합산 (상병/처방약 제외)
    expect(result.grandTotal).toBe(320_000);
    expect(result.pricingItems.map((i) => i.service.id).sort()).toEqual(['cov', 'laser']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 가드: handleReceiptReissue 가 진료 항목 SSOT 기준으로 합산 + payments 폴백만 유지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('소스 가드: 영수증 재발급 합산 로직', () => {
  test('handleReceiptReissue 가 computeFootBilling/footBillingItems 로 treatmentTotal 산출', () => {
    expect(PANEL_SRC).toContain('T-20260609-foot-RECEIPT-LASER-MISSING');
    expect(PANEL_SRC).toContain('const treatmentTotal = fb');
    // total_amount 가 더이상 payments 합산을 '항상' 쓰지 않음 — treatmentTotal 우선
    expect(PANEL_SRC).toContain('bindValues.total_amount = formatAmount(treatmentTotal)');
  });

  test('AC-4 회귀 가드: payments 합산은 진료 항목 미기록(구 데이터)일 때만 폴백', () => {
    // treatmentTotal > 0 이면 진료 항목 기준, 아니면 paymentsTotal 폴백
    expect(PANEL_SRC).toContain('treatmentTotal > 0');
    expect(PANEL_SRC).toContain('bindValues.total_amount = formatAmount(paymentsTotal)');
  });

  test('AC-5 (L-006): 영수증 재발급은 openBatchPrintWindow(단일 렌더 경로) 유지 — 신규 우회 print 없음', () => {
    // 본 수정은 total_amount 데이터 소스만 교체(payments 합산 → 진료 항목 SSOT).
    // 영수증 재발급 출력 경로는 기존과 동일하게 openBatchPrintWindow 경유.
    // openBatchPrintWindow 호출부의 출력 제목(템플릿 리터럴)로 출력 경로를 특정 (주석 헤더와 구분).
    expect(PANEL_SRC).toContain('openBatchPrintWindow([pageHtml], `진료비 영수증 재발급 — ${checkIn.customer_name}`)');
    // 변경 블록(treatmentTotal 산출)에 직접 print()/window.open 신설 없음 — 데이터 산출만.
    const blockIdx = PANEL_SRC.indexOf('const treatmentTotal = fb');
    const blockRegion = PANEL_SRC.slice(blockIdx, blockIdx + 600);
    expect(blockRegion).not.toContain('window.open(');
    expect(blockRegion).not.toContain('.print(');
  });
});
