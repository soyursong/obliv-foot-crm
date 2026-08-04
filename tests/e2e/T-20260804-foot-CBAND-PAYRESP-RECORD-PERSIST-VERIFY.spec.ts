import { test, expect } from '@playwright/test';
import { normalize, classify, TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';
import {
  runPaymentFlow,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY — 코밴 CAT 직결 결제/취소 응답의
 *   6필드가 그 환자 수납 기록에 정확·완전 저장되는지 결정론(WS 모킹) 검증 + 공백 폐기.
 * ────────────────────────────────────────────────────────────────────────────
 * SSOT 저장레이아웃 = da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md (external_* 착지).
 * 실결제 1건(2026-08-04 11:03:47 3,000원 AUTHNO 29258831 TID 1047538246)은 prod field-soak
 *   introspection(scripts/T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY_probe.mjs)으로 별도 검증.
 *   본 스펙 = 그 응답전문 shape 를 결정론으로 고정(실카드/취소는 물리 단말 의존 → WS 모킹).
 *
 * 검증 6필드(총괄 최필경 field): AUTHNO / TRANDATE·TRANTIME / TAMT / CARDNO(마스킹) / MERNO.
 *   · AUTHNO → payments.external_approval_no (matcher 독출=dedup 앵커)
 *   · TID    → payments.external_tid
 *   · TAMT   → payments.amount
 *   · TRANDATE → payments.accounting_date (매출일자 앵커=승인일자, INSERT/감지시각 금지 · BINDING#3)
 *   · MERNO  → payments.merchant_no (응답 파생 · 정산 중복키 · MERNO-REQFIELD-BUG deployed 정합)
 *   · CARDNO(마스킹) → ★현재 저장 공백(GAP): normalize() 미포착 + payments/attempts 표시컬럼 부재.
 *     응답전문에는 마스킹된 CARDNO 존재(아래 REAL_APPROVAL) → DA CONSULT(ADDITIVE 1컬럼) 게이트 대상.
 */

// ── 실측 정본 응답전문(실결제 shape: AUTHNO 29258831 / TID 1047538246 / 3,000원 / 260804 110347) ─
//   CARDNO 는 단말이 이미 마스킹해 반환(평문 PAN 아님) — 55318440****364* 형식.
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"110341558080",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","MSG1":"거래 승인29258831"}';
const REAL_CANCEL =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"111230","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"111225558081","MSG1":"취소거래승인29258831"}';

// ── in-memory AttemptStore (recordCardPayment 로 흘러가는 6필드 원천 관측) ──────
function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string; attemptId: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) {
      const id = `attempt-${++seq}`;
      attempts.set(rec.msgTrace, { ...rec });
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
    },
    async recordCardPayment(rec) {
      payments.push(rec);
    },
  };
  return { store, attempts, payments };
}
const mockSender = (raw: string | null, timedOut = false) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut, msgTrace }));

const BASE = {
  tid: '1047538246', merno: '', catPort: 'COM3',
  clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1',
};

