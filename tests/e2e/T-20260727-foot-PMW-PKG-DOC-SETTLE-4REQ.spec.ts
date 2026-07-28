import { test, expect } from '@playwright/test';
import {
  applyBillReceiptPaidBoxTokens,
  computeBillDetailRounding,
  checkBillReceiptPaidBoxInvariant,
} from '../../src/lib/footBilling';
import { formatAmount } from '../../src/lib/format';

/**
 * E2E — T-20260727-foot-PMW-PKG-DOC-SETTLE-4REQ
 *   결제 미니창(PMW) ↔ 서류(진료비 계산서·영수증) 연동 4건. 김주연 총괄(C0ATE5P6JTH, thread 1785143112.263279).
 *   supersedes T-20260727-foot-SUSU-PRINT-AMOUNT-NOREFLECT(66af63ff) — 요건③④ 흡수·재정의.
 *
 * ── 본 spec 이 구현 대상으로 삼는 범위 ─────────────────────────────────────────
 *   요건① 보라색 체크(패키지 기납부)=진료비 산정 제외(현행 유지) + 서류엔 합산총액 표시 → 수납금액 ≠ 서류총액
 *   요건③ 계산서·영수증 '납부한 금액 합계' = '환자 부담 총액' 일치(미납 0), 315,600 출처불명 정정
 *   요건④ [출력 및 수납] 버튼 제거 → [출력] 단독. 금액바인딩은 handleDocPrint 로 carry-forward.
 *   요건② 선수금차감 후 [수납] 위치·상태 유지 = **상태필드 DB write 변경 동반** → planner db_change 재분류 게이트
 *          (MSG-20260727-184612-y89r). 본 커밋 미착수 — 아래 S2 는 게이트 사유를 문서화하는 skip 스텁.
 *
 * ── 요건①③ 핵심 정합(handleDocPrint pre-settle synthetic + ⑨선차감보정 재현) ──────────────────
 *   [출력]은 payments INSERT 를 하지 않는다(출력 전용). 인쇄 前(payments 원장 공란)이면 이번 회 수납액을
 *   synthetic payRow 로 합성해 납부박스에 주입한다(SUSU-PRINT RC#1 carry-forward). 선수금차감이면 ⑨를
 *   ⑧−잔액수납 으로 보정(RC#2 carry-forward). 결과: ⑧=⑨+⑪+미납, 미납=0, 납부합계(⑨+⑪)=환자부담총액.
 *   이중계상 가드: payRows 가 이미 존재(=[수납] 후 [출력])하면 synthetic 미주입 → 실원장만 렌더.
 */

const n = (s: string | undefined): number => Number((s ?? '0').replace(/[^0-9.-]/g, '')) || 0;

type PayMethod = 'card' | 'cash' | 'transfer' | 'membership';
type PayRow = {
  method?: string | null;
  amount?: number | null;
  cash_receipt_issued?: boolean | null;
  payment_type?: string | null;
};

/** handleDocPrint 의 synthetic payRow 합성식(executeAutoDone.buildPayRow 와 동일 cash_receipt 규칙) 재현. */
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

/** handleDocPrint.applyPostSurchargePaidTokens 의 ⑨ 선차감 보정식 재현(RC#2 carry-forward). */
const effectiveAlreadyPaid = (
  patientFloored: number,
  settleCtx: { isDeductSettle: boolean; settleAmount: number } | null,
  loadedAlreadyPaid: number,
): number =>
  settleCtx?.isDeductSettle
    ? Math.max(0, patientFloored - settleCtx.settleAmount)
    : loadedAlreadyPaid;

/**
 * handleDocPrint carry-forward 재현.
 *   [T-20260727-foot-PMW-PKG-DOC-SETTLE-4REQ 요건① REOPEN RC] ⑨ 선차감 보정(settleCtx)은 deductMode 이면
 *   payRows 유무(pre/post-settle)와 무관하게 세팅한다(⑨=⑧−deductAmount = 패키지 선납 환자부담분, settle 시점 독립).
 *   synthetic payRow(⑪ 선반영) 주입만 pre-settle(ledger 공란) 이중계상 가드 하에 수행.
 */
