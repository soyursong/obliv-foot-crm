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
import {
  probeTerminal,
  cancelProbe,
  send as wsSend,
  _resetInFlight,
  type SendResult,
  type ProbeResult,
} from '../../src/lib/cband/catClient';

/**
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD — 코밴 CAT 직결 결제(플랜A)
 * ────────────────────────────────────────────────────────────────────────────
 * 정본 스펙 = 35KB SSOT(기획_플랜A_단말기직결결제_CRM연동_20260731, 총괄 최필경 22:26 최신본,
 *   공개 HTTPS 재실증 2회). §12 검증계획의 8-시나리오(★필수 1·2·6·10·11·12 + 3·4·5)를 결정론 unit 으로
 *   고정한다. 실 카드 승인/취소·케이블뽑기·브라우저 권한창은 물리 단말/브라우저 의존 → field-soak(총괄).
 *
 * ★ 응답 필드는 실측 정본 철자(§5-3/부록): ERRCODE·TRANSERIAL·MSG1·TRANDATE·TRANTIME·AUTHNO(trailing space)·
 *   ISSUECARD·PURCHASECARD·MERNO. (종전 추정 별칭 RESPCODE/MSG_TRACE 는 관용 폴백으로 보존 — 별도 검증.)
 *
 * 커버:
 *  · 전문조립 4대 규칙(콜론뒤공백/TRACE 12자리/TAMT 9pad/PORT 2pad) + 실측#1 TID 강제.
 *  · normalize: 실측 정본 필드명(ERRCODE/TRANSERIAL/MSG1/TRANDATE) 정확 추출 + 별칭 관용.
 *  · classify: APPROVED / FAIL / ★ATTENTION(C011·8003·8555·무응답) — 자동 재시도 금지.
 *  · runPaymentFlow: insert-first / ATTENTION 정지·수납없음 / APPROVED 수납 / 취소(0430).
 *  · §12 시나리오 1·2·3·4·5·6·10·11·12 결정론 매핑.
 */

// ── 실측 정본 응답 원문(35KB SSOT 부록, 승인 10:44:26 / 취소 10:44:57) ─────────
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104426","AUTHNO":"28102510    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000759",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","SIGNPATH":"","MSG1":"거래 승인28102510"}';
const REAL_CANCEL =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104457","AUTHNO":"28102510    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104452000913","MSG1":"취소거래승인28102510"}';
// 카드 미삽입/사용자 초기화 → 데몬이 ERRCODE=9999 + ResultMessage([-3]) 로 반환(§8 실측 주의).
const REAL_CARD_NOT_INSERTED =
  '{"ERRCODE":"9999","ResultMessage":"승인 실패 : 단말기/POS 사용자 초기화 처리 [-3] 초기화 완료"}';
// 단말기에서 사용자가 [취소] → 명확한 거절코드(과금 미발생).
const REAL_USER_ABORT = '{"ERRCODE":"9999","ResultMessage":"승인 실패 : 사용자 취소"}';

// ── in-memory AttemptStore (호출 순서·부수효과 관측) ─────────────────────────
function makeMemStore() {
  const log: string[] = [];
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) {
      if (attempts.has(rec.msgTrace)) throw new Error('MSG_TRACE 중복');
      const id = `attempt-${++seq}`;
      attempts.set(rec.msgTrace, { ...rec });
      log.push(`insert:${rec.msgTrace}:${rec.status}`);
      // ★3-way canon: attempt id 반환(승인 시 payments.payment_attempt_id FK 착지 근거).
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
      log.push(`update:${msgTrace}:${patch.status ?? ''}`);
    },
    async recordCardPayment(rec) {
      // rec.attemptId = insertAttempt 반환 id. external_* canonical 착지의 CAT-origin FK.
      payments.push(rec);
      log.push(`payment:${rec.msgTrace}:${rec.tranType}:${rec.attemptId}`);
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
// A) 전문 조립 4대 규칙 + 실측
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
      amount: 1001, catPort: 3, msgTrace: makeTrace(), originalAuthNo: '28102510',
    });
    expect(fields.TRANTYPE).toBe('0430');
    expect(fields.AUTHNO).toBe('28102510');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B) safeParse / normalize — ★실측 정본 필드명(ERRCODE/TRANSERIAL/MSG1/TRANDATE)