test.describe('CBAND 결제/취소 응답 6필드 수납기록 영속 검증', () => {
  test('AC-1 정상결제: normalize 가 6필드(AUTHNO/TID/TAMT/TRANDATE/TRANTIME/MERNO)를 정확 추출', () => {
    const r = normalize(JSON.parse(REAL_APPROVAL));
    expect(classify(r)).toBe('APPROVED');
    expect(r.authNo).toBe('29258831');              // AUTHNO → external_approval_no
    expect(r.amount).toBe(3000);                    // TAMT → amount
    expect(r.tranDate).toBe('260804');              // TRANDATE → accounting_date 앵커
    expect(r.tranTime).toBe('110347');              // TRANTIME (승인시각)
    expect(r.merno).toBe('00113742229');            // MERNO → merchant_no (정산 중복키)
    expect(r.tranType).toBe('0210');
    // ★AC-5/AC-6(DA §7): CARDNO(마스킹) verbatim 캡처 → payments.card_no_masked 착지(공백 폐기).
    expect(r.cardNoMasked).toBe('55318440****364*'); // 단말 마스킹값 그대로(재-mask/un-mask 없음)
  });

  test('AC-1 정상결제: recordCardPayment 가 external_* 착지 6필드 원천을 완전 수신', async () => {
    const { store, payments } = makeMemStore();
    const res = await runPaymentFlow(
      { ...BASE, tranType: TRANTYPE_APPROVE, amount: 3000 }, store, mockSender(REAL_APPROVAL),
    );
    expect(res.classification).toBe('APPROVED');
    expect(res.authNo).toBe('29258831');
    expect(res.approvalDate).toBe('260804');
    expect(res.approvalTime).toBe('110347');
    expect(payments).toHaveLength(1);
    const p = payments[0];
    // ★3-way canon: AUTHNO/TID/TAMT/승인일자/attemptId(FK) + MERNO(응답 파생) 원천 모두 존재.
    expect(p.authNo).toBe('29258831');              // → payments.external_approval_no
    expect(p.tid).toBe('1047538246');               // → payments.external_tid
    expect(p.amount).toBe(3000);                    // → payments.amount
    expect(p.approvalDate).toBe('260804');          // → payments.accounting_date (INSERT시각 금지)
    expect(p.rawResponse?.merno).toBe('00113742229'); // → payments.merchant_no (MERNO-REQFIELD-BUG 경로)
    expect(p.rawResponse?.cardNoMasked).toBe('55318440****364*'); // → payments.card_no_masked (DA §7, 마스킹 verbatim)
    expect(p.attemptId).toBeTruthy();               // → payments.payment_attempt_id (CAT-origin 판별자)
    expect(p.tranType).toBe('0210');
  });

  test('AC-2 결제취소: AUTHNO 동일·TRANTYPE 0430 판별 → refund 수납기록 원천', async () => {
    const { store, payments } = makeMemStore();
    const res = await runPaymentFlow(
      { ...BASE, checkInId: 'ci-cancel', tranType: TRANTYPE_CANCEL, amount: 3000, originalAuthNo: '29258831' },
      store, mockSender(REAL_CANCEL),
    );
    expect(res.classification).toBe('APPROVED');    // 취소전문 성공 = 정상 흐름
    expect(res.authNo).toBe('29258831');            // 취소 AUTHNO = 원거래 동일(실측#2)
    const p = payments[0];
    expect(p.tranType).toBe('0430');                // store 가 payment_type='refund' 로 기록(구분자)
    expect(p.authNo).toBe('29258831');
    expect(p.amount).toBe(3000);
    // normalize 는 취소전문의 TRANTYPE 로 원거래와 구분(AUTHNO 는 동일).
    const nr = normalize(JSON.parse(REAL_CANCEL));
    expect(nr.tranType).toBe('0430');
    expect(nr.authNo).toBe('29258831');
  });

  test('AC-3 매출일자 앵커 = 승인일자(TRANDATE), INSERT/감지 시각 아님', async () => {
    const { store, payments } = makeMemStore();
    await runPaymentFlow({ ...BASE, tranType: TRANTYPE_APPROVE, amount: 3000 }, store, mockSender(REAL_APPROVAL));
    // approvalDate(TRANDATE=260804)가 recordCardPayment 로 전달 → store 가 accounting_date 로 착지(UPDATE).
    expect(payments[0].approvalDate).toBe('260804');
  });

  test('AC-5 CARDNO 는 마스킹 형식으로만 응답(평문 PAN 아님) — 미마스킹 PAN 미출현', () => {
    const r = normalize(JSON.parse(REAL_APPROVAL));
    const cardno = String((r.raw as Record<string, unknown>).CARDNO ?? '').trim();
    // 마스킹 표기(* 포함) 확인 — 평문 16자리 연속 PAN 아님.
    expect(cardno).toContain('*');
    expect(/^\d{13,19}$/.test(cardno.replace(/[ *]/g, ''))).toBe(false);
  });

  test('AC-6(공백 폐기): 마스킹 CARDNO 구조화 캡처 완결 + 평문 PAN 은 캡처 안 함(null)', () => {
    // ★DA §7 GO 착지 후: normalize 가 마스킹 CARDNO 를 구조화 필드로 포착(과거 GAP 폐기).
    const r = normalize(JSON.parse(REAL_APPROVAL));
    expect(r.cardNoMasked).toBe('55318440****364*');
    // ★평문 PAN(마스킹 마커 없음)은 캡처하지 않는다(payments.card_no_masked 평문 유입 구조 차단, DA §7-3).
    const plain = normalize({ ...JSON.parse(REAL_APPROVAL), CARDNO: '4111111111111111' });
    expect(plain.cardNoMasked).toBeNull();
    // X 마스킹 변형도 verbatim 캡처.
    const xMask = normalize({ ...JSON.parse(REAL_APPROVAL), CARDNO: '5531-84XX-XXXX-364*' });
    expect(xMask.cardNoMasked).toBe('5531-84XX-XXXX-364*');
    // CARDNO 부재 시 null.
    const noCard = normalize({ ERRCODE: '0000', AUTHNO: '29258831' });
    expect(noCard.cardNoMasked).toBeNull();
  });

  test('AC-7 TRANSERIAL(MSG_TRACE) 송·수신 대사: 응답 TRANSERIAL 이 msgTrace 로 포착(raw_response 감사보존)', () => {
    // 송신측 MSG_TRACE(attempt.msg_trace) ↔ 수신측 TRANSERIAL(raw_response) 대사 가능 = 응답 raw 에 TRANSERIAL 보존.
    const r = normalize(JSON.parse(REAL_APPROVAL));
    expect(r.msgTrace).toBe('110341558080');                 // TRANSERIAL → normalize.msgTrace (수신 대사 키)
    expect((r.raw as Record<string, unknown>).TRANSERIAL).toBe('110341558080'); // raw_response(cband_payment_attempts) 감사보존
  });

  test('AC-9 응답 원문 JSON 감사보존: normalize.raw 가 응답 전 필드를 보존(→ cband_payment_attempts.raw_response)', () => {
    const r = normalize(JSON.parse(REAL_APPROVAL));
    // 응답 원문 전 키가 raw 에 보존됨(감사·분쟁 대비). 착지홈 = cband_payment_attempts.raw_response(PCI 가드).
    for (const k of ['ERRCODE', 'TRANTYPE', 'AUTHNO', 'TAMT', 'TRANDATE', 'TRANTIME', 'MERNO', 'TRANSERIAL', 'CARDNO']) {
      expect((r.raw as Record<string, unknown>)[k]).toBeDefined();
    }
    // ★raw 에 보존되는 CARDNO 는 단말 마스킹값(평문 PAN 아님) — PCI 가드(∃*/non-Luhn) 자연통과.
    expect(String((r.raw as Record<string, unknown>).CARDNO)).toContain('*');
  });

  test('AC-8 취소-메타: 취소 응답이 취소 승인번호 + 취소 일시를 원거래 연결용으로 완전 반송', () => {
    // ★이 티켓이 취소-메타 스키마 owner(기존 foot refund 컬럼 재사용, 신규 DDL 없음):
    //   취소승인번호=external_approval_no(=원거래 AUTHNO), 취소일시=cancelled_at/accounting_date(취소 TRANDATE·TRANTIME),
    //   원거래 연결=parent_payment_id/linked_payment_id(기존 컬럼). 실 write 는 ②(TERMINAL-CANCEL-S1-BTN).
    const nr = normalize(JSON.parse(REAL_CANCEL));
    expect(nr.tranType).toBe('0430');            // 취소 판별자(원거래와 AUTHNO 동일이므로 TRANTYPE 으로 구분)
    expect(nr.authNo).toBe('29258831');          // 취소 승인번호(= 원거래 동일) → refund.external_approval_no
    expect(nr.tranDate).toBe('260804');          // 취소 일자 → refund.accounting_date / origin_tx_date 대사
    expect(nr.tranTime).toBe('111230');          // 취소 시각(원거래 110347 과 다름 = 취소 일시 구분자)
    expect(nr.amount).toBe(3000);                // 취소 금액 = 원거래 동일
  });
});