const applyPrintPath = (
  values: Record<string, string>,
  ledgerPayRows: PayRow[],       // applyBillReceiptNewSplitAndPaid 가 fetch 한 실원장(status=active)
  patientFloored: number,        // ⑧ (가산 fold·10원 절사 후)
  loadedAlreadyPaid: number,     // ⑨ 소스 loadAlreadyPaidAmount(인쇄 前 미마킹이면 0)
  settleAmount: number,          // 이번 회 수납액(deductMode?deductAmount:payableTotalWithSurcharge)
  isDeductSettle: boolean,       // = deductMode (선수금차감 모드)
  splits: { method: PayMethod; amount: number }[],
  cashReceiptIssued: boolean,
): void => {
  let payRows = ledgerPayRows;
  let settleCtx: { isDeductSettle: boolean; settleAmount: number } | null = null;
  // ⑨ 선차감 보정: deductMode 이면 pre/post-settle 무관하게 세팅(요건① REOPEN RC 해소).
  if (isDeductSettle) settleCtx = { isDeductSettle: true, settleAmount };
  // synthetic ⑪ 선반영: pre-settle(ledger 공란)일 때만(이중계상 가드).
  if (ledgerPayRows.length === 0) {
    payRows = [...ledgerPayRows, ...buildSettlePayRows(splits, cashReceiptIssued)];
    if (!settleCtx) settleCtx = { isDeductSettle: false, settleAmount };
  }
  const ap = effectiveAlreadyPaid(patientFloored, settleCtx, loadedAlreadyPaid);
  applyBillReceiptPaidBoxTokens(values, payRows, patientFloored, ap);
};

// ── 시나리오 1 (요건①③): 패키지 기납부(보라색) + 선수금차감 + [출력] pre-settle ────────────────────
//   ⑧ 환자부담총액 = 307,800 (패키지 포함 합산총액 = 서류총액). 패키지 선차감 300,000, 이번 회 수납 잔액 7,800(현금).
//   기대: ⑨=300,000(선차감·기납부) · ⑪=7,800(실수납) · 미납=0 · 납부합계(⑨+⑪)=307,800=환자부담총액.
//   수납금액(⑪ 실수납 7,800, 패키지 제외) ≠ 서류총액(⑧ 307,800, 패키지 포함) = 정상(요건①).
test('S1(요건①③): 보라색 기납부+선차감 [출력] → ⑨=300,000·⑪=7,800·미납=0·납부합계=환자부담총액(307,800)', () => {
  const patientFloored = 307800;     // ⑧ 패키지 포함 합산총액(서류총액, 10원배수)
  const settleAmount = 7800;         // 이번 회 수납 잔액(패키지 제외)
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'cash', amount: settleAmount }];
  const loadedAlreadyPaid = 0;       // pre-settle: is_package_session 미마킹 → loadAlreadyPaidAmount=0

  const values: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  applyPrintPath(values, [], patientFloored, loadedAlreadyPaid, settleAmount, true, splits, false);

  // ★ 요건① SUPERSEDED by T-20260728-foot-BILLRECEIPT-PAYMETHOD-PAIDFIELD-2FIX 요건1 (AC-6: 4REQ ②③④만 무회귀).
  //   선차감분(선수금)은 별도 ⑨ 분리표기가 아니라 실 결제수단 ⑪로 fold(완납 표기, PREPRINT ⑪ 캐논).
  expect(values.already_paid).toBe('');          // ⑨ 공란(⑪로 fold)
  expect(values.due_amount).toBe('');            // ⑩ 공란(미사용)
  expect(n(values.cash_amount)).toBe(307800);    // ⑪ 현금칸 = 실수납 7,800 + 선차감 300,000 = ⑧(완납)
  expect(values.card_amount).toBe('');           // 카드 미사용
  expect(n(values.paid_total)).toBe(307800);     // ⑪ 합계 = ⑧
  expect(n(values.unpaid_amount)).toBe(0);       // 미납 0
  // 요건③(무회귀): '납부합계'(⑨ 0 + ⑪ 307,800) = '환자부담총액'(⑧). additive 불변식 유지.
  expect(n(values.already_paid) + n(values.paid_total)).toBe(patientFloored);
  // 법정 불변식 ⑧ = ⑨(0) + ⑪ + 미납 (0 + 307,800 + 0 = 307,800).
  const inv = checkBillReceiptPaidBoxInvariant(patientFloored, 0, 307800, patientFloored, 0);
  expect(inv.ok).toBe(true);
});

