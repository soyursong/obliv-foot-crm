import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  isValidTrace,
  pad9,
  pad2Port,
  safeParse,
  normalize,
  classify,
  responseMessageForUser,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';
import {
  runPaymentFlow,
  approve,
  cancel,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD — 코밴 CAT 직결 결제(플랜A)
 * ────────────────────────────────────────────────────────────────────────────
 * 순수함수(buildMsg/makeTrace/safeParse/normalize/classify) + ★이중결제 방지(D) 상태머신을
 * 결정론 unit 으로 고정한다. 실 카드 승인/취소·케이블뽑기는 물리 단말 의존 → field-soak(총괄 최필경).
 *
 * 커버:
 *  · 전문조립 4대 규칙(콜론뒤공백/TRACE 12자리/TAMT 9pad/PORT 2pad) + 실측#1 TID 강제.
 *  · classify: APPROVED / FAIL / ★ATTENTION(C011·8003·8555·무응답) — 자동 재시도 금지.
 *  · runPaymentFlow: insert-first 순서 / ATTENTION 정지·수납기록 없음 / APPROVED 수납기록 /
 *    취소(0430, AUTHNO=원거래 동일 TRANTYPE 구분) / 무응답 → 확인필요.
 */

// ── in-memory AttemptStore (호출 순서·부수효과 관측) ─────────────────────────
function makeMemStore() {
  const log: string[] = [];
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string }> = [];
  const store: AttemptStore = {
    async insertAttempt(rec) {
      if (attempts.has(rec.msgTrace)) throw new Error('MSG_TRACE 중복');
      attempts.set(rec.msgTrace, { ...rec });
      log.push(`insert:${rec.msgTrace}:${rec.status}`);
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
      log.push(`update:${msgTrace}:${patch.status ?? ''}`);
    },
    async recordCardPayment(rec) {
      payments.push(rec);
      log.push(`payment:${rec.msgTrace}:${rec.tranType}`);
    },
  };
  return { store, log, attempts, payments };
}

const mockSender = (raw: string | null, timedOut = false) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut, msgTrace }));

const BASE = {
  tid: 'TID12345678',
  merno: 'MER0001',
  catPort: 'COM3',
  clinicId: 'clinic-1',
  customerId: 'cust-1',
  checkInId: 'ci-1',
};

