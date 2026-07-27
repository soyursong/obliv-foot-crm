import { test, expect } from '@playwright/test';
import {
  applyBillReceiptPaidBoxTokens,
  computeBillDetailRounding,
  checkBillReceiptPaidBoxInvariant,
} from '../../src/lib/footBilling';
import { formatAmount } from '../../src/lib/format';

/**
 * E2E — T-20260727-foot-SUSU-PRINT-AMOUNT-NOREFLECT
 *   진료비 계산서·영수증 [출력 및 수납] 클릭 시 발행 서류(신양식 bill_receipt_new)의 납부박스에
 *   결제 금액(⑪ 납부한 금액·카드/현금/합계)이 반영되지 않고 미납=전액으로 찍히는 현장증상.
 *
 * ── RC ──────────────────────────────────────────────────────────────────────
 *   PaymentMiniWindow.handleDocAndSettle 는 인쇄(applyBillReceiptPaidBoxTokens)를
 *   executeAutoDone(payments INSERT) **前** 에 실행한다. 그래서 applyBillReceiptNewSplitAndPaid 가
 *   fetch 하는 payments 원장(status=active)엔 이번 수납분이 아직 없다 → payRows=[] →
 *   ⑪ paid_total/card_amount/cash_amount 공란, 미납 = 환자부담총액 전액.
 *   (handleDocPrint(출력 전용)은 수납이 없으므로 미납=전액이 정상 — 본 티켓 범위 밖.)
 *
 * ── FIX ─────────────────────────────────────────────────────────────────────
 *   이번에 확정될 splits 를 executeAutoDone.buildPayRow 와 동일한 cash_receipt 규칙으로 synthetic
 *   payRow 로 합성해 fetch 된 payRows 에 append → 납부박스가 실수납을 반영. DB write 는 여전히
 *   executeAutoDone 단일 SSOT(이중수납 없음).
 *
 * 본 spec 은 handleDocAndSettle 이 소비하는 **실제 SSOT 헬퍼**(applyBillReceiptPaidBoxTokens)와
 *   FE 의 synthetic-payRow 합성식을 그대로 재현해, (a) 버그 상태(payRows=[]) 재현 + (b) 수정 상태
 *   (synthetic append) 정합을 각각 검증한다. 헬퍼+합성식 계약이 곧 인쇄본 납부박스의 정합성.
 */

const n = (s: string | undefined): number => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

type PayMethod = 'card' | 'cash' | 'transfer' | 'membership';
type PayRow = {
  method?: string | null;
  amount?: number | null;
  cash_receipt_issued?: boolean | null;
  payment_type?: string | null;
};

/** handleDocAndSettle 의 synthetic payRow 합성식(executeAutoDone.buildPayRow 와 동일 cash_receipt 규칙) 재현. */
const buildSettlePayRows = (
  splits: { method: PayMethod; amount: number }[],
  cashReceiptIssued: boolean,
): PayRow[] =>
  splits.map((s) => {
    const isCashLike = s.method === 'cash' || s.method === 'transfer';
    return {
      method: s.method as string,
      amount: s.amount,
      cash_receipt_issued: isCashLike ? cashReceiptIssued : null,
      payment_type: 'payment' as const,
    };
  });

// ── 시나리오 1: 비급여 단건 카드 수납 (본인부담총액 = 88,000, 선차감 없음) ────────────────
//   ⑧ patient_amount = 88,000 / ⑨ already_paid = 0 / splits = [{card, 88,000}]
test('S1: 비급여 단건 카드 [출력및수납] → 납부박스 ⑪=88,000·카드=88,000·미납=0 (수정 후)', () => {
  const patientAmount = 88000;
  const alreadyPaid = 0;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'card', amount: 88000 }];

  // (a) 버그 재현 — 인쇄가 수납 前이라 payRows=[] → ⑪ 공란, 미납=전액.
  const bug: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  applyBillReceiptPaidBoxTokens(bug, [], patientAmount, alreadyPaid);
  expect(bug.paid_total).toBe('');          // ⑪ 공란 (결제 금액 미반영 = 현장증상)
  expect(bug.card_amount).toBe('');
  expect(n(bug.unpaid_amount)).toBe(88000);  // 미납=전액

  // (b) 수정 — splits synthetic append → ⑪=전액, 카드=전액, 미납=0.
  const fixed: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  const payRows = [...[], ...buildSettlePayRows(splits, false)]; // fetch(prior)=[] + synthetic
  applyBillReceiptPaidBoxTokens(fixed, payRows, patientAmount, alreadyPaid);
  expect(n(fixed.card_amount)).toBe(88000);   // ⑪ 카드칸 = 실수납
  expect(n(fixed.paid_total)).toBe(88000);    // ⑪ 합계 = 실수납
  expect(n(fixed.prepaid_amount)).toBe(88000); // 구 토큰 호환(=paid_total)
  expect(n(fixed.unpaid_amount)).toBe(0);      // 미납=0(완납)
  // 불변식 ⑧ = ⑨ + ⑪ + 미납
  const inv = checkBillReceiptPaidBoxInvariant(patientAmount, 0, 88000, patientAmount, 0);
  expect(inv.ok).toBe(true);
});