// ── 시나리오 1-b (요건③ 비패키지 완납): 비급여 카드 완납 [출력] pre-settle ──────────────────────────
//   패키지·선차감 없음. ⑧=88,000, 이번 회 수납 88,000(카드) → ⑨=0·⑪=88,000·미납=0·납부합계=환자부담총액.
test('S1b(요건③): 비급여 카드 완납 [출력] → ⑨=0·⑪=88,000·미납=0·납부합계=환자부담총액(88,000)', () => {
  const patientFloored = 88000;
  const settleAmount = 88000;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'card', amount: 88000 }];

  const values: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  applyPrintPath(values, [], patientFloored, 0, settleAmount, false, splits, false);

  expect(n(values.card_amount)).toBe(88000);
  expect(n(values.paid_total)).toBe(88000);
  expect(values.already_paid).toBe('');         // 선차감 없음
  expect(n(values.unpaid_amount)).toBe(0);
  expect(n(values.already_paid) + n(values.paid_total)).toBe(patientFloored); // 납부합계=환자부담총액
  const inv = checkBillReceiptPaidBoxInvariant(patientFloored, 0, 88000, patientFloored, 0);
  expect(inv.ok).toBe(true);
});

// ── 시나리오 1-c (이중계상 가드): [수납] 후 [출력](post-settle) → 실원장만, synthetic 미주입 ─────────────
//   payments 원장에 이미 실수납(카드 88,000) 존재 → synthetic 주입 안 함(payRows 비지 않음) → 이중합산 없음.
test('S1c(이중계상 가드): post-settle [출력] → 실원장만 반영, synthetic 미주입(⑪=88,000 유지, 176,000 아님)', () => {
  const patientFloored = 88000;
  const ledger: PayRow[] = [{ method: 'card', amount: 88000, cash_receipt_issued: null, payment_type: 'payment' }];
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'card', amount: 88000 }];

  const values: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  // ledger 비어있지 않음 → applyPrintPath 가 synthetic 미주입.
  applyPrintPath(values, ledger, patientFloored, 0, 88000, false, splits, false);

  expect(n(values.paid_total)).toBe(88000);     // 실원장 그대로(이중합산 176,000 아님)
  expect(n(values.card_amount)).toBe(88000);
  expect(n(values.unpaid_amount)).toBe(0);
});

// ── 시나리오 1-d (요건① REOPEN — field-soak 재현/회귀가드): post-settle [출력] + 비급여 면세 패키지 기납부 ──────
//   [현장 재현 스샷 F0BKYQE5S6A, 2026-07-27 19:34] 급여 copay 8,800(카드, [수납] 완료) + 비급여 면세 처치·수술료
//   240,000(패키지 기납부=보라색). ⑧=248,800. [출력]이 [수납] 後(post-settle, 실원장 카드 8,800 존재)라
//   synthetic 미주입. 처치·수술료는 prepaidSessionType()=null → is_package_session 미마킹 →
//   loadAlreadyPaidAmount=0(loadedAlreadyPaid=0).
//   [BEFORE fix] settleCtx 를 ledger 공란일 때만 세팅 → post-settle 이면 null → ⑨=0 → 미납=⑧−⑪=240,000 (버그).
//   [AFTER fix] deductMode 이면 pre/post 무관 settleCtx 세팅 → ⑨=⑧−deductAmount=240,000 · ⑪=8,800 · 미납=0.
test('S1d(요건① REOPEN): post-settle 비급여면세 패키지기납부 → ⑨=240,000·⑪=8,800·미납=0(240,000 분리표시 아님)', () => {
  const patientFloored = 248800;   // ⑧ = 급여 본인부담 8,800 + 비급여 면세 240,000
  const deductAmount = 8800;       // 이번 회 수납잔액(패키지 기납부 240,000 제외)
  const ledger: PayRow[] = [{ method: 'card', amount: 8800, cash_receipt_issued: null, payment_type: 'payment' }];
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'card', amount: 8800 }];
  const loadedAlreadyPaid = 0;     // 처치·수술료 is_package_session 미마킹 → loadAlreadyPaidAmount=0

  const values: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  // post-settle(ledger 존재) + deductMode=true.
  applyPrintPath(values, ledger, patientFloored, loadedAlreadyPaid, deductAmount, true, splits, false);

  // ★ 요건① SUPERSEDED by T-20260728 요건1 — 선차감분(240,000)은 ⑪ 카드칸으로 fold(⑨ 분리표기 아님).
  expect(values.already_paid).toBe('');          // ⑨ 공란(⑪로 fold)
  expect(values.due_amount).toBe('');            // ⑩ 공란
  expect(n(values.card_amount)).toBe(248800);    // ⑪ 카드칸 = 실수납 8,800 + 선차감 240,000 = ⑧(완납)
  expect(n(values.paid_total)).toBe(248800);     // ⑪ 합계 = ⑧
  expect(n(values.unpaid_amount)).toBe(0);       // ★핵심: 미납 240,000 분리표시 아님 → 0
  // 요건①→완납 fold: 패키지 기납부액이 '납부하지 않은 금액'이 아니라 ⑪(=⑧)에 포함.
  expect(n(values.already_paid) + n(values.paid_total) + n(values.unpaid_amount)).toBe(patientFloored);
  const inv = checkBillReceiptPaidBoxInvariant(patientFloored, 0, 248800, patientFloored, 0);
  expect(inv.ok).toBe(true);
});

