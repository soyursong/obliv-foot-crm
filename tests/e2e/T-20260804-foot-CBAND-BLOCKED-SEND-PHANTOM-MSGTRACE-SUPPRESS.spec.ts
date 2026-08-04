import { test, expect } from '@playwright/test';
import {
  runPaymentFlow,
  CbandConcurrentPaymentError,
  type AttemptStore,
  type AttemptRecord,
  type PaymentFlowResult,
  type Sender,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL, isValidTrace } from '../../src/lib/cband/protocol';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS
 *   코밴 직결결제 — 동시성 잠금으로 전송이 차단됐는데도 새 MSG_TRACE 가 발급·표시되어
 *   '가짜 추적번호'가 팝업에 노출되는 문제 (최필경 총괄 직접진단 ③, P0 — 사고대응 무력화).
 * ────────────────────────────────────────────────────────────────────────────
 * 관측(현장): 취소 4회 차단 시도 → 서로 다른 5개 번호 표시(전부 데몬 로그상 미전송).
 *   실제 전송된 유일 건 = MSG_TRACE=658182408832(TCODE=S0, TAMT=000003000, AUTHNO=32397288).
 *
 * 근본원인: runPaymentFlow 가 makeTrace() 를 insert-first '전'에 생성 → 잠금(L2 partial UNIQUE)에
 *   막혀 **단말로 송신하지 않은** 차단 경로에서도 그 msgTrace 를 결과로 반환 → 팝업이 '거래추적
 *   번호'로 표시(팬텀). 시도레코드는 insert-first throw 로 애초 미생성.
 *
 * 수정: 차단 경로 반환 = msgTrace='' (번호·표시 억제). 시도레코드는 이미 미생성(회귀 없음).
 * ★회귀0(AC-4): 실제 전송 경로(APPROVED/FAIL/ATTENTION-after-send)의 msgTrace 는 무접촉 —
 *   송신된 진짜 추적번호는 계속 발급·저장·표시(PAYRESP AC-7 TRANSERIAL↔MSG_TRACE 대사 보존).
 *
 * 검증(결정론·DB 무접촉): 주입 store/sender 로 runPaymentFlow 를 구동한다.
 */

const INPUT = {
  tid: '1234567890',
  merno: '000012345678',
  amount: 3000,
  catPort: 3 as number,
  clinicId: 'clinic-1',
  customerId: 'cust-1',
  checkInId: 'checkin-1',
};

/** 차단 store — insertAttempt 가 항상 CbandConcurrentPaymentError(=L2 partial UNIQUE 발화). */
function makeBlockingStore(opts: { withSweep?: boolean } = {}): AttemptStore & { inserted: AttemptRecord[]; recorded: number } {
  const inserted: AttemptRecord[] = [];
  const store: AttemptStore & { inserted: AttemptRecord[]; recorded: number } = {
    inserted,
    recorded: 0,
    async insertAttempt(_rec: AttemptRecord) {
      // 잠금 발화 = 레코드 생성 안 됨(insert-first throw). inserted 에 절대 추가하지 않는다.
      throw new CbandConcurrentPaymentError('patient_in_progress', '이미 진행 중(insert-first 잠금)');
    },
    async updateAttempt() { /* 도달 불가(차단) */ },
    async recordCardPayment() { this.recorded += 1; },
  };
  if (opts.withSweep) {
    // 취소 heal 경로 재현 — 스윕은 돌지만 재삽입도 다시 충돌(진짜 in-flight) → 차단 유지.
    store.sweepStaleRequested = async () => ({ swept: 0 });
  }
  return store;
}

/** 정상 store — insert 성공(id 발급), update/record 카운트. */
function makeOkStore(): AttemptStore & { inserted: AttemptRecord[]; recorded: number; updates: number } {
  const inserted: AttemptRecord[] = [];
  let seq = 0;
  const store: AttemptStore & { inserted: AttemptRecord[]; recorded: number; updates: number } = {
    inserted,
    recorded: 0,
    updates: 0,
    async insertAttempt(rec: AttemptRecord) {
      inserted.push(rec);
      seq += 1;
      return { id: `attempt-${seq}` };
    },
    async updateAttempt() { this.updates += 1; },
    async recordCardPayment() { this.recorded += 1; },
  };
  return store;
}

/** 승인 응답 raw(flat, ERRCODE=0000 + AUTHNO + TRANSERIAL echo). */
function approvedRaw(trace: string): string {
  return JSON.stringify({
    ERRCODE: '0000', TRANTYPE: '0210', AUTHNO: '32397288',
    TRANSERIAL: trace, TAMT: '000003000', MERNO: '000012345678',
  });
}

