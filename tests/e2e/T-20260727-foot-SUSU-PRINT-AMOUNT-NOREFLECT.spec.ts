import { test, expect } from '@playwright/test';
import {
  applyBillReceiptPaidBoxTokens,
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

/**
 * handleDocAndSettle.applyPostSurchargePaidTokens 의 ⑨(이미 납부한 금액) 선차감 보정식 재현.
 *   [RC#2] loadAlreadyPaidAmount 는 check_in_services.is_package_session=true 를 읽는데 그 플래그는 소비
 *   RPC(executeAutoDone 안·인쇄 後)가 SET → 출력및수납 인쇄 시점엔 ⑨=0. 선차감(isDeductSettle)이면
 *   ⑨ = ⑧(patientFloored) − 잔액수납(settleAmount) 로 확정.
 */
const effectiveAlreadyPaid = (
  patientFloored: number,
  settleCtx: { isDeductSettle: boolean; settleAmount: number } | null,
  loadedAlreadyPaid: number,
): number =>
  settleCtx?.isDeductSettle
    ? Math.max(0, patientFloored - settleCtx.settleAmount)
    : loadedAlreadyPaid;

// ── 시나리오 2 (★확정 repro): 선수금차감(패키지) [출력및수납] — 이아현 #F-5227 케이스 ─────────────
//   ⑧ 환자부담총계 307,800 / 패키지 선차감 300,000 / 차감 후 실수납 잔액 7,800(현금).
//   기대: ⑨ 300,000(선차감) · ⑩ 7,800 · ⑪ 현금 7,800 · 미납 0. loadAlreadyPaidAmount 는 인쇄시점 0.
test('S2(fold): 패키지 선차감 [출력및수납] → 선차감 300,000이 현금칸 fold, 현금=307,800(완납)·미납=0', () => {
  // ★ SUPERSEDED by T-20260728 요건1: 선차감분(300,000)은 별도 ⑨ 분리표기가 아니라 실 결제수단(현금)칸으로 fold.
  const patientFloored = 307800;        // ⑧ 환자부담총액(급여 전액분 포함, 10원배수)
  const settleAmount = 7800;            // 차감 후 실수납(잔액) = deductAmount
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'cash', amount: settleAmount }];
  const settleCtx = { isDeductSettle: true, settleAmount };
  const loadedAlreadyPaid = 0;          // 인쇄 前 is_package_session 미마킹 → loadAlreadyPaidAmount=0

  // (a) 버그 재현 — payRows=[], 선차감 미반영: ⑨/⑩ 공란(칸 존치), ⑪ 공란, 미납=전액(선차감·실수납 미반영).
  const bug: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  applyBillReceiptPaidBoxTokens(bug, [], patientFloored, loadedAlreadyPaid);
  expect(bug.already_paid).toBe('');          // ⑨ 공란
  expect(bug.paid_total).toBe('');            // ⑪ 공란(실수납·선차감 미반영)
  expect(bug.due_amount).toBe('');            // ⑩ 공란(미사용)
  expect(n(bug.unpaid_amount)).toBe(307800);  // 미납 = 전액(선차감·실수납 모두 미반영) = 현장증상

  // (b) 수정 — ⑨ 보정(patientFloored−잔액) + 잔액 synthetic 현금 payRow → 선차감이 현금칸에 fold.
  const fixed: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  const ap = effectiveAlreadyPaid(patientFloored, settleCtx, loadedAlreadyPaid); // = 300,000
  const payRows = [...[], ...buildSettlePayRows(splits, false)];                  // fetch(prior)=[] + synthetic
  applyBillReceiptPaidBoxTokens(fixed, payRows, patientFloored, ap);
  expect(fixed.already_paid).toBe('');        // ⑨ 공란(⑪로 fold)
  expect(fixed.due_amount).toBe('');          // ⑩ 공란(미사용)
  expect(n(fixed.cash_amount)).toBe(307800);  // ⑪ 현금칸 = 실수납 7,800 + 선차감 300,000 = ⑧(완납)
  expect(fixed.card_amount).toBe('');         // 카드 미사용
  expect(n(fixed.paid_total)).toBe(307800);   // ⑪ 합계 = ⑧
  expect(n(fixed.unpaid_amount)).toBe(0);     // 완납
  // 법정 불변식 ⑧ = ⑨(0) + ⑪ + 미납 (0 + 307,800 + 0 = 307,800)
  const inv = checkBillReceiptPaidBoxInvariant(patientFloored, 0, 307800, patientFloored, 0);
  expect(inv.ok).toBe(true);
});

// ── 회귀 가드: membership 은 ⑪ 버킷 skip 이나 선차감분은 폴백 현금칸으로 fold(완납) ──────────────
test('regression(fold): membership synthetic → ⑪ 버킷 skip·선차감 폴백 현금칸 fold → 합계=50,000(완납)', () => {
  // ★ SUPERSEDED by T-20260728 요건1: membership 은 ⑪(card/cash/cashreceipt) 버킷 제외(이중계상 방지) 유지하되,
  //   선차감분(50,000)이 실수납 net 0 → 폴백 현금칸으로 fold → 완납 표기(⑨ 분리표기 아님).
  const patientAmount = 50000;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'membership', amount: 50000 }];
  const values: Record<string, string> = { patient_amount: formatAmount(patientAmount) };
  applyBillReceiptPaidBoxTokens(values, buildSettlePayRows(splits, false), patientAmount, 50000);
  expect(n(values.paid_total)).toBe(50000);   // 선차감 fold(폴백 현금칸) → 완납 합계
  expect(values.already_paid).toBe('');        // ⑨ 공란(⑪로 fold)
  expect(n(values.unpaid_amount)).toBe(0);
});
