import { test, expect } from '@playwright/test';
import {
  resolveBlockingMsgTrace,
  approve,
  cancel,
  CbandConcurrentPaymentError,
  CBAND_ORPHAN_STALE_MINUTES,
  type AttemptStore,
  type AttemptRecord,
  type CbandAttemptView,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS — 차단 시 가짜 MSG_TRACE 억제 (P0 hotfix)
 * ─────────────────────────────────────────────────────────────────────────────
 * 증상(최필경 총괄 실증): 동시성 잠금(patient_in_progress)으로 전송이 차단됐는데도 매 클릭마다 새 MSG_TRACE
 *   (makeTrace)가 결과에 실려 팝업에 표시 → 취소 4회에 서로 다른 phantom 번호 5개 노출(데몬 로그 전수 부재).
 *   실제 전송된 유일 건은 658182408832. 사고 대응 시 어느 번호가 진짜 전송건인지 분간 불가(P0).
 *
 * 수정: 차단 반환 경로에서 (1) 이 요청의 새 phantom MSG_TRACE 를 결과로 노출하지 않음(msgTrace='' 또는
 *   차단 원인 번호) (2) '차단 원인이 된 진행중 시도'의 실 MSG_TRACE(resolveBlockingMsgTrace)로 교체(AC-7)
 *   (3) 원인 미특정 시 번호 없이 안내. attempt row 는 insert-first 가 이미 throw → phantom INSERT 0(AC-2).
 *   스키마 무변(db_change=false·ADDITIVE).
 *
 * 커버(현장 클릭 시나리오 E2E 변환):
 *  · 시나리오1(차단 시 가짜 번호 미발급): AC-1/AC-2/AC-3/AC-5
 *  · 시나리오2(실제 전송건 번호 정상): AC-4 회귀 방지
 *  · 시나리오3(차단 안내 = 차단 원인 번호 658182408832): AC-7
 */

const REAL_INFLIGHT_TRACE = '658182408832'; // 실제 전송된 유일 건(현장 원문)
const nowIso = () => new Date().toISOString();
const minAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── resolveBlockingMsgTrace 순수 판정 (AC-7 코어) ───────────────────────────
function view(over: Partial<CbandAttemptView>): CbandAttemptView {
  return {
    id: 'v1', msgTrace: REAL_INFLIGHT_TRACE, status: 'requested',
    tranType: TRANTYPE_APPROVE, amount: 3000, createdAt: nowIso(),
    authNo: null, responseCode: null, ...over,
  };
}

test.describe('resolveBlockingMsgTrace — 차단 원인 번호만 선별 (AC-7)', () => {
  test('AC-7: 진행중 승인(APPROVE·requested·최근) → 그 번호 반환', () => {
    expect(resolveBlockingMsgTrace([view({ status: 'requested' })], Date.now())).toBe(REAL_INFLIGHT_TRACE);
  });

  test('AC-7: 확인필요(attention·최근)도 차단 원인 → 번호 반환', () => {
    expect(resolveBlockingMsgTrace([view({ status: 'attention' })], Date.now())).toBe(REAL_INFLIGHT_TRACE);
  });

  test('AC-7: 최신순 첫 후보 반환(취소행은 건너뛰고 진행중 승인)', () => {
    const rows = [
      view({ id: 'c', msgTrace: '480400000001', tranType: TRANTYPE_CANCEL, status: 'requested' }),
      view({ id: 'a', msgTrace: REAL_INFLIGHT_TRACE, tranType: TRANTYPE_APPROVE, status: 'requested' }),
    ];
    expect(resolveBlockingMsgTrace(rows, Date.now())).toBe(REAL_INFLIGHT_TRACE);
  });

  test('원인 미특정 → null (종료건/취소건/stale 만 존재)', () => {
    expect(resolveBlockingMsgTrace([view({ status: 'approved' })], Date.now())).toBeNull();
    expect(resolveBlockingMsgTrace([view({ status: 'failed' })], Date.now())).toBeNull();
    expect(resolveBlockingMsgTrace([view({ tranType: TRANTYPE_CANCEL, status: 'requested' })], Date.now())).toBeNull();
    // stale(5분 초과) 승인 requested → 자동만료 → 차단 원인 아님.
    expect(resolveBlockingMsgTrace(
      [view({ status: 'requested', createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES + 1) })], Date.now(),
    )).toBeNull();
    expect(resolveBlockingMsgTrace([], Date.now())).toBeNull();
  });
});

