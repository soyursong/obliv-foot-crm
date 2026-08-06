import { test, expect } from '@playwright/test';
import {
  buildMsg,
  normalize,
  safeParse,
  formatHalbu,
  formatInstallmentKo,
  CBAND_INSTALLMENT_MIN_AMOUNT,
  CBAND_HALBU_LUMPSUM,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';
import {
  approve,
  cancel,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT — 플랜A 할부 지원(승인+취소 동시)
 * ────────────────────────────────────────────────────────────────────────────
 * 현장 클릭 시나리오(티켓 §현장 클릭 시나리오)를 결정론 unit 으로 고정한다.
 * 실 카드 승인/취소·태블릿 터치·단말 물리 동작 = field-soak(총괄, 갤탭 실기기 confirm).
 *
 * 커버:
 *  · 시나리오1: 할부(3개월) 결제 → HALBU="03" 전송 + payments.installment=3 착지.
 *  · 시나리오2-①: 일시불 → HALBU="00"(회귀 없음).
 *  · 시나리오2-②: 취소 → HALBU=원거래 동일값("03"), ORI_AUTHNO/ORI_DATE/TAMT 원거래 참조, refund installment=3(복원).
 *  · 시나리오2-③: 5만원↑ 할부.
 *  · spec ①: 5만원 미만 할부 잠금 임계(CBAND_INSTALLMENT_MIN_AMOUNT).
 *  · spec ②: 한글표기 파생(formatInstallmentKo).
 *  · spec ③: 요청 HALBU(formatHalbu 파생) + 응답 HALBU(normalize echo) 둘 다 확보.
 *
 * 실측 근거(MSG-20260806-121820-iyn7): 승인 HALBU"03"→응답0000/TRANTYPE0210/AUTHNO00328697/응답HALBU"03".
 *   취소 HALBU"03"(원거래동일)→0000/TRANTYPE0430/AUTHNO00328697/ORI_DATE"260806"/ORI_AUTHNO"00328697".
 */

// ── 실측 정본 응답 원문(MSG-iyn7, 3개월 할부 승인/취소) ─────────────────────────
const REAL_APPROVAL_3M =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"002670000","TRANDATE":"260806","TRANTIME":"125629","AUTHNO":"00328697    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000759",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","MSG1":"거래 승인00328697"}';
const REAL_CANCEL_3M =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"002670000","TRANDATE":"260806","TRANTIME":"125822","AUTHNO":"00328697    ",' +
  '"ORI_DATE":"260806","ORI_AUTHNO":"00328697","MERNO":"00918554560    ",' +
  '"TRANSERIAL":"104421000760","MSG1":"거래 취소00328697"}';
const REAL_APPROVAL_LUMP =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000005100","TRANDATE":"260806","TRANTIME":"130000","AUTHNO":"00328700    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000761","MSG1":"거래 승인00328700"}';

// ── in-memory AttemptStore (payments.installment 착지 관측) ────────────────────
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
      // ★store 계약: paymentFlow 가 넘긴 rec 를 그대로 관측(supabaseAttemptStore 는 installment=installmentMonths 착지).
      payments.push(rec);
    },
  };
  return { store, attempts, payments };
}

const mockSender = (raw: string | null, timedOut = false) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut, msgTrace }));

const BASE = {
  tid: 'TID12345678',
  merno: '00918554560',
  catPort: 3,
  clinicId: 'clinic-foot',
  customerId: 'cust-1',
  checkInId: 'ci-1',
};

test.describe('T-20260805 PLANA 할부 — 조립(HALBU 가변 전송)', () => {
  test('시나리오1: 3개월 할부 → body.HALBU="03"', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 2670000, catPort: BASE.catPort, msgTrace: '111122223333',
      installmentMonths: 3,
    });
    expect(body.HALBU).toBe('03');
    expect(body.TAMT).toBe('002670000');
  });

  test('시나리오2-①: 일시불(회귀) → body.HALBU="00"', () => {
    for (const m of [undefined, null, 0, 1]) {
      const { body } = buildMsg({
        tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
        amount: 5100, catPort: BASE.catPort, msgTrace: '111122223333',
        installmentMonths: m,
      });
      expect(body.HALBU).toBe('00');
    }
  });

  test('시나리오2-②: 취소 HALBU=원거래 동일값 + ORI 참조', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: BASE.merno,
      amount: 2670000, catPort: BASE.catPort, msgTrace: '111122224444',
      originalAuthNo: '00328697', originalAuthDate: '260806',
      installmentMonths: 3,   // ★원거래 동일값("00" 고정 아님)
    });
    expect(body.HALBU).toBe('03');           // 원거래 동일값
    expect(body.ORI_AUTHNO).toBe('00328697'); // 원거래 승인번호 참조
    expect(body.ORI_DATE).toBe('260806');     // 원거래 일자 참조
    expect(body.TAMT).toBe('002670000');      // 원거래 금액 동일(전체취소)
  });

  test('formatHalbu — 경계/오류', () => {
    expect(formatHalbu(undefined)).toBe('00');
    expect(formatHalbu(0)).toBe('00');
    expect(formatHalbu(1)).toBe('00');
    expect(formatHalbu(2)).toBe('02');
    expect(formatHalbu(12)).toBe('12');
    expect(() => formatHalbu(13)).toThrow();
    expect(() => formatHalbu(-1)).toThrow();
    expect(() => formatHalbu(3.5)).toThrow();
  });
});

