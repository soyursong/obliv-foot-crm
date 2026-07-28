import { test, expect } from '@playwright/test';
import { copayFromBase, getBaseCopayRate } from '../../src/lib/copayCalc';
import { applyBillReceiptPaidBoxTokens } from '../../src/lib/footBilling';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { formatAmount } from '../../src/lib/format';

/**
 * E2E/unit — T-20260727-foot-PMW-REFUND200-DOCUNPAID-2BUG (P1, 김주연 총괄 field-soak 후속)
 *
 * 요건(1) 환불 예상금 200원 오산정:
 *   RC = resettle_insurance_grade 의 기징수(잠정 30%) 재구성이 CEIL(절상)로 계산되어, 실제 잠정청구
 *        (copayFromBase general path = FLOOR, ratified canon CIT-2026-001/002)와 100원 divergence.
 *        base×0.30=8,812.5 → 실청구/화면=FLOOR 8,800 vs RPC=CEIL 8,900. 확정 8,700 → 환불 200(오산정),
 *        참값 100. 정정: migration 20260727213000 (CEIL→FLOOR). 본 spec 은 RPC 가 미러해야 하는 SSOT
 *        (copayFromBase FLOOR)와 200↔100 산술을 락(lock)한다.
 *
 * 요건(2) 보라색(패키지 기결제) 항목 서류 '납부하지 않은 금액' 오분류:
 *   수정 = 진료비 계산서·영수증 신양식에서 이미납부/납부할/납부하지않은 분리 표기 제거 + '납부한 금액(합계)'
 *          = 환자부담 총액과 동일 금액(완납 표기). 4REQ ①(총액 포함)·③(납부합계=환자부담총액) 회귀 없음.
 *   케이스: 김다예 #F-5238 (선수금 pkg + 환불 혼재) 서류 정상 출력.
 */

const n = (s: string | undefined): number => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

type PayRow = {
  method?: string | null;
  amount?: number | null;
  cash_receipt_issued?: boolean | null;
  payment_type?: string | null;
};

// 재정산 환불 산식(참값) — RPC 미러: refund = max(0, 기징수(FLOOR) − 확정본인부담)
function refundFromProvisional(base: number, confirmedCopay: number): number {
  const provisionalFloor = copayFromBase('general', base, getBaseCopayRate('general'), false);
  return Math.max(0, provisionalFloor - confirmedCopay);
}

// ── 요건(1): 기징수(잠정 30%)는 FLOOR(ratified canon) — CEIL 이면 환불 오산정 ──────────────
test('요건1: base×0.30=8,812.5 → 기징수 FLOOR=8,800 (CEIL 8,900 아님)', () => {
  const base = 29375; // ×0.30 = 8,812.5
  const provisionalFloor = copayFromBase('general', base, getBaseCopayRate('general'), false);
  expect(provisionalFloor).toBe(8800);            // FLOOR (실 잠정청구·화면표시 정합)
  expect(provisionalFloor).not.toBe(8900);        // CEIL(drift) 재발 금지
  // CEIL 재구성값 = 8,900 (drift, 참조용)
  const ceilProv = Math.min(Math.ceil((base * 0.30) / 100) * 100, base);
  expect(ceilProv).toBe(8900);
});

test('요건1: 환불 예상 = 100(참값) — CEIL 경로의 200 오산정 재현 불가', () => {
  const base = 29375;
  const confirmedCopay = 8700;
  // 정정(FLOOR) 경로: 8,800 − 8,700 = 100
  expect(refundFromProvisional(base, confirmedCopay)).toBe(100);
  // drift(CEIL) 경로: 8,900 − 8,700 = 200 (오산정 — 이 값이 나오면 RC 재발)
  const ceilProv = Math.min(Math.ceil((base * 0.30) / 100) * 100, base);
  expect(Math.max(0, ceilProv - confirmedCopay)).toBe(200);
  // 정정 경로가 200을 내지 않음을 확정.
  expect(refundFromProvisional(base, confirmedCopay)).not.toBe(200);
});

test('요건1: FLOOR 경로 환불액 ≤ 기징수액 불변식 유지(over-refund 방향 축소)', () => {
  const base = 29375;
  const confirmedCopay = 8700;
  const provisionalFloor = copayFromBase('general', base, getBaseCopayRate('general'), false);
  const refund = refundFromProvisional(base, confirmedCopay);
  expect(refund).toBeLessThanOrEqual(provisionalFloor); // 8800 이하
  expect(refund).toBeLessThanOrEqual(200);              // CEIL 경로보다 크지 않음(안전 방향)
});