// ── in-memory store: L2 partial UNIQUE(check_in·requested) 모사 + listRecentAttempts ──
const APPROVE_OK_RESP =
  '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000003000","TRANDATE":"260804",' +
  '"TRANTIME":"140209","AUTHNO":"32397288    ","MERNO":"MER0001"}';
const mockSender = (raw: string | null) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut: false, msgTrace }));

/**
 * seedInflight=true → 진행중 승인(REAL_INFLIGHT_TRACE, requested, 미수납, 최근) 1건 seed.
 * insertAttempt 는 동일 check_in 에 status='requested' 행이 있으면 CbandConcurrentPaymentError(L2 모사).
 * listRecentAttempts 는 seed 행을 최신순 CbandAttemptView 로 반환(AC-7 원인번호 조회 경로).
 */
function makeBlockStore(seedInflight: boolean) {
  const rows: Array<AttemptRecord & { id: string; paymentId: string | null; createdAt: string }> = [];
  const insertLog: string[] = [];
  let seq = 0;
  if (seedInflight) {
    rows.push({
      id: 'inflight', msgTrace: REAL_INFLIGHT_TRACE, tranType: TRANTYPE_APPROVE, amount: 3000,
      merno: 'MER0001', tid: 'TID12345678', clinicId: 'clinic-1', customerId: 'cust-1',
      checkInId: 'ci-1', originalAuthNo: null, isSimulation: false, status: 'requested',
      paymentId: null, createdAt: nowIso(),
    });
  }
  const store: AttemptStore = {
    async insertAttempt(rec) {
      if (rec.checkInId && rows.some((r) => r.clinicId === rec.clinicId && r.checkInId === rec.checkInId && r.status === 'requested')) {
        insertLog.push('BLOCKED');
        throw new CbandConcurrentPaymentError('patient_in_progress');
      }
      const id = `att-${++seq}`;
      rows.push({ ...rec, id, paymentId: null, createdAt: nowIso() });
      insertLog.push(`INSERT:${rec.msgTrace}`);
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const r = rows.find((x) => x.msgTrace === msgTrace);
      if (r && patch.status) r.status = patch.status;
    },
    async recordCardPayment() { /* noop */ },
    async listRecentAttempts(_q): Promise<CbandAttemptView[]> {
      return [...rows].reverse().map((r) => ({
        id: r.id, msgTrace: r.msgTrace, status: r.status, tranType: r.tranType,
        amount: r.amount, createdAt: r.createdAt, authNo: r.originalAuthNo ?? null, responseCode: null,
      }));
    },
  };
  return { store, rows, insertLog };
}