// ══════════════════════════════════════════════════════════════════════════
// 1) 전문 조립 4대 규칙 + 실측
// ══════════════════════════════════════════════════════════════════════════
test.describe('전문 조립 4대 규칙', () => {
  test('규칙#3 TAMT 9자리 zero-pad / 규칙#4 CAT_PORT 2자리(COM3→03)', () => {
    expect(pad9(1001)).toBe('000001001');
    expect(pad9(0)).toBe('000000000');
    expect(pad2Port('COM3')).toBe('03');
    expect(pad2Port(3)).toBe('03');
    expect(pad2Port('03')).toBe('03');
    expect(() => pad9(-1)).toThrow();
    expect(() => pad9(1_000_000_000)).toThrow(); // 10자리 초과
  });

  test('규칙#2 MSG_TRACE 12자리 숫자 + 중복 금지', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = makeTrace((x) => seen.has(x));
      expect(isValidTrace(t)).toBe(true);
      expect(t).toMatch(/^\d{12}$/);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  test('규칙#1 콜론 뒤 공백 금지 + 승인 전문 필드 정합', () => {
    const trace = makeTrace();
    const { message, fields } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 1001, catPort: 'COM3', msgTrace: trace,
    });
    expect(message).not.toMatch(/:\s/);          // 콜론 뒤 공백 0
    expect(message).toBe(JSON.stringify(fields)); // 기본 stringify(공백無)
    expect(fields.TAMT).toBe('000001001');
    expect(fields.CAT_PORT).toBe('03');
    expect(fields.TRANTYPE).toBe('0210');
    expect(fields.TID).toBe(BASE.tid);
    expect(fields.MERNO).toBe(BASE.merno);
    expect(fields.MSG_TRACE).toBe(trace);
  });

  test('실측#1 TID 비우면 조립 거부(throw)', () => {
    expect(() => buildMsg({
      tranType: TRANTYPE_APPROVE, tid: '  ', merno: BASE.merno,
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    })).toThrow(/TID/);
  });

  test('MERNO 필수 / 잘못된 TRACE 거부', () => {
    expect(() => buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '',
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    })).toThrow(/MERNO/);
    expect(() => buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 1001, catPort: 3, msgTrace: '123', // 12자리 아님
    })).toThrow(/MSG_TRACE/);
  });

  test('실측#2 취소(0430)는 원거래 AUTHNO 동봉 필수', () => {
    expect(() => buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: BASE.merno,
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    })).toThrow(/AUTHNO/);
    const { fields } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: BASE.merno,
      amount: 1001, catPort: 3, msgTrace: makeTrace(), originalAuthNo: 'A12345',
    });
    expect(fields.TRANTYPE).toBe('0430');
    expect(fields.AUTHNO).toBe('A12345');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2) safeParse / normalize (실측#3 관대 파싱)
// ══════════════════════════════════════════════════════════════════════════
test.describe('safeParse / normalize', () => {
  test('정상 JSON 파싱 + 별칭/대소문자 관대 정규화', () => {
    const n = normalize(safeParse('{"TRANTYPE":"0210","AUTHNO":"A1","RESPCODE":"0000","MERNO":"M1","TAMT":"000001001"}'));
    expect(n.tranType).toBe('0210');
    expect(n.authNo).toBe('A1');
    expect(n.responseCode).toBe('0000');
    expect(n.merno).toBe('M1');
    expect(n.amount).toBe(1001);
  });

  test('실측#3 앞뒤 FILLER 바이트 관대 파싱', () => {
    const parsed = safeParse('\x02GARBAGE{"RESPCODE":"0000","AUTHNO":"A1"}\x03xx');
    expect(parsed).not.toBeNull();
    expect(normalize(parsed).responseCode).toBe('0000');
  });

  test('빈/깨진 응답은 null', () => {
    expect(safeParse('')).toBeNull();
    expect(safeParse(null)).toBeNull();
    expect(safeParse('완전히깨진값')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3) ★ classify — 이중결제 방지 핵심
// ══════════════════════════════════════════════════════════════════════════
test.describe('classify (★이중결제 방지)', () => {
  test('APPROVED: 0000 + AUTHNO', () => {
    expect(classify(normalize(safeParse('{"RESPCODE":"0000","AUTHNO":"A1"}')))).toBe('APPROVED');
  });

  test('★ATTENTION: 무응답(null) → 자동재시도 금지', () => {
    expect(classify(null)).toBe('ATTENTION');
  });

  test('★ATTENTION: C011 / 8003 / 8555', () => {
    for (const code of ['C011', '8003', '8555']) {
      expect(classify(normalize(safeParse(`{"RESPCODE":"${code}"}`)))).toBe('ATTENTION');
    }
  });

  test('FAIL: 명확한 거절코드(과금 미발생)', () => {
    expect(classify(normalize(safeParse('{"RESPCODE":"0051","RESPMSG":"한도초과"}')))).toBe('FAIL');
  });

  test('사용자 메시지: ATTENTION 은 재결제 금지 안내', () => {
    const msg = responseMessageForUser('ATTENTION', null);
    expect(msg).toContain('확인');
    expect(msg).toMatch(/다시 결제하지/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4) ★ runPaymentFlow — insert-first / 정지 / 수납기록 (D 상태머신)
// ══════════════════════════════════════════════════════════════════════════
test.describe('runPaymentFlow (★D 상태머신)', () => {
  test('시나리오1 정상 승인: insert-first → 수납기록 + AUTHNO/MSG_TRACE 저장', async () => {
    const { store, log, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1001 }, store,
      mockSender('{"RESPCODE":"0000","AUTHNO":"A100","TRANTYPE":"0210","MERNO":"MER0001"}'));
    expect(r.classification).toBe('APPROVED');
    expect(r.needsCheck).toBe(false);
    expect(r.authNo).toBe('A100');
    // insert 가 update/payment 보다 먼저(★insert-first)
    expect(log[0]).toMatch(/^insert:/);
    // 수납기록 1건 + 시도레코드 approved
    expect(payments).toHaveLength(1);
    expect(payments[0].authNo).toBe('A100');
    expect(attempts.get(r.msgTrace)?.status).toBe('approved');
    expect(isValidTrace(r.msgTrace)).toBe(true);
  });

  test('★시나리오4 ATTENTION(C011): 정지·수납기록 없음·시도레코드 잔존(MSG_TRACE)', async () => {
    const { store, log, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1002 }, store, mockSender('{"RESPCODE":"C011"}'));
    expect(r.classification).toBe('ATTENTION');
    expect(r.needsCheck).toBe(true);        // ★확인 필요 정지
    expect(payments).toHaveLength(0);       // ★수납기록 생성 안함
    expect(attempts.get(r.msgTrace)?.status).toBe('attention');
    expect(isValidTrace(r.msgTrace)).toBe(true); // ★MSG_TRACE 잔존(단말 승인내역조회 키)
    // 재시도 없음: insert 1회 + update 1회 뿐(재송신 흔적 없음)
    expect(log.filter((l) => l.startsWith('insert:'))).toHaveLength(1);
  });

  test('★시나리오5 무응답(케이블뽑기 재현): timedOut → 확인필요·수납기록 없음', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1003 }, store, mockSender(null, true));
    expect(r.classification).toBe('ATTENTION');
    expect(r.needsCheck).toBe(true);
    expect(payments).toHaveLength(0);
    expect(attempts.get(r.msgTrace)?.status).toBe('attention');
  });

  test('8555 / 8003 도 ATTENTION 정지', async () => {
    for (const code of ['8555', '8003']) {
      const { store, payments } = makeMemStore();
      const r = await approve({ ...BASE, amount: 1005 }, store, mockSender(`{"RESPCODE":"${code}"}`));
      expect(r.needsCheck).toBe(true);
      expect(payments).toHaveLength(0);
    }
  });

  test('FAIL: 거절코드 → 실패(재시도 안전)·수납기록 없음', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1006 }, store, mockSender('{"RESPCODE":"0051","RESPMSG":"한도초과"}'));
    expect(r.classification).toBe('FAIL');
    expect(r.needsCheck).toBe(false);
    expect(payments).toHaveLength(0);
    expect(attempts.get(r.msgTrace)?.status).toBe('failed');
  });

  test('시나리오3 취소(0430): AUTHNO=원거래 동일, TRANTYPE 로 구분 → refund 수납기록', async () => {
    const { store, payments } = makeMemStore();
    const r = await cancel(
      { ...BASE, amount: 1001, originalAuthNo: 'A100' }, store,
      // 취소 응답: AUTHNO 는 원거래(A100)와 동일, TRANTYPE=0430 로만 취소 구분
      mockSender('{"RESPCODE":"0000","AUTHNO":"A100","TRANTYPE":"0430"}'));
    expect(r.classification).toBe('APPROVED');
    expect(r.needsCheck).toBe(false);
    expect(payments).toHaveLength(1);
    expect(payments[0].tranType).toBe('0430'); // 취소 전문 → store 가 refund 로 기록
  });

  test('insert-first 실패 시 송신하지 않음(추적불가 과금 방지)', async () => {
    const failStore: AttemptStore = {
      async insertAttempt() { throw new Error('DB down'); },
      async updateAttempt() { /* noop */ },
      async recordCardPayment() { /* noop */ },
    };
    let sent = false;
    const sender = (async (_m: string, msgTrace: string): Promise<SendResult> => {
      sent = true; return { raw: '{"RESPCODE":"0000","AUTHNO":"A1"}', timedOut: false, msgTrace };
    });
    await expect(runPaymentFlow({ ...BASE, amount: 1001, tranType: TRANTYPE_APPROVE }, failStore, sender)).rejects.toThrow();
    expect(sent).toBe(false); // ★송신 전 차단
  });
});
