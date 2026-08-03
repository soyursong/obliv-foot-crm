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
  precheckConcurrentPayment,
  classifyConcurrency,
  CbandConcurrentPaymentError,
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
      // ★AC-6-1 L2 partial UNIQUE(clinic_id, check_in_id) WHERE status='requested' 모사(하드백스톱).
      //   동일 환자에 in-flight('requested') 존재 시 CbandConcurrentPaymentError → 상위가 송신 중단(과금 0).
      if (rec.checkInId && [...attempts.values()].some(
        (a) => a.clinicId === rec.clinicId && a.checkInId === rec.checkInId && a.status === 'requested')) {
        throw new CbandConcurrentPaymentError('patient_in_progress');
      }
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
    // ★AC-6-2 서버 재확인(순수 read) — cband_payment_attempts 스캔.
    async probeConcurrent(q) {
      const rows = [...attempts.values()].filter((a) => a.clinicId === q.clinicId);
      return {
        patientInProgress: !!q.checkInId && rows.some((a) => a.checkInId === q.checkInId && a.status === 'requested'),
        patientCompleted: !!q.checkInId && rows.some(
          (a) => a.checkInId === q.checkInId && a.status === 'approved' && a.tranType === TRANTYPE_APPROVE),
        terminalBusy: !!q.merno && rows.some((a) => a.merno === q.merno && a.status === 'requested'),
      };
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

  // ★T-20260803-foot-CBAND-MERNO-REQFIELD-BUG(FIX-1 회귀정정): MERNO 는 더 이상 요청 필수 아님.
  //   MERNO 는 승인 '응답'에서만 오므로(7/31 실승인 20필드 부재) 빈 MERNO 로도 조립 성립하고,
  //   빈값이면 요청 전문에서 MERNO 키 자체가 제외된다(순환참조 해소). MSG_TRACE 검증은 불변.
  test('MERNO 미입력 허용(요청 전문서 제외) / 잘못된 TRACE 거부', () => {
    const { fields } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '',
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    });
    expect(fields.MERNO).toBeUndefined();  // ★빈 MERNO → 전문에 미주입(throw 아님)
    expect(fields.TID).toBe(BASE.tid);
    // MERNO 파라미터 자체를 생략해도 성립.
    const { fields: f2 } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid,
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    });
    expect(f2.MERNO).toBeUndefined();
    // 값이 있으면 계승(주입)됨.
    const { fields: f3 } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 1001, catPort: 3, msgTrace: makeTrace(),
    });
    expect(f3.MERNO).toBe(BASE.merno);
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
    // ★FIX-2(MERNO-REQFIELD-BUG): recordCardPayment 는 요청 rec 를 수신하지만, 실 supabaseAttemptStore 는
    //   payments.merchant_no 를 응답 파싱값(rawResponse.merno)에서 write 한다. mock store 는 요청 rec.merno 를 그대로
    //   관측(여기선 입력 merno echo). 응답 파생 merchant_no 저장은 MERNO-REQFIELD-BUG 신규 스펙에서 검증.
    expect(payments[0].merno).toBe(BASE.merno);
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
// ★AC-6 동시결제 중복방지 (2026-08-03, 플랜B §7-4/§4-4 → 플랜A 이관)
//   시나리오7 = 같은 환자 open('requested') 시도 존재 → 후발 차단 + 팝업분기(patient_in_progress).
//   시나리오8 = 서버 재확인이 완료('approved') 건 감지 → 분기(patient_completed, confirm 유도).
//   두 실장 = 서로 다른 브라우저 → client 상태 불신, 서버측 잠금(L2)+서버 재확인이 유일 방어.
// ══════════════════════════════════════════════════════════════════════════
test.describe('★AC-6 동시결제 중복방지 (시나리오7/8)', () => {
  // ── classifyConcurrency 순수 분기(우선순위: 진행중 > 단말사용중 > 완료) ──────
  test('classifyConcurrency: 진행중 > 단말사용중 > 완료 우선순위 + allowOverride', () => {
    const inprog = classifyConcurrency({ patientInProgress: true, patientCompleted: true, terminalBusy: true });
    expect(inprog.reason).toBe('patient_in_progress');
    expect(inprog.blocked).toBe(true);
    expect(inprog.allowOverride).toBe(false);          // 진행중은 override 불가(하드 차단)

    const term = classifyConcurrency({ patientInProgress: false, patientCompleted: true, terminalBusy: true });
    expect(term.reason).toBe('terminal_busy');
    expect(term.allowOverride).toBe(false);

    const done = classifyConcurrency({ patientInProgress: false, patientCompleted: true, terminalBusy: false });
    expect(done.reason).toBe('patient_completed');
    expect(done.allowOverride).toBe(true);             // 완료건은 실장 confirm 후 진행 허용

    const clear = classifyConcurrency({ patientInProgress: false, patientCompleted: false, terminalBusy: false });
    expect(clear.blocked).toBe(false);
    expect(clear.reason).toBeNull();
  });

  // ── ★시나리오7: 같은 환자 in-flight 존재 → 후발 차단 ─────────────────────────
  test('★시나리오7-A(서버재확인): 동일 환자 open 시도 존재 → precheck blocked=patient_in_progress', async () => {
    const { store } = makeMemStore();
    // 선발 실장: insert-first 로 in-flight('requested') 시도 생성(무응답으로 정지 상태 잔존).
    await runPaymentFlow({ ...BASE, amount: 1001, tranType: TRANTYPE_APPROVE }, store, mockSender(null, true));
    // 무응답(timedOut)은 attention 으로 전이 → in-flight 아님. 진짜 in-flight 재현 위해 requested 유지 시도 별도 주입.
    await store.insertAttempt({
      msgTrace: '900000000001', tranType: TRANTYPE_APPROVE, amount: 1002, merno: BASE.merno, tid: BASE.tid,
      clinicId: BASE.clinicId, customerId: BASE.customerId, checkInId: BASE.checkInId,
      originalAuthNo: null, isSimulation: true, status: 'requested',
    });
    // 후발 실장(다른 PC): 버튼순간 서버 재확인 → 진행중 감지·차단.
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, store);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('patient_in_progress');
    expect(decision.allowOverride).toBe(false);
  });

  test('★시나리오7-B(하드백스톱): in-flight 우회 시 insert-first L2 잠금 발화 → 송신 0·수납 0·확인필요', async () => {
    const { store, payments, log } = makeMemStore();
    // 선발: 동일 환자 in-flight('requested') 주입(precheck 우회한 TOCTOU 재현).
    await store.insertAttempt({
      msgTrace: '900000000010', tranType: TRANTYPE_APPROVE, amount: 1001, merno: BASE.merno, tid: BASE.tid,
      clinicId: BASE.clinicId, customerId: BASE.customerId, checkInId: BASE.checkInId,
      originalAuthNo: null, isSimulation: true, status: 'requested',
    });
    let sent = false;
    const sender = (async (_m: string, msgTrace: string): Promise<SendResult> => {
      sent = true; return { raw: REAL_APPROVAL, timedOut: false, msgTrace };
    });
    // 후발: runPaymentFlow → insert-first 에서 L2 잠금(CbandConcurrentPaymentError) → 송신하지 않고 blocked 반환.
    const r = await runPaymentFlow({ ...BASE, amount: 1002, tranType: TRANTYPE_APPROVE }, store, sender);
    expect(sent).toBe(false);                    // ★송신 안 함(과금 0)
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe('patient_in_progress');
    expect(r.needsCheck).toBe(true);             // 확인 필요 정지(자동 재시도 없음)
    expect(payments).toHaveLength(0);            // ★수납기록 생성 안 함
    expect(log.some((l) => /^payment:/.test(l))).toBe(false);
  });

  test('★시나리오7-C: in-flight 완결(승인/실패)되면 잠금 해제 → 후발 정상 진행', async () => {
    const { store, payments } = makeMemStore();
    // 선발 승인 완료 → status='approved'(in-flight 아님).
    const r1 = await runPaymentFlow({ ...BASE, amount: 1001, tranType: TRANTYPE_APPROVE }, store, mockSender(REAL_APPROVAL));
    expect(r1.classification).toBe('APPROVED');
    // 후발 서버 재확인: 진행중 아님 → 완료 감지(시나리오8 로 넘어감), 진행중 차단 아님.
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, store);
    expect(decision.reason).not.toBe('patient_in_progress');
    expect(payments).toHaveLength(1);
  });

  // ── ★시나리오8: 서버 재확인이 완료('approved') 건 감지 → 분기(confirm 유도) ──
  test('★시나리오8(서버재확인): 동일 환자 완료 결제 존재 → precheck blocked=patient_completed·override 허용', async () => {
    const { store } = makeMemStore();
    // 선발: 승인 완료(approved) 수납.
    await runPaymentFlow({ ...BASE, amount: 1001, tranType: TRANTYPE_APPROVE }, store, mockSender(REAL_APPROVAL));
    // 후발(다른 PC): 버튼순간 서버 재확인 → 완료 감지.
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, store);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('patient_completed');
    expect(decision.allowOverride).toBe(true);   // 추가 결제(패키지 등)는 실장 confirm 후 허용
  });

  test('★시나리오8 보강: 취소(0430) 완료는 재결제 경고 아님(승인 0210 만 patient_completed)', async () => {
    const { store } = makeMemStore();
    // 취소(refund)만 존재 → patientCompleted 아님.
    await runPaymentFlow(
      { ...BASE, amount: 1001, tranType: TRANTYPE_CANCEL, originalAuthNo: '28102510' }, store, mockSender(REAL_CANCEL));
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, store);
    expect(decision.reason).not.toBe('patient_completed');
  });

  test('동시결제 없음(clean) → precheck blocked=false (정상 결제 진행)', async () => {
    const { store } = makeMemStore();
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: 'ci-clean', merno: 'MER-NEW' }, store);
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBeNull();
  });

  test('probeConcurrent 미구현 store → precheck degrade-open(하드백스톱 L2 유효)', async () => {
    const noProbe: AttemptStore = {
      async insertAttempt() { return { id: 'x' }; },
      async updateAttempt() { /* noop */ },
      async recordCardPayment() { /* noop */ },
    };
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, noProbe);
    expect(decision.blocked).toBe(false);        // 미구현이어도 크래시 없이 진행(하드백스톱은 insert-first)
  });

  test('probeConcurrent 조회 실패 → precheck degrade-open(예외 삼킴, blocked=false)', async () => {
    const errStore: AttemptStore = {
      async insertAttempt() { return { id: 'x' }; },
      async updateAttempt() { /* noop */ },
      async recordCardPayment() { /* noop */ },
      async probeConcurrent() { throw new Error('DB timeout'); },
    };
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: BASE.checkInId, merno: BASE.merno }, errStore);
    expect(decision.blocked).toBe(false);
  });

  test('단말기(MERNO) in-flight → terminalBusy 차단(§6-4 동시1건 정합)', async () => {
    const { store } = makeMemStore();
    // 다른 환자지만 같은 단말(MERNO)에 in-flight 존재.
    await store.insertAttempt({
      msgTrace: '900000000020', tranType: TRANTYPE_APPROVE, amount: 1001, merno: BASE.merno, tid: BASE.tid,
      clinicId: BASE.clinicId, customerId: 'cust-other', checkInId: 'ci-other',
      originalAuthNo: null, isSimulation: true, status: 'requested',
    });
    const decision = await precheckConcurrentPayment(
      { clinicId: BASE.clinicId, checkInId: 'ci-new-patient', merno: BASE.merno }, store);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('terminal_busy');
    expect(decision.allowOverride).toBe(false);
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