test.describe('시나리오1/3 — 차단 시 phantom 미발급 + 차단 원인 번호 표시 (AC-1/2/3/5/7)', () => {
  test('결제 차단 → 새 phantom 번호 미노출, msgTrace=차단 원인 번호(658182408832)', async () => {
    const { store, insertLog } = makeBlockStore(true);
    const PHANTOM = '021000000099'; // 이 요청의 새 trace(makeTrace 대체) — 절대 노출되면 안 됨
    const r = await approve(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1' },
      store, mockSender(APPROVE_OK_RESP), { trace: PHANTOM },
    );
    expect(r.blocked).toBe(true);
    expect(r.needsCheck).toBe(true);
    // AC-1/AC-3: 새 phantom 번호(PHANTOM)가 결과에 실리지 않음.
    expect(r.msgTrace).not.toBe(PHANTOM);
    // AC-7: 차단 원인이 된 진행중 시도의 실 번호로 교체.
    expect(r.blockingMsgTrace).toBe(REAL_INFLIGHT_TRACE);
    expect(r.msgTrace).toBe(REAL_INFLIGHT_TRACE);
    expect(r.userMessage).toContain(REAL_INFLIGHT_TRACE);
    // AC-2: phantom attempt row INSERT 0 (insert 시도는 BLOCKED 로만 기록).
    expect(insertLog).toEqual(['BLOCKED']);
  });

  test('AC-5: 취소 4회 연속 차단 → 매번 새 번호 0건(전부 차단 원인 번호 또는 무번호)', async () => {
    const { store, insertLog } = makeBlockStore(true);
    const surfaced: string[] = [];
    for (let i = 0; i < 4; i++) {
      const PHANTOM = `043000000${100 + i}`; // 매 클릭 다른 새 trace
      const r = await cancel(
        { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
          clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1', originalAuthNo: '32397288' },
        store, mockSender(APPROVE_OK_RESP), { trace: PHANTOM },
      );
      expect(r.blocked).toBe(true);
      expect(r.msgTrace).not.toBe(PHANTOM); // 새 phantom 미노출
      surfaced.push(r.msgTrace);
    }
    // 노출된 번호는 오직 '차단 원인 번호' 하나뿐 — 원 증상(서로 다른 5개 가짜 번호) 미재현.
    expect(new Set(surfaced.filter(Boolean))).toEqual(new Set([REAL_INFLIGHT_TRACE]));
    // 4회 취소 모두 phantom attempt INSERT 0 (BLOCKED 로만 기록, sweep 후 재insert 도 BLOCKED).
    expect(insertLog.every((l) => l === 'BLOCKED')).toBe(true);
  });

  test('차단 원인 미특정(조회 경로 없음) → 번호 없이 안내(msgTrace=\'\', blockingMsgTrace=null)', async () => {
    // listRecentAttempts 미구현(degrade) — 원인 조회 불가.
    const rows: Array<AttemptRecord & { id: string; status: AttemptRecord['status'] }> = [{
      id: 'inflight', msgTrace: REAL_INFLIGHT_TRACE, tranType: TRANTYPE_APPROVE, amount: 3000,
      merno: 'MER0001', tid: 'TID12345678', clinicId: 'clinic-1', customerId: 'cust-1',
      checkInId: 'ci-1', originalAuthNo: null, isSimulation: false, status: 'requested',
    }];
    const store: AttemptStore = {
      async insertAttempt(rec) {
        if (rows.some((r) => r.checkInId === rec.checkInId && r.status === 'requested')) {
          throw new CbandConcurrentPaymentError('patient_in_progress');
        }
        return { id: 'x' };
      },
      async updateAttempt() { /* noop */ },
      async recordCardPayment() { /* noop */ },
    };
    const r = await approve(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1' },
      store, mockSender(APPROVE_OK_RESP), { trace: '021000000077' },
    );
    expect(r.blocked).toBe(true);
    expect(r.blockingMsgTrace).toBeNull();
    expect(r.msgTrace).toBe(''); // 번호 없이 안내 — 새 phantom 미노출
    expect(r.msgTrace).not.toBe('021000000077');
  });
});

test.describe('시나리오2 — 실제 전송건은 번호 정상 (AC-4 회귀 방지)', () => {
  test('잠금 없는 정상 승인 → MSG_TRACE 정상 발급·저장(빈값/차단 아님)', async () => {
    const { store, insertLog } = makeBlockStore(false); // in-flight 없음
    const SENT = '021000000042';
    const r = await approve(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-2' },
      store, mockSender(APPROVE_OK_RESP), { trace: SENT },
    );
    expect(r.blocked).toBeFalsy();
    expect(r.classification).toBe('APPROVED');
    // AC-4: 실제 전송건은 그 요청의 MSG_TRACE 를 정상 보유(억제 대상 아님).
    expect(r.msgTrace).toBe(SENT);
    expect(insertLog).toContain(`INSERT:${SENT}`);
  });
});