// ── 시나리오 2: 선수금차감(패키지) 잔액 현금 수납 (급여 본인 + 비급여 혼재, 이중계상 가드) ──────
//   ⑧ patient_amount = 29,380 / ⑨ already_paid = 20,580(패키지 선차감분) / splits = [{cash, 8,800}] 잔액
//   → ⑪ cash = 8,800 / 미납 = 0. 선차감분은 ⑨에만(이중계상 없음).
test('S2: 선수금차감 잔액 현금 [출력및수납] → ⑨선차감·⑪잔액 분리·미납=0·이중계상 없음 (수정 후)', () => {
  const patientAmount = 29380;
  const alreadyPaidRaw = 20580;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'cash', amount: 8800 }];
  // ⑨ 는 호출부와 동일 10원 절사(computeBillDetailRounding) 적용됨.
  const alreadyPaidSafe = computeBillDetailRounding(alreadyPaidRaw).roundedTotal;

  // (a) 버그 재현 — payRows=[] → ⑪ 공란, 미납 = ⑧−⑨ = 잔액 전액(수납했는데 미납으로 찍힘).
  const bug: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  applyBillReceiptPaidBoxTokens(bug, [], patientAmount, alreadyPaidRaw);
  expect(bug.paid_total).toBe('');
  expect(n(bug.unpaid_amount)).toBe(patientAmount - alreadyPaidSafe); // 8,800 미납 오표기

  // (b) 수정 — 잔액 synthetic 현금 payRow append → ⑪ 현금=8,800, 미납=0. ⑨는 선차감분 유지.
  const fixed: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  const payRows = buildSettlePayRows(splits, false); // 현금(현금영수증 미발급)
  applyBillReceiptPaidBoxTokens(fixed, payRows, patientAmount, alreadyPaidRaw);
  expect(n(fixed.already_paid)).toBe(alreadyPaidSafe); // ⑨ 선차감분(패키지)
  expect(n(fixed.cash_amount)).toBe(8800);             // ⑪ 현금칸 = 잔액 실수납
  expect(fixed.card_amount).toBe('');                  // 카드 미사용
  expect(n(fixed.paid_total)).toBe(8800);              // ⑪ 합계 = 잔액(선차감분과 분리 → 이중계상 없음)
  expect(n(fixed.unpaid_amount)).toBe(0);              // ⑩(=⑧−⑨=8,800) − ⑪(8,800) = 0
  // 불변식 ⑧ = ⑨ + ⑪ + 미납 (선차감분 + 잔액수납 = 환자부담총액)
  const dueAmount = Math.max(0, patientAmount - alreadyPaidSafe);
  const inv = checkBillReceiptPaidBoxInvariant(patientAmount, alreadyPaidSafe, 8800, dueAmount, 0);
  expect(inv.ok).toBe(true);
});

// ── 회귀 가드: membership split 은 ⑪에서 skip(⑨로 귀속) — 합성해도 무영향 ──────────────
test('regression: membership synthetic payRow 는 ⑪ paid_total 에 산입되지 않음(⑨ 귀속 semantics 보존)', () => {
  const patientAmount = 50000;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'membership', amount: 50000 }];
  const values: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  applyBillReceiptPaidBoxTokens(values, buildSettlePayRows(splits, false), patientAmount, 50000);
  // membership 은 ⑪(card/cash/paid_total)에서 skip → paid_total 공란. 완납은 ⑨(already_paid)로 표기.
  expect(values.paid_total).toBe('');
  expect(n(values.already_paid)).toBe(50000);
  expect(n(values.unpaid_amount)).toBe(0);
});