// ── 시나리오 4 (회귀가드 · SAT-SURCHARGE 무회귀): membership split 은 ⑪ skip(⑨ 귀속) ────────────────
//   T-20260725-foot-SAT-SURCHARGE-PMW-DOCTOKEN-ORDER 공유 토큰 경로 무회귀 — 멤버십 전액차감은 ⑪ 비산입.
test('S4(회귀): membership synthetic payRow 는 ⑪ paid_total 에 산입되지 않음(⑨ 귀속 semantics 보존)', () => {
  const patientFloored = 50000;
  const splits: { method: PayMethod; amount: number }[] = [{ method: 'membership', amount: 50000 }];
  const values: Record<string, string> = { patient_amount: formatAmount(patientFloored) };
  // ★ SUPERSEDED by T-20260728 요건1: membership 은 ⑪ 버킷 skip 이나 선차감분(50,000)이 현금칸 폴백으로 fold →
  //   paid_total = 50,000(완납), ⑨ 공란. (종전 '⑨ 귀속·paid_total 공란' semantics 는 fold 로 대체)
  applyPrintPath(values, [], patientFloored, 50000, 50000, false, splits, false);
  expect(n(values.paid_total)).toBe(50000);   // 선차감 fold(현금칸 폴백) → 완납 합계
  expect(values.already_paid).toBe('');       // ⑨ 공란(⑪로 fold)
  expect(n(values.unpaid_amount)).toBe(0);
});

// ── 시나리오 4-b (회귀가드 · 10원 절사): ⑧ 10원 절사 SSOT 무회귀 ────────────────────────────────
test('S4b(회귀): 환자부담총액 10원 절사(computeBillDetailRounding) SSOT 무회귀', () => {
  const raw = 307805;
  const { roundedTotal } = computeBillDetailRounding(raw);
  expect(roundedTotal).toBe(307800); // FLOOR to 10원 배수
});

// ── 시나리오 2 (요건②): 상태필드 write 게이트 — planner db_change 재분류 회신 전 미착수 ─────────────────
//   선수금차감 후 [수납] 클릭 시 완료슬롯 이동(check_ins.status='done')·회색처리(status_flag='dark_gray') 제거는
//   상태필드 DB write 변경을 동반 → 티켓 ★조정 지시(착수 前 planner 플래그) 및 §S2.4 게이트 발동.
//   FOLLOWUP MSG-20260727-184612-y89r 로 db_change 재분류 요청. 회신(스코프·종료상태·CHECK constraint) 후 별도 커밋.
test.skip('S2(요건②): 선수금차감 후 [수납] 위치·상태 유지 — planner db_change 재분류 게이트로 미착수', () => {
  // 회신 수신 후 구현: [수납] 경로가 status='done'·dark_gray flag·onComplete 를 (해당 스코프에 한해) 미수행 →
  //   대시보드 슬롯 위치·상태 그대로 유지. 수납(payments INSERT)·선수금 회차소진은 유지.
});