// ★★ SUPERSEDED by T-20260728-foot-BILLRECEIPT-PAYMETHOD-PAIDFIELD-2FIX 요건2 (reporter 김주연 총괄) ★★
//   본 티켓(요건2)의 '분리 표기 3행 제거'는 현장 회귀("양식을 왜 건드려")로 원복됨. ⑨/⑩/납부하지않은 행 재존치.
//   아래 4개 테스트는 원복 後 기대치(칸 존치 + 선차감분 ⑪ fold, ⑨/⑩ 공란)로 갱신. REFUND200 요건1(마이그)은 무변경.

// ── [원복] 템플릿: ⑨/⑩/납부하지않은 행 재존치 + 납부한 금액(⑪) 유지 ──────────────────────────
test('요건2[템플릿·원복]: bill_receipt_new — ⑨ 이미납부·⑩ 납부할·납부하지않은 행 재존치, ⑪ 납부한 금액 유지', () => {
  const tpl = getHtmlTemplate('bill_receipt_new');
  expect(tpl).toBeTruthy();
  const html = tpl as string;
  expect(html).toContain('이미 납부한 금액');
  expect(html).toContain('납부할 금액');
  expect(html).toContain('납부하지 않은 금액');
  expect(html).toContain('{{already_paid}}');
  expect(html).toContain('{{due_amount}}');
  expect(html).toContain('{{unpaid_amount}}');
  expect(html).toContain('납부한');
  expect(html).toContain('{{paid_total}}');
  expect(html).toContain('{{card_amount}}');
});

// ── [원복+fold] 카드 완납(선수금無) → 카드=⑧·합계=⑧, ⑨/⑩ 공란, 미납=0 ────────────────────
test('요건2[AC3·원복]: 카드 완납(선수금無) → paid_total=환자부담총액, ⑨/⑩ 공란, 미납=0', () => {
  const values: Record<string, string> = {};
  const patientAmount = 88000;
  const payRows: PayRow[] = [{ method: 'card', amount: 88000, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(values, payRows, patientAmount, 0);
  expect(n(values.paid_total)).toBe(patientAmount);
  expect(n(values.card_amount)).toBe(88000);
  expect(values.already_paid).toBe('');       // ⑨ 공란(선차감 없음)
  expect(values.due_amount).toBe('');         // ⑩ 공란(미사용)
  expect(n(values.unpaid_amount)).toBe(0);    // 납부하지않은 = 0(완납, 칸 존치)
});

// ── [원복+fold] 보라색(패키지 기결제 membership) → ⑪로 fold, 합계=⑧, 미납=0 ──────────────
test('요건2[보라색·원복]: 패키지 기결제(membership)+선차감 → ⑪ fold(현금칸)=⑧, 합계=⑧, 미납=0', () => {
  const values: Record<string, string> = {};
  const patientAmount = 240000;
  // membership(패키지 전액차감)은 ⑪ 버킷 제외 → paidTotal net=0, 선차감 240,000 fold(폴백 현금칸).
  const payRows: PayRow[] = [{ method: 'membership', amount: 240000, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(values, payRows, patientAmount, 240000);
  expect(n(values.paid_total)).toBe(patientAmount); // Σ(셀) = 선차감 fold = ⑧
  expect(n(values.unpaid_amount)).toBe(0);
  expect(values.already_paid).toBe('');             // ⑨ 공란(⑪로 fold)
  expect(values.due_amount).toBe('');
});

// ── [원복+fold] F-5238 유사: 선수금 pkg + 부분 환불 혼재 → 합계=⑧, 미납=0 ──────────────
test('요건2[F-5238·원복]: 선수금 pkg + 부분 환불 혼재 → paid_total=환자부담총액, ⑨/⑩ 공란, 미납=0', () => {
  const values: Record<string, string> = {};
  const patientAmount = 229520; // 선수금 240,000 − 환불 10,480 = 229,520(예시), alreadyPaid=환자부담분
  const payRows: PayRow[] = [
    { method: 'membership', amount: 240000, payment_type: 'payment' },
    { method: 'card', amount: 10480, payment_type: 'refund' }, // 환불(순액 차감) → card net −10,480
  ];
  // net: card = −10,480(환불) → 0 미만은 셀 미표기. 선차감(229,520) fold → 완납.
  applyBillReceiptPaidBoxTokens(values, payRows, patientAmount, 229520);
  expect(n(values.paid_total)).toBe(patientAmount);
  expect(values.already_paid).toBe('');
  expect(values.due_amount).toBe('');
  expect(n(values.unpaid_amount)).toBe(0);
});
