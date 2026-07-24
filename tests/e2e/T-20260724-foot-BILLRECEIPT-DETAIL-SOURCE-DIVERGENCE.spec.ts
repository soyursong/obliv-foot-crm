/**
 * T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE
 *
 * 계산서·영수증 신양식(bill_receipt_new) ↔ 세부산정내역(bill_detail) 금액 divergence 수정.
 * base = 라이브 origin/main. db_change=false — 순수 산식/표시층 한정(DB write 0, AC-5).
 *
 * RC(codex GO, D0 read-only reconcile 확정):
 *   - bill_detail = check_in_services(라이브 SSOT) 명시 세팅 → 정합(정답, 무접촉).
 *   - bill_receipt_new = aggregate 4토큰({{total_amount}}/{{insurance_covered}}/{{copayment}}/{{non_covered}}·
 *     ⑧ {{patient_amount}})을 applyBillingFallback(blank-only, isBlankOrZero 가드)에만 의존 → autobind
 *     (service_charges 감사로그/stale)이 이미 채운 값을 라이브(check_in_services)로 못 덮어 divergence.
 *   - 정답 소스 = check_in_services.
 *   - D0 실측(F-4790 대상 방문): check_in_services 비급여=315,000·총액=335,590·급여본인=6,100·공단=14,490,
 *     service_charges 는 비급여=0(급여만 기록) → service_charges 신뢰 불가 확정.
 *
 * 해소: 신양식 전용 SSOT 헬퍼 applyBillReceiptNewLiveTotals 로 bill_detail 과 동일 SSOT·grain(computeFootBilling)
 *   값을 **강제 세팅(force)**. applyBillingFallback 일반정책·bill_detail 무접촉(D1). DPP 단건·배치·미리보기 +
 *   PMW [출력]/[출력및수납] 전경로 대칭(D2). total_amount = grandTotal(공단 포함)(D3).
 *
 * 완료기준:
 *   AC-1: 영수증=세부내역 완전일치(급여본인 6,100/공단 14,490/비급여 315,000).
 *   AC-2: 영수증 진료비총액 = 335,590 (grandTotal 공단포함).
 *   AC-3: DPP 단건·배치·미리보기 + PMW 전경로 동일값(헬퍼 단일소비).
 *   AC-4: T-20260609 AC-3(수납 전 출력 total_amount 누락 방지) GREEN 유지 / AC-5: DB write 0건.
 *
 * 라이브 앱 회귀 아님 — 순수 산식(로그인 불요, 결정론적) + 호출부 소스 배선 assert.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  applyBillReceiptNewLiveTotals,
  computeFootBilling,
  type FootBillingItem,
} from '../../src/lib/footBilling';
import { applyBillingFallback } from '../../src/lib/autoBindContext';

const ROOT = process.cwd();
const FB_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/footBilling.ts'), 'utf8');
const DPP_SRC = fs.readFileSync(path.join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const PMW_SRC = fs.readFileSync(path.join(ROOT, 'src/components/PaymentMiniWindow.tsx'), 'utf8');

// D0 실측 골든값(F-4790 대상 방문, check_in_services 라이브 SSOT).
const F4790 = {
  grandTotal: 335590,   // 진료비 총액(공단 포함) = 급여전액 20,590 + 비급여 315,000
  copayment: 6100,      // 급여 본인부담 = FLOOR(20,590 × 0.3) → 100원 절사
  insuranceCovered: 14490, // 공단부담 = 20,590 − 6,100
  nonCovered: 315000,   // 비급여
};

test.describe('BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE — 신양식 aggregate 라이브 SSOT 강제', () => {
  // ═══════════ AC-1/AC-2: 라이브값 강제 세팅 (골든 F-4790) ═══════════

  test('AC-1/2: 헬퍼가 aggregate 4토큰 + ⑧을 라이브값으로 강제 세팅 (비급여 315,000 / 총액 335,590)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptNewLiveTotals(v, F4790);
    expect(v.total_amount).toBe('335,590');        // AC-2 ⑥ 진료비 총액(공단 포함)
    expect(v.subtotal_amount).toBe('335,590');
    expect(v.insurance_covered).toBe('14,490');    // AC-1 공단
    expect(v.copayment).toBe('6,100');             // AC-1 급여 본인
    expect(v.non_covered).toBe('315,000');         // AC-1 비급여
    // ⑧/⑩ 환자부담총액 = 본인부담 + 비급여(공단 제외) 10원 절사. 6,100 + 315,000 = 321,100.
    expect(v.patient_amount).toBe('321,100');
  });

  test('AC-1: stale service_charges 선점값을 라이브로 덮는다 (isBlankOrZero 가드 우회 = 신양식 한정 force)', () => {
    // autobind(service_charges) 가 이미 stale 비급여 240,000·총액 269,380 을 채워둔 상태를 재현.
    const v: Record<string, string> = {
      total_amount: '269,380',
      subtotal_amount: '269,380',
      insurance_covered: '20,675',
      copayment: '8,700',
      non_covered: '240,000',
      patient_amount: '248,700',
    };
    // 종전 경로(blank-only 폴백)는 이미 채워진 값을 못 덮어 divergence 유지 (RC 재현).
    const fallbackOnly = { ...v };
    applyBillingFallback(fallbackOnly, {
      insuranceCovered: F4790.insuranceCovered,
      copayment: F4790.copayment,
      nonCovered: F4790.nonCovered,
      total: F4790.grandTotal,
    });
    expect(fallbackOnly.non_covered).toBe('240,000'); // ← blank-only: stale 유지(버그 재현)
    expect(fallbackOnly.total_amount).toBe('269,380');

    // 신규 경로(force)는 라이브로 덮어 bill_detail 과 정합.
    applyBillReceiptNewLiveTotals(v, F4790);
    expect(v.non_covered).toBe('315,000');
    expect(v.total_amount).toBe('335,590');
    expect(v.copayment).toBe('6,100');
    expect(v.insurance_covered).toBe('14,490');
  });

  // ═══════════ AC-1/AC-3: bill_detail 과 동일 SSOT·grain → 완전일치 ═══════════

  test('AC-1/3: bill_detail(footFb 명시)과 bill_receipt_new(헬퍼)가 동일 computeFootBilling 소스 → 항등', () => {
    // 급여(진찰료) 20,590 + 비급여 315,000 = grandTotal 335,590, grade=general(30%) 재현.
    const items: FootBillingItem[] = [
      { service: mkSvc('AA154', true), qty: 1, unitPrice: 20590 },   // 급여 진찰료
      { service: mkSvc('FOOTCARE', false), qty: 1, unitPrice: 315000 }, // 비급여 처치
    ];
    const fb = computeFootBilling(items, 'general');
    expect(fb.grandTotal).toBe(335590);
    expect(fb.nonCoveredTotal).toBe(315000);
    expect(fb.copaymentTotal).toBe(6100);
    expect(fb.liveBillingValues.insuranceCovered).toBe(14490);

    // bill_receipt_new 헬퍼는 fb.liveBillingValues + grandTotal 을 소비 → bill_detail 과 동일 소스.
    const rn: Record<string, string> = {};
    applyBillReceiptNewLiveTotals(rn, {
      grandTotal: fb.grandTotal,
      insuranceCovered: fb.liveBillingValues.insuranceCovered,
      copayment: fb.liveBillingValues.copayment,
      nonCovered: fb.liveBillingValues.nonCovered,
    });
    expect(rn.copayment).toBe('6,100');
    expect(rn.insurance_covered).toBe('14,490');
    expect(rn.non_covered).toBe('315,000');
    expect(rn.total_amount).toBe('335,590');
  });

  // ═══════════ 무파괴: 라이브 SSOT 부재 → no-op (service_charges 직결 폴백 보존) ═══════════

  test('무파괴: grandTotal ≤ 0(check_in_services 미기록 구 데이터) → 헬퍼 no-op, 기존값 보존', () => {
    const v: Record<string, string> = {
      total_amount: '100,000', non_covered: '50,000', copayment: '30,000',
      insurance_covered: '20,000', patient_amount: '80,000',
    };
    const before = { ...v };
    applyBillReceiptNewLiveTotals(v, { grandTotal: 0, insuranceCovered: 5, copayment: 5, nonCovered: 5 });
    expect(v).toEqual(before); // 폴백 경로 무접촉
  });

  // ═══════════ AC-3/D2: 전경로 대칭 (헬퍼 단일소비 · 4 call-site 배선) ═══════════

  test('D2: DPP 단건·배치·미리보기 + PMW 가 동일 헬퍼(applyBillReceiptNewLiveTotals)를 소비', () => {
    // 헬퍼는 footBilling SSOT 에 1회 정의(export).
    expect(FB_SRC).toMatch(/export function applyBillReceiptNewLiveTotals/);
    // DPP: import + 단건/미리보기(allValues) 경로 + 배치(valuesFor) 경로 총 2개 호출.
    expect(DPP_SRC).toMatch(/applyBillReceiptNewLiveTotals,/);
    const dppCalls = (DPP_SRC.match(/applyBillReceiptNewLiveTotals\(/g) || []).length;
    expect(dppCalls).toBeGreaterThanOrEqual(2);
    // PMW: import + 공용 헬퍼(applyBillReceiptNewSplitAndPaid, [출력]/[출력및수납] 공유) 1개 호출.
    expect(PMW_SRC).toMatch(/applyBillReceiptNewLiveTotals,/);
    expect(PMW_SRC).toMatch(/applyBillReceiptNewLiveTotals\(/);
  });

  test('순서강제: 라이브 aggregate 세팅이 applyBillReceiptNewCoveredTokens 이전에 위치(remainder base 정합)', () => {
    // PMW: SplitAndPaid 내부에서 LiveTotals → CoveredTokens 순.
    const liveIdxPmw = PMW_SRC.indexOf('applyBillReceiptNewLiveTotals(');
    const coveredIdxPmw = PMW_SRC.indexOf('applyBillReceiptNewCoveredTokens(autoValues');
    expect(liveIdxPmw).toBeGreaterThan(0);
    expect(liveIdxPmw).toBeLessThan(coveredIdxPmw);
  });

  // ═══════════ D1 무접촉 가드: applyBillingFallback 일반정책 역전 금지 ═══════════

  test('D1: applyBillingFallback 은 여전히 blank-only(isBlankOrZero 가드) — 일반정책 무접촉', () => {
    expect(FB_SRC).toMatch(/isBlankOrZero/);
    // 헬퍼는 applyBillingFallback 을 호출하거나 그 가드를 우회 재정의하지 않는다(force = 직접 대입).
    const helperBody = FB_SRC.slice(
      FB_SRC.indexOf('export function applyBillReceiptNewLiveTotals'),
      FB_SRC.indexOf('export function applyBillReceiptNewLiveTotals') + 900,
    );
    expect(helperBody).not.toMatch(/applyBillingFallback/);
    expect(helperBody).toMatch(/values\.non_covered = /); // 직접 force 대입
  });

  // ═══════════ AC-4: T-20260609 회귀방지 (수납 전 출력 total_amount 누락 방지) ═══════════

  test('AC-4: PMW 두 경로 모두 grandTotal 명시 세팅 유지(bill_detail 경로 + 신양식 헬퍼)', () => {
    // 종전 T-20260609 배선(bill_detail total_amount = grandTotal) 미접촉 확인.
    expect(PMW_SRC).toMatch(/autoValues\.total_amount = formatAmount\(grandTotal\)/);
    // 신양식 헬퍼도 grandTotal(공단 포함)을 넘긴다(D3).
    expect(PMW_SRC).toMatch(/applyBillReceiptNewLiveTotals\(autoValues, \{\s*grandTotal,/);
  });
});

// ── 테스트용 최소 BillingService 목 (getTaxClass/isCodeItem 소비 필드만) ──
function mkSvc(code: string, covered: boolean) {
  return {
    id: code,
    name: code,
    service_code: code,
    hira_code: covered ? code : null,
    hira_category: null,
    hira_score: null,
    vat_type: covered ? null : 'taxable',
    is_insurance_covered: covered,
    category_label: covered ? '진찰료' : '처치',
    price: 0,
  } as unknown as FootBillingItem['service'];
}