test.describe('CBAND 차단 경로 팬텀 MSG_TRACE 억제 (P0)', () => {
  // ── 시나리오 1: 차단 시 번호(msgTrace)·attempt 레코드 미생성 ──────────────────
  test('시나리오1a: 승인(0210) 차단 → msgTrace 빈값(팬텀 억제) + 미송신 + attempt 미생성', async () => {
    const store = makeBlockingStore();
    let sent = 0;
    const sender: Sender = async (_m, _t): Promise<SendResult> => { sent += 1; return { raw: null, timedOut: false, msgTrace: _t }; };

    const r: PaymentFlowResult = await runPaymentFlow(
      { ...INPUT, tranType: TRANTYPE_APPROVE }, store, sender,
    );

    expect(r.blocked).toBe(true);                 // 잠금으로 개시 차단.
    expect(r.msgTrace).toBe('');                  // ★핵심: 팬텀 추적번호 억제(빈값).
    expect(isValidTrace(r.msgTrace)).toBe(false); // 12자리 유효번호 아님 → UI 표시 억제 대상.
    expect(sent).toBe(0);                         // 단말 미송신(과금 0).
    expect(store.inserted.length).toBe(0);        // 시도레코드 미생성.
    expect(store.recorded).toBe(0);               // 수납 미생성.
    expect(r.needsCheck).toBe(true);              // 확인 필요 정지(기존 안전동작 유지).
  });

  test('시나리오1b: 취소(0430) 차단(heal 재삽입도 충돌) → msgTrace 빈값 + 미송신', async () => {
    const store = makeBlockingStore({ withSweep: true });
    let sent = 0;
    const sender: Sender = async (_m, _t): Promise<SendResult> => { sent += 1; return { raw: null, timedOut: false, msgTrace: _t }; };

    const r = await runPaymentFlow(
      { ...INPUT, tranType: TRANTYPE_CANCEL, originalAuthNo: '32397288' }, store, sender,
    );

    expect(r.blocked).toBe(true);
    expect(r.msgTrace).toBe('');                  // ★취소 차단도 팬텀 번호 억제.
    expect(sent).toBe(0);
    expect(store.inserted.length).toBe(0);
  });

  test('시나리오1c: 취소 4회 연속 차단 → 서로 다른 팬텀번호 0개(전부 빈값)', async () => {
    // 현장 재현: 4회 차단 → 종전엔 서로 다른 4개 번호 표시. 이제 전부 ''(팬텀 0).
    const traces: string[] = [];
    for (let i = 0; i < 4; i++) {
      const store = makeBlockingStore({ withSweep: true });
      const sender: Sender = async (_m, _t): Promise<SendResult> => ({ raw: null, timedOut: false, msgTrace: _t });
      const r = await runPaymentFlow(
        { ...INPUT, tranType: TRANTYPE_CANCEL, originalAuthNo: '32397288' }, store, sender,
      );
      traces.push(r.msgTrace);
    }
    expect(traces).toEqual(['', '', '', '']);                       // 팬텀 번호 4개 → 0개.
    expect(traces.filter((t) => isValidTrace(t)).length).toBe(0);   // 유효 추적번호 노출 0.
  });

  // ── 시나리오 2: 실제 전송건 번호 정상(회귀방지, AC-4) ────────────────────────
  test('시나리오2a: 승인 전송 성공 → 진짜 msgTrace 발급·표시(빈값 아님) + 수납 기록', async () => {
    const store = makeOkStore();
    let sentTrace = '';
    const sender: Sender = async (_m, trace): Promise<SendResult> => {
      sentTrace = trace;
      return { raw: approvedRaw(trace), timedOut: false, msgTrace: trace };
    };

    const r = await runPaymentFlow(
      { ...INPUT, tranType: TRANTYPE_APPROVE }, store, sender,
    );

    expect(r.blocked).toBeFalsy();
    expect(r.classification).toBe('APPROVED');
    expect(isValidTrace(r.msgTrace)).toBe(true);   // ★회귀0: 실제 전송건은 진짜 추적번호 유지.
    expect(r.msgTrace).toBe(sentTrace);            // 송신에 쓴 번호와 동일(대사 보존).
    expect(store.inserted.length).toBe(1);         // 전송 경로 = 시도레코드 생성.
    expect(store.recorded).toBe(1);                // 수납 기록.
    expect(r.authNo).toBe('32397288');
  });

  test('시나리오2b: 전송 후 무응답(ATTENTION) → 진짜 msgTrace 유지(표시 대상, 팬텀 아님)', async () => {
    // ★AC-4 핵심 구분: '전송했으나 불확실'(ATTENTION-after-send)은 카드 승인 가능성 있어
    //   진짜 추적번호를 반드시 표시해야 한다. 차단(미송신)과 달리 억제하면 안 됨.
    const store = makeOkStore();
    const sender: Sender = async (_m, trace): Promise<SendResult> => ({ raw: null, timedOut: true, msgTrace: trace });

    const r = await runPaymentFlow(
      { ...INPUT, tranType: TRANTYPE_APPROVE }, store, sender,
    );

    expect(r.classification).toBe('ATTENTION');
    expect(r.blocked).toBeFalsy();                 // 차단 아님 — 실제 송신됨.
    expect(isValidTrace(r.msgTrace)).toBe(true);   // ★진짜 추적번호 유지(표시 억제 금지).
    expect(store.inserted.length).toBe(1);         // 송신 경로 = 레코드 생성됨.
    expect(r.needsCheck).toBe(true);
  });
});
