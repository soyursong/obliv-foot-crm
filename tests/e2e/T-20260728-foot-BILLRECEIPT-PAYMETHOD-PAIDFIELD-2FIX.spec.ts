import { test, expect } from '@playwright/test';
import {
  applyBillReceiptPaidBoxTokens,
  applyBillReceiptPreprintPaymethodTokens,
} from '../../src/lib/footBilling';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { formatAmount } from '../../src/lib/format';

/**
 * E2E/unit — T-20260728-foot-BILLRECEIPT-PAYMETHOD-PAIDFIELD-2FIX (P0 hotfix, reporter 김주연 총괄)
 *
 * 요건1 — 결제수단 금액 귀속 오류:
 *   증상: 카드 301,400원 결제인데 카드 금액란에 1,400원(잔여분)만 표기.
 *   RC(회귀): b20c88d2(REFUND200 요건2) 이후 paid_total(합계)=⑧ 환자부담총액인데 method 셀은 실수납 net 만 →
 *            선차감 케이스(선수금 300,000 + 카드 1,400)에서 합계=301,400 vs 카드=1,400 불일치.
 *   해소: 선차감분(alreadyPaid)을 주 결제수단 셀에 fold → Σ(3칸)=⑧. AC-1 카드=301,400 / AC-2 합계=⑧.
 *
 * 요건2 — '이미 납부한 금액'/'납부할 금액' 필드 제거 회귀:
 *   증상: b20c88d2 가 ⑨/⑩/'납부하지않은' 행을 양식에서 삭제. 기대: 필드(라벨+칸) 존치, 내용 없으면 공란.
 *   해소: 템플릿 3행 원복(PREPRINT 의도상태 — ⑩=공란이되 칸 존재). ⑪→⑨ 리넘버 원복.
 */

const n = (s: string | undefined): number => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

type PayRow = {
  method?: string | null;
  amount?: number | null;
  cash_receipt_issued?: boolean | null;
  payment_type?: string | null;
};

// ═══════════════════ 요건1 — 결제수단 금액 귀속 (paidbox settle 경로) ═══════════════════

test('AC-1: 선수금 300,000 + 카드 1,400 → 카드칸 = 301,400 (실카드납부총액 전액 귀속)', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'card', amount: 1400, payment_type: 'payment' }];
  // ⑧ 환자부담총액 = 301,400, alreadyPaid(선차감분) = 300,000
  applyBillReceiptPaidBoxTokens(v, pays, 301400, 300000);
  expect(n(v.card_amount)).toBe(301400);          // AC-1: 잔여분 1,400 아님
  expect(v.card_amount).not.toBe(formatAmount(1400));
  expect(v.cash_amount).toBe('');                 // 미사용 수단칸 공란
  expect(v.cashreceipt_amount).toBe('');
});

test('AC-2: 납부합계(paid_total) = 환자부담총액 & Σ(3칸)=합계 불변식', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'card', amount: 1400, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(v, pays, 301400, 300000);
  expect(n(v.paid_total)).toBe(301400);           // AC-2: 합계 = ⑧
  const cellSum = n(v.card_amount) + n(v.cash_amount) + n(v.cashreceipt_amount);
  expect(cellSum).toBe(n(v.paid_total));          // Σ(3칸) = 합계 (완납 정합)
  expect(cellSum).toBe(301400);
});

test('AC-1(현금영수증 주수단): 선수금 200,000 + 현금영수증 5,000 → 현금영수증칸 = 205,000', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'cash', amount: 5000, cash_receipt_issued: true, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(v, pays, 205000, 200000);
  expect(n(v.cashreceipt_amount)).toBe(205000);
  expect(v.card_amount).toBe('');
  expect(v.cash_amount).toBe('');
  expect(n(v.paid_total)).toBe(205000);
});

test('무회귀: 직접 단일수납(선수금無) 카드 50,000 → 카드=50,000 (fold 잔량0, 종전값 동일)', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'card', amount: 50000, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(v, pays, 50000, 0);
  expect(n(v.card_amount)).toBe(50000);
  expect(n(v.paid_total)).toBe(50000);
});