// ══════════════════════════════════════════════════════════════════════════
test.describe('safeParse / normalize (★실측 정본 필드명)', () => {
  test('★실측 승인 원문: ERRCODE·AUTHNO(trim)·TRANSERIAL·MSG1·TRANDATE/TRANTIME 정확 추출', () => {
    const n = normalize(safeParse(REAL_APPROVAL));
    expect(n.responseCode).toBe('0000');       // ★ERRCODE (RESPCODE 아님)
    expect(n.tranType).toBe('0210');
    expect(n.authNo).toBe('28102510');         // ★trailing space trim
    expect(n.msgTrace).toBe('104421000759');   // ★TRANSERIAL echo (MSG_TRACE 아님)
    expect(n.merno).toBe('00918554560');       // trailing space trim
    expect(n.responseMessage).toBe('거래 승인28102510'); // ★MSG1
    expect(n.tranDate).toBe('260731');         // ★TRANDATE (BINDING#3 승인시각)
    expect(n.tranTime).toBe('104426');         // ★TRANTIME
    expect(n.amount).toBe(1002);
    expect(n.cardName).toBe('하나기업');        // ISSUECARD
  });

  test('★실측 취소 원문: TRANTYPE=0430 + AUTHNO 원거래 동일(구분은 tranType)', () => {
    const n = normalize(safeParse(REAL_CANCEL));
    expect(n.responseCode).toBe('0000');
    expect(n.tranType).toBe('0430');
    expect(n.authNo).toBe('28102510');         // 승인과 동일 값
    expect(n.msgTrace).toBe('104452000913');   // 취소 TRANSERIAL(승인과 다름)
  });

  test('실측#3 앞뒤 FILLER 바이트 관대 파싱', () => {
    const parsed = safeParse('\x02GARBAGE{"ERRCODE":"0000","AUTHNO":"A1"}\x03xx');
    expect(parsed).not.toBeNull();
    expect(normalize(parsed).responseCode).toBe('0000');
  });

  test('빈/깨진 응답은 null', () => {
    expect(safeParse('')).toBeNull();
    expect(safeParse(null)).toBeNull();
    expect(safeParse('완전히깨진값')).toBeNull();
  });

  test('별칭 관용: 종전 추정 RESPCODE/MSG_TRACE 도 폴백 파싱(회귀 안전)', () => {
    const n = normalize(safeParse('{"TRANTYPE":"0210","AUTHNO":"A1","RESPCODE":"0000","MERNO":"M1","MSG_TRACE":"111122223333"}'));
    expect(n.responseCode).toBe('0000');
    expect(n.msgTrace).toBe('111122223333');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C) ★ classify — 이중결제 방지 핵심 (§7-1)
// ══════════════════════════════════════════════════════════════════════════
test.describe('classify (★이중결제 방지)', () => {
  test('APPROVED: 실측 승인 원문(ERRCODE=0000 + AUTHNO)', () => {
    expect(classify(normalize(safeParse(REAL_APPROVAL)))).toBe('APPROVED');
  });

  test('★ATTENTION: 무응답(null) → 자동재시도 금지', () => {
    expect(classify(null)).toBe('ATTENTION');
  });

  test('★ATTENTION: C011 / 8003 / 8555 (ERRCODE)', () => {
    for (const code of ['C011', '8003', '8555']) {
      expect(classify(normalize(safeParse(`{"ERRCODE":"${code}"}`)))).toBe('ATTENTION');
    }
  });

  test('FAIL: ERRCODE=9999 + ResultMessage([-3]) (카드 미삽입/사용자 초기화 — 과금 미발생)', () => {
    expect(classify(normalize(safeParse(REAL_CARD_NOT_INSERTED)))).toBe('FAIL');
  });

  test('사용자 메시지: ATTENTION 은 재결제 금지 안내', () => {
    const msg = responseMessageForUser('ATTENTION', null);
    expect(msg).toContain('확인');
    expect(msg).toMatch(/다시 결제하지/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D) ★ §12 시나리오 — runPaymentFlow (insert-first / 정지 / 수납 / D 상태머신)
// ══════════════════════════════════════════════════════════════════════════
test.describe('§12 시나리오 (★D 상태머신)', () => {
  test('시나리오1 정상 승인: insert-first → 수납기록 + AUTHNO/TRANSERIAL/승인시각 저장', async () => {
    const { store, log, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1002 }, store, mockSender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(r.needsCheck).toBe(false);
    expect(r.authNo).toBe('28102510');
    expect(r.approvalDate).toBe('260731');  // ★BINDING#3 승인시각 노출
    expect(r.approvalTime).toBe('104426');
    // insert 가 update/payment 보다 먼저(★insert-first)
    expect(log[0]).toMatch(/^insert:/);
    // 수납기록 1건 + 시도레코드 approved
    expect(payments).toHaveLength(1);
    expect(payments[0].authNo).toBe('28102510');
    expect(attempts.get(r.msgTrace)?.status).toBe('approved');
    expect(isValidTrace(r.msgTrace)).toBe(true);
  });

  test('시나리오2 취소(0430): AUTHNO=원거래 동일·TRANTYPE 구분 → refund 수납기록', async () => {
    const { store, payments } = makeMemStore();
    const r = await cancel(
      { ...BASE, amount: 1002, originalAuthNo: '28102510' }, store, mockSender(REAL_CANCEL));
    expect(r.classification).toBe('APPROVED');
    expect(r.needsCheck).toBe(false);
    expect(payments).toHaveLength(1);
    expect(payments[0].tranType).toBe('0430'); // 취소 전문 → store 가 refund 로 기록
  });

  test('시나리오3 카드 미삽입(9999/[-3]): FAIL(정상 종료)·이중결제 아님·수납없음', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1003 }, store, mockSender(REAL_CARD_NOT_INSERTED));
    expect(r.classification).toBe('FAIL');
    expect(r.needsCheck).toBe(false);       // 확인필요 아님(과금 미발생 확정)
    expect(payments).toHaveLength(0);
    expect(attempts.get(r.msgTrace)?.status).toBe('failed');
  });

  test('시나리오4 단말기에서 취소(사용자 취소): FAIL 처리·수납없음', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1005 }, store, mockSender(REAL_USER_ABORT));
    expect(r.classification).toBe('FAIL');
    expect(payments).toHaveLength(0);
    expect(attempts.get(r.msgTrace)?.status).toBe('failed');
  });

  test('★시나리오6 응답 유실(케이블뽑기 재현): timedOut → 확인필요·수납없음·MSG_TRACE 잔존·재시도없음', async () => {
    const { store, log, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1006 }, store, mockSender(null, true));
    expect(r.classification).toBe('ATTENTION');
    expect(r.needsCheck).toBe(true);          // ★확인 필요 정지
    expect(payments).toHaveLength(0);         // ★수납기록 생성 안함
    expect(attempts.get(r.msgTrace)?.status).toBe('attention');
    expect(isValidTrace(r.msgTrace)).toBe(true); // ★MSG_TRACE 잔존(단말 승인내역조회 유일 키)
    // ★자동 재시도 없음: insert 1회뿐(재송신 흔적 없음)
    expect(log.filter((l) => l.startsWith('insert:'))).toHaveLength(1);
  });

  test('★ATTENTION 확장: C011 / 8003 / 8555 도 정지·수납없음', async () => {
    for (const code of ['C011', '8003', '8555']) {
      const { store, payments, attempts } = makeMemStore();
      const r = await approve({ ...BASE, amount: 1001 }, store, mockSender(`{"ERRCODE":"${code}"}`));
      expect(r.needsCheck).toBe(true);
      expect(payments).toHaveLength(0);
      expect(attempts.get(r.msgTrace)?.status).toBe('attention');
    }
  });

  test('insert-first 실패 시 송신하지 않음(추적불가 과금 방지)', async () => {
    const failStore: AttemptStore = {
      async insertAttempt(): Promise<{ id: string }> { throw new Error('DB down'); },
      async updateAttempt() { /* noop */ },
      async recordCardPayment() { /* noop */ },
    };
    let sent = false;
    const sender = (async (_m: string, msgTrace: string): Promise<SendResult> => {
      sent = true; return { raw: REAL_APPROVAL, timedOut: false, msgTrace };
    });
    await expect(runPaymentFlow({ ...BASE, amount: 1001, tranType: TRANTYPE_APPROVE }, failStore, sender)).rejects.toThrow();
    expect(sent).toBe(false); // ★송신 전 차단
  });

  test('송신 예외(CbandBusyError 등) → ATTENTION 정지(승인 성립 배제 못함)', async () => {
    const { store, payments } = makeMemStore();
    const throwingSender = (async () => { const e = new Error('busy'); e.name = 'CbandBusyError'; throw e; });
    const r = await approve({ ...BASE, amount: 1001 }, store, throwingSender as never);
    expect(r.classification).toBe('ATTENTION');
    expect(r.needsCheck).toBe(true);
    expect(payments).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E) ★C6 테스트금액 격리(is_simulation) + K1 CAT-origin 판별자(payment_attempt_id, provider 컬럼 없음)
// ══════════════════════════════════════════════════════════════════════════
test.describe('C6 is_simulation / K1 CAT-origin 판별자', () => {
  test('C6: 테스트금액(1001~1006)은 attempt·payments is_simulation=true 각인', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1002 }, store, mockSender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(attempts.get(r.msgTrace)?.isSimulation).toBe(true);
    expect(payments).toHaveLength(1);
    expect(payments[0].isSimulation).toBe(true); // payments 패리티(매출/감사 제외)
  });

  test('C6: 실거래 금액은 is_simulation=false (매출 유니버스 잔존)', async () => {
    const { store, attempts, payments } = makeMemStore();
    const r = await approve({ ...BASE, amount: 50000 }, store, mockSender('{"ERRCODE":"0000","AUTHNO":"A3","TRANTYPE":"0210"}'));
    expect(r.classification).toBe('APPROVED');
    expect(attempts.get(r.msgTrace)?.isSimulation).toBe(false);
    expect(payments[0].isSimulation).toBe(false);
  });

  test('isSimulationAmount: 1001~1006(1004 제외) true, 그 외/금지금액 false', async () => {
    const { isSimulationAmount, CBAND_TEST_AMOUNTS } = await import('../../src/lib/cband/config');
    for (const a of CBAND_TEST_AMOUNTS) expect(isSimulationAmount(a)).toBe(true);
    for (const a of [100, 1000, 1004, 1234, 50000, 0]) expect(isSimulationAmount(a)).toBe(false); // 1004=실거래충돌 금지
  });

  test('K1: CAT-origin 판별자 = payment_attempt_id IS NOT NULL — provider 컬럼(pos_/pg_) 부활 금지', async () => {
    const mod = await import('../../src/lib/cband/supabaseAttemptStore') as Record<string, unknown>;
    // ★3-way canon(zpas): pos_provider/pg_provider 컬럼 prod 부재(dead) → 채널 판별은 payment_attempt_id FK.
    expect(mod.CBAND_ORIGIN_DISCRIMINATOR).toBe('payment_attempt_id IS NOT NULL');
    // dead-column 회귀 방지: 어떤 provider 상수도 export 하지 않는다.
    expect(mod.CBAND_POS_PROVIDER).toBeUndefined();
    expect(mod.CBAND_PG_PROVIDER).toBeUndefined();
  });

  test('K1: 승인 시 recordCardPayment 가 attemptId(FK)를 받는다 — external_* canonical 착지 근거', async () => {
    const { store, payments, log } = makeMemStore();
    const r = await approve({ ...BASE, amount: 1001 }, store, mockSender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    // payment_attempt_id 로 착지될 attempt id 가 store 로 전달됨(pos_* 아님).
    expect((payments[0] as Record<string, unknown>).attemptId).toBeTruthy();
    expect(log.some((l) => /^payment:.*:attempt-\d+$/.test(l))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F) ★ §12 시나리오 10·11·12 — probeTerminal 3분기(U3) + WebSocket 동시 1개(U2)
// ══════════════════════════════════════════════════════════════════════════
// 제어 가능한 Mock WebSocket — onopen/onerror/onclose 발화 타이밍을 테스트가 결정.
class MockWS {
  static instances: MockWS[] = [];
  static reset() { MockWS.instances = []; }
  static last(): MockWS { return MockWS.instances[MockWS.instances.length - 1]; }
  url: string;
  readyState = 0; // CONNECTING
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(url: string) { this.url = url; MockWS.instances.push(this); }
  send() { /* noop */ }
  close() { this.closed = true; this.readyState = 3; }
  fireOpen() { this.readyState = 1; this.onopen?.(); }
  fireError() { this.onerror?.(); }
  fireClose() { this.onclose?.(); }
}

test.describe('§12 시나리오 10·11·12 (probe 3분기 / 동시1개)', () => {
  const realWS = (globalThis as Record<string, unknown>).WebSocket;
  test.beforeEach(() => {
    MockWS.reset();
    cancelProbe();
    _resetInFlight();
    (globalThis as Record<string, unknown>).WebSocket = MockWS as unknown;
  });
  test.afterEach(() => {
    cancelProbe();
    _resetInFlight();
    (globalThis as Record<string, unknown>).WebSocket = realWS;
  });

  test("U3 'ok'(정상 PC): onopen 도달 → ok, 소켓 닫힘(즉시 열닫)", async () => {
    const p = probeTerminal('ws://127.0.0.1:8888', 1000);
    const ws = MockWS.last();
    ws.fireOpen();
    const r: ProbeResult = await p;
    expect(r).toBe('ok');
    expect(ws.closed).toBe(true); // 열림 즉시 닫음
  });

  test("★시나리오10 권한 미허용 PC: 타임아웃까지 무반응(권한창 대기) → 'awaiting', ★소켓 닫지 않음(버튼 숨김 아님)", async () => {
    const p = probeTerminal('ws://127.0.0.1:8888', 15);
    const ws = MockWS.last();
    expect(await p).toBe('awaiting');
    expect(ws.closed).toBe(false); // ★사용자가 [허용] 누르면 이어서 open 가능 → 닫지 않음
  });

  test("★시나리오11 권한 [차단] PC / 데몬꺼짐: onerror → 'blocked'(두 원인 동일 증상), 소켓 닫힘", async () => {
    const p = probeTerminal('ws://127.0.0.1:8888', 1000);
    const ws = MockWS.last();
    ws.fireError();
    expect(await p).toBe('blocked');
    expect(ws.closed).toBe(true);
  });

  test("시나리오11 보강: open 전 onclose → blocked", async () => {
    const p = probeTerminal('ws://127.0.0.1:8888', 1000);
    MockWS.last().fireClose();
    expect(await p).toBe('blocked');
  });

  test('U3: WS 미지원 환경 → blocked (버튼 대신 안내 대상)', async () => {
    (globalThis as Record<string, unknown>).WebSocket = undefined;
    expect(await probeTerminal('ws://127.0.0.1:8888', 15)).toBe('blocked');
  });

  test('★시나리오12 소켓 중복: send() 는 결제 소켓 열기 전 탐침 소켓을 닫는다(동시 1개)', async () => {
    // 탐침 → awaiting(소켓 열린 채 유지)
    const p = probeTerminal('ws://127.0.0.1:8888', 15);
    const probeWs = MockWS.last();
    expect(await p).toBe('awaiting');
    expect(probeWs.closed).toBe(false);

    const before = MockWS.instances.length;
    // 결제 send → cancelProbe 로 탐침 소켓 종료 후 결제 소켓 신규 오픈.
    const sp = wsSend('{"a":1}', '000000000001', { url: 'ws://127.0.0.1:8888', timeoutMs: 20 });
    expect(probeWs.closed).toBe(true);                     // ★탐침 소켓 닫힘
    expect(MockWS.instances.length).toBe(before + 1);      // 결제 소켓 1개만 신규
    const res: SendResult = await sp;                      // 무응답 타임아웃(cleanup)
    expect(res.timedOut).toBe(true);
  });

  test('★시나리오5 요청 겹침: in-flight 중 새 send → CbandBusyError(동시 1건 한도)', async () => {
    // 첫 send 시작(응답 미도달 상태 유지) → _inFlight=true.
    const first = wsSend('{"a":1}', '000000000002', { url: 'ws://127.0.0.1:8888', timeoutMs: 40 });
    // 두 번째 send 는 즉시 CbandBusyError 로 거부(중복요청 무응답 방지·§7-4 잠금1).
    await expect(wsSend('{"b":2}', '000000000003', { url: 'ws://127.0.0.1:8888', timeoutMs: 40 }))
      .rejects.toThrow(/진행 중/);
    await first; // cleanup(타임아웃 회수)
  });

  test('U2: cancelProbe() 로 진행 중 탐침 소켓 즉시 종료', async () => {
    const p = probeTerminal('ws://127.0.0.1:8888', 1000);
    const ws = MockWS.last();
    cancelProbe();
    expect(ws.closed).toBe(true);
    await Promise.race([p, new Promise((r) => setTimeout(() => r('awaiting'), 30))]);
  });

  test('U2: 재탐침 시 이전 탐침 소켓을 먼저 닫아 동시 2개 방지', async () => {
    const p1 = probeTerminal('ws://127.0.0.1:8888', 15);
    const ws1 = MockWS.last();
    const p2 = probeTerminal('ws://127.0.0.1:8888', 15); // 시작 시 cancelProbe → ws1 닫힘
    expect(ws1.closed).toBe(true);
    expect(await p1).toBe('awaiting');
    expect(await p2).toBe('awaiting');
  });
});