test.describe('T-20260805 PLANA 할부 — 저장(payments.installment) + 응답 HALBU(spec ③)', () => {
  test('시나리오1: 승인(3개월) → recordCardPayment 에 installmentMonths=3 전달', async () => {
    const { store, payments } = makeMemStore();
    const r = await approve(
      { ...BASE, amount: 2670000, installmentMonths: 3 },
      store, mockSender(REAL_APPROVAL_3M),
    );
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    // ★payments.installment 착지값(supabaseAttemptStore: installment=installmentMonths>1?months:0).
    expect(payments[0].installmentMonths).toBe(3);
    expect(payments[0].tranType).toBe(TRANTYPE_APPROVE);
    // ★spec ③ 응답 HALBU echo 캡처(→ raw_response.halbu, payments 미착지).
    expect(r.response?.halbu).toBe('03');
  });

  test('시나리오2-②: 취소(3개월) → refund 에 원거래 개월 각인(복원) + 응답 HALBU echo', async () => {
    const { store, payments } = makeMemStore();
    const r = await cancel(
      { ...BASE, amount: 2670000, originalAuthNo: '00328697', originalAuthDate: '260806', installmentMonths: 3 },
      store, mockSender(REAL_CANCEL_3M),
    );
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    expect(payments[0].tranType).toBe(TRANTYPE_CANCEL);   // refund
    expect(payments[0].installmentMonths).toBe(3);        // 원거래 동일 개월(복원)
    expect(r.response?.halbu).toBe('03');                 // 취소 응답도 원거래 동일값 echo
  });

  test('시나리오2-①: 일시불 승인 → installmentMonths=0/null(회귀)', async () => {
    const { store, payments } = makeMemStore();
    const r = await approve(
      { ...BASE, amount: 5100, installmentMonths: 0 },
      store, mockSender(REAL_APPROVAL_LUMP),
    );
    expect(r.classification).toBe('APPROVED');
    expect(payments[0].installmentMonths ?? 0).toBe(0);
    expect(r.response?.halbu).toBe('00');
  });
});

test.describe('T-20260805 PLANA 할부 — spec ① 5만원 잠금 · spec ② 한글표기', () => {
  test('spec ①: 할부 최소금액 임계 = 50,000원', () => {
    expect(CBAND_INSTALLMENT_MIN_AMOUNT).toBe(50000);
    // FE 게이트 로직(effectiveInstallment)과 동일 판정: 금액<임계면 일시불 강제.
    const gate = (amount: number, sel: number) => (amount >= CBAND_INSTALLMENT_MIN_AMOUNT && sel > 1 ? sel : 0);
    expect(gate(49999, 3)).toBe(0);   // 5만원 미만 → 잠금(일시불)
    expect(gate(50000, 3)).toBe(3);   // 5만원 이상 → 할부 허용
    expect(gate(2670000, 12)).toBe(12);
  });

  test('spec ②: 한글표기 파생(일시불/N개월)', () => {
    expect(formatInstallmentKo(undefined)).toBe('일시불');
    expect(formatInstallmentKo(0)).toBe('일시불');
    expect(formatInstallmentKo(1)).toBe('일시불');
    expect(formatInstallmentKo(3)).toBe('3개월');
    expect(formatInstallmentKo(12)).toBe('12개월');
  });

  test('spec ③: 응답 HALBU 파싱(정본 echo)', () => {
    expect(normalize(safeParse(REAL_APPROVAL_3M)).halbu).toBe('03');
    expect(normalize(safeParse(REAL_CANCEL_3M)).halbu).toBe('03');
    expect(normalize(safeParse(REAL_APPROVAL_LUMP)).halbu).toBe('00');
    // 무응답/미수신 → null(안전).
    expect(normalize(null).halbu).toBeNull();
    expect(CBAND_HALBU_LUMPSUM).toBe('00');
  });
});