test('무회귀: genuine split(선수금無 카드 100,000 + 현금 201,400) → 각 net 보존', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [
    { method: 'card', amount: 100000, payment_type: 'payment' },
    { method: 'cash', amount: 201400, payment_type: 'payment' },
  ];
  applyBillReceiptPaidBoxTokens(v, pays, 301400, 0);
  expect(n(v.card_amount)).toBe(100000);          // breakdown 보존(단일수단 귀속 아님)
  expect(n(v.cash_amount)).toBe(201400);
  expect(n(v.card_amount) + n(v.cash_amount)).toBe(n(v.paid_total));
  expect(n(v.paid_total)).toBe(301400);
});

// ═══════════════════ 요건2 — ⑨/⑩ 필드 존치(라벨+칸), 없으면 공란 ═══════════════════

test('AC-3/4: 템플릿에 ⑨ 이미 납부한 금액 · ⑩ 납부할 금액 행 존치 + ⑪ 리넘버 원복', () => {
  const tpl = getHtmlTemplate('bill_receipt_new');
  expect(tpl).toContain('⑨ 이미 납부한 금액');
  expect(tpl).toContain('{{already_paid}}');
  expect(tpl).toContain('⑩ 납부할 금액');
  expect(tpl).toContain('{{due_amount}}');
  expect(tpl).toContain('⑪ 납부한');                // 납부한 금액 박스 ⑪로 리넘버 원복
  expect(tpl).toContain('납부하지 않은 금액');
  // 회귀 상태(⑨ 납부한 금액 = ⑪ 삭제 후 리넘버)로 되돌아가지 않음
  expect(tpl).not.toContain('⑨ 납부한');
});

test('AC-3/4: paidbox — 선차감분 ⑪로 fold → ⑨ 공란(칸 존치)·⑩ 공란·납부하지않은=0(완납)', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'card', amount: 1400, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(v, pays, 301400, 300000);
  // 요건① supersede: 선수금은 별도 ⑨ 분리표기가 아니라 ⑪(카드)로 fold → ⑨ 공란(칸은 템플릿에 존치).
  expect(v.already_paid).toBe('');                // ⑨ 공란(fold)
  expect(v.due_amount).toBe('');                  // ⑩ 공란(미사용) — 칸은 템플릿에 존재
  expect(n(v.unpaid_amount)).toBe(0);             // 납부하지않은 = 0(완납)
  // 4REQ ③ 불변식(additive): 납부합계 = ⑨(0) + ⑪(paid_total) = ⑧ 환자부담총액.
  expect(n(v.already_paid) + n(v.paid_total)).toBe(301400);
});

test('요건1 무회귀(부분수납): 선수금無 카드 60,000·⑧=100,000 → 카드=60,000·납부하지않은=40,000(허위완납 아님)', () => {
  const v: Record<string, string> = {};
  const pays: PayRow[] = [{ method: 'card', amount: 60000, payment_type: 'payment' }];
  applyBillReceiptPaidBoxTokens(v, pays, 100000, 0);
  expect(n(v.card_amount)).toBe(60000);           // fold 없음 → net 그대로(허위 완납 표기 금지)
  expect(n(v.paid_total)).toBe(60000);
  expect(n(v.unpaid_amount)).toBe(40000);         // 잔여미납 정직 표기
});

test('AC-3/4: preprint(선출력 수기체크) — ⑨=⑧, ⑩ 공란, 카드 선택 시 카드칸=⑧', () => {
  const v: Record<string, string> = {};
  applyBillReceiptPreprintPaymethodTokens(v, 301400, { method: 'card' });
  expect(n(v.already_paid)).toBe(301400);
  expect(v.due_amount).toBe('');
  expect(n(v.card_amount)).toBe(301400);
  expect(n(v.paid_total)).toBe(301400);
  expect(n(v.unpaid_amount)).toBe(0);
});

test('요건2 무회귀: 환자부담 0(무료) → ⑨/합계/납부하지않은 공란', () => {
  const v: Record<string, string> = {};
  applyBillReceiptPaidBoxTokens(v, [], 0, 0);
  expect(v.already_paid).toBe('');
  expect(v.paid_total).toBe('');
  expect(v.unpaid_amount).toBe('');
});
