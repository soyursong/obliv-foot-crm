import { test, expect } from '@playwright/test';
import {
  isInFlightBlocking,
  hasLiveCompletedPayment,
  classifyConcurrency,
  precheckConcurrentPayment,
  cancel,
  approve,
  CBAND_ORPHAN_STALE_MINUTES,
  CbandConcurrentPaymentError,
  type CbandConcurrencyRow,
  type OpenPaymentProbe,
  type AttemptStore,
  type AttemptRecord,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY — 단말기 취소 후 재결제 잠금 해제 (P0 hotfix)
 * ────────────────────────────────────────────────────────────────────────────
 * RCA(prod 실증, check_in 70970d18): 취소(0430) 성공 시도가 payment_id(환불행)는 남겼으나
 *   status='requested' 로 고착(updateAttempt 승격 유실) → probeConcurrent.patientInProgress
 *   (status='requested' 단독)이 in-flight 로 오인 → 취소 후 재결제가 '결제 진행 중'으로 영구 차단.
 *   + insert-first L2 partial UNIQUE(status='requested') 도 재결제 INSERT 를 23505 로 차단.
 *
 * 수정: (1) 잠금 술어를 '진짜 in-flight'(isInFlightBlocking: APPROVE ∧ requested/attention ∧
 *   미수납 ∧ 5분 이내)로 정밀화 (2) precheck 前 sweep-heal(고착 requested+payment_id→approved)로
 *   L2 UNIQUE 자연 해제 (3) 수동 종료 처리(releaseAttempt) 경로. 스키마 무변(db_change=false).
 *
 * 커버(현장 클릭 시나리오 E2E 변환):
 *  · 시나리오1(취소 후 재결제 무차단): AC-1/AC-2 — 취소 시도·수납성립·고착은 잠금에서 자연 제외.
 *  · 시나리오2(진짜 in-flight 차단 유지): AC-3 — 응답 전 미수납·최근 requested 는 계속 차단.
 *  · 시나리오4(애매/무응답 '확인 필요' 유지): AC-6 — 최근 attention(미수납)은 계속 차단.
 *  · 시나리오5(5분 자동만료): AC-7 — 5분 경과 requested/attention 은 잠금 해제.
 *  · precheck 가 sweep-heal 을 선행 호출하는지(AC-1 L2 해제 배선) 계약 고정.
 *  · 시나리오7/8(취소 = 결제잠금 완전 분리): 증분-6/AC-11 — mig 20260804210000 으로 L2 partial UNIQUE 를
 *      승인(tran_type='0210') 전용으로 narrowing → 취소(0430)는 인덱스 미참여 → 같은 환자 진짜 in-flight
 *      승인이 있어도 취소는 무차단. 이중결제 방어(승인 vs 승인)는 무회귀(AC-3/AC-4).
 */

const NOW = Date.parse('2026-08-04T05:10:00.000Z');
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function row(over: Partial<CbandConcurrencyRow>): CbandConcurrencyRow {
  return {
    status: 'requested',
    tranType: TRANTYPE_APPROVE,
    authNo: null,
    paymentId: null,
    createdAt: minAgo(1),
    ...over,
  };
}

test.describe('isInFlightBlocking — 진짜 in-flight 만 잠금 (AC-1/3/6/7)', () => {
  test('AC-3: 응답 전 in-flight(APPROVE·requested·미수납·최근) → 잠금', () => {
    expect(isInFlightBlocking(row({ status: 'requested', paymentId: null, createdAt: minAgo(1) }), NOW)).toBe(true);
  });

  test('AC-6: 최근 확인필요(APPROVE·attention·미수납) → 잠금 유지(이중결제 방어)', () => {
    expect(isInFlightBlocking(row({ status: 'attention', paymentId: null, createdAt: minAgo(2) }), NOW)).toBe(true);
  });

  test('AC-1: 취소(0430) 시도는 결코 잠금 아님 — 고착 requested 여도', () => {
    // RCA 재현: 취소 성공 시도가 status=requested 로 고착(payment_id 있음) → 잠금 안 됨.
    expect(isInFlightBlocking(row({ tranType: TRANTYPE_CANCEL, status: 'requested', paymentId: 'pmt-refund', createdAt: minAgo(0) }), NOW)).toBe(false);
    // 미수납 취소 시도(요청 직후)도 '결제 진행 중' 아님(취소는 결제가 아니다).
    expect(isInFlightBlocking(row({ tranType: TRANTYPE_CANCEL, status: 'requested', paymentId: null, createdAt: minAgo(0) }), NOW)).toBe(false);
  });

  test('AC-1: 수납 성립(payment_id) 시도는 진행 중 아님 → 잠금 제외', () => {
    expect(isInFlightBlocking(row({ status: 'requested', paymentId: 'pmt-1', createdAt: minAgo(1) }), NOW)).toBe(false);
    expect(isInFlightBlocking(row({ status: 'attention', paymentId: 'pmt-1', createdAt: minAgo(1) }), NOW)).toBe(false);
  });

  test('AC-7: 5분 경과(stale) requested/attention → 자동 만료(잠금 해제)', () => {
    const stale = CBAND_ORPHAN_STALE_MINUTES + 1;
    expect(isInFlightBlocking(row({ status: 'requested', paymentId: null, createdAt: minAgo(stale) }), NOW)).toBe(false);
    expect(isInFlightBlocking(row({ status: 'attention', paymentId: null, createdAt: minAgo(stale) }), NOW)).toBe(false);
    // 경계: 정확히 5분은 아직 잠금(>= cutoff).
    expect(isInFlightBlocking(row({ status: 'requested', paymentId: null, createdAt: minAgo(CBAND_ORPHAN_STALE_MINUTES) }), NOW)).toBe(true);
  });

  test('종료 상태(failed/approved)는 잠금 아님', () => {
    expect(isInFlightBlocking(row({ status: 'failed', createdAt: minAgo(0) }), NOW)).toBe(false);
    expect(isInFlightBlocking(row({ status: 'approved', paymentId: 'p', createdAt: minAgo(0) }), NOW)).toBe(false);
  });
});

test.describe('hasLiveCompletedPayment — 취소 상쇄 반영 (AC-1 시나리오1 매끄러움)', () => {
  test('미취소 완료 결제 → confirm 유도(true, 시나리오3 정책 무변경)', () => {
    const rows = [row({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1' })];
    expect(hasLiveCompletedPayment(rows)).toBe(true);
  });

  test('AC-1: 결제→취소(동일 AUTHNO)면 상쇄 → confirm 안 뜸(false)', () => {
    const rows = [
      row({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1' }),
      row({ status: 'approved', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund' }),
    ];
    expect(hasLiveCompletedPayment(rows)).toBe(false);
  });

  test('취소가 requested 로 고착돼도 AUTHNO 매칭이면 상쇄(RCA 정합)', () => {
    const rows = [
      row({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1' }),
      row({ status: 'requested', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund' }),
    ];
    expect(hasLiveCompletedPayment(rows)).toBe(false);
  });
});

test.describe('classifyConcurrency 통합 — probe 결과 → 배너 (RCA 시나리오)', () => {
  test('시나리오1: 취소 후 재결제 → 차단 없음(blocked=false)', () => {
    // RCA 상태: 취소 시도(고착 requested·환불행) + 원 승인(취소로 상쇄) → 잠금 0, 완료 0.
    const rows: CbandConcurrencyRow[] = [
      row({ status: 'attention', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p-approve', createdAt: minAgo(180) }),
      row({ status: 'requested', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund', createdAt: minAgo(8) }),
    ];
    const probe: OpenPaymentProbe = {
      patientInProgress: rows.some((r) => isInFlightBlocking(r, NOW)),
      patientCompleted: hasLiveCompletedPayment(rows),
      terminalBusy: false,
    };
    expect(probe.patientInProgress).toBe(false);
    expect(probe.patientCompleted).toBe(false);
    expect(classifyConcurrency(probe).blocked).toBe(false);
  });

  test('시나리오2: 진짜 in-flight → 결제 진행 중 하드차단', () => {
    const rows: CbandConcurrencyRow[] = [row({ status: 'requested', paymentId: null, createdAt: minAgo(0) })];
    const probe: OpenPaymentProbe = {
      patientInProgress: rows.some((r) => isInFlightBlocking(r, NOW)),
      patientCompleted: hasLiveCompletedPayment(rows),
      terminalBusy: false,
    };
    const d = classifyConcurrency(probe);
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('patient_in_progress');
    expect(d.allowOverride).toBe(false);
  });

  test('시나리오4: 애매/무응답(최근 attention) → 확인 필요 유지(차단)', () => {
    const rows: CbandConcurrencyRow[] = [row({ status: 'attention', paymentId: null, createdAt: minAgo(1) })];
    const probe: OpenPaymentProbe = {
      patientInProgress: rows.some((r) => isInFlightBlocking(r, NOW)),
      patientCompleted: hasLiveCompletedPayment(rows),
      terminalBusy: false,
    };
    expect(classifyConcurrency(probe).blocked).toBe(true);
  });
});

test.describe('precheckConcurrentPayment — sweep-heal 선행 배선 (AC-1 L2 해제)', () => {
  test('probe 前 sweepStaleRequested 를 자기 check_in 스코프로 호출한다', async () => {
    const calls: Array<{ clinicId: string; checkInId?: string }> = [];
    const store: AttemptStore = {
      insertAttempt: async () => ({ id: 'x' }),
      updateAttempt: async () => {},
      recordCardPayment: async () => {},
      sweepStaleRequested: async (q) => { calls.push(q); return { swept: 1 }; },
      probeConcurrent: async () => ({ patientInProgress: false, patientCompleted: false, terminalBusy: false }),
    };
    const decision = await precheckConcurrentPayment(
      { clinicId: 'clinic-1', checkInId: 'ci-1', merno: 'm1' },
      store,
    );
    expect(calls).toEqual([{ clinicId: 'clinic-1', checkInId: 'ci-1' }]);
    expect(decision.blocked).toBe(false);
  });

  test('sweep 실패해도 재결제 진행(degrade-open) + probe 는 계속 수행', async () => {
    let probed = false;
    const store: AttemptStore = {
      insertAttempt: async () => ({ id: 'x' }),
      updateAttempt: async () => {},
      recordCardPayment: async () => {},
      sweepStaleRequested: async () => { throw new Error('sweep boom'); },
      probeConcurrent: async () => { probed = true; return { patientInProgress: false, patientCompleted: false, terminalBusy: false }; },
    };
    const decision = await precheckConcurrentPayment(
      { clinicId: 'c', checkInId: 'ci', merno: null },
      store,
    );
    expect(probed).toBe(true);
    expect(decision.blocked).toBe(false);
  });
});

// ── 취소 heal-and-retry in-memory store: L2 UNIQUE(check_in·requested) 모사 + sweep-heal ──
const CANCEL_OK_RESP =
  '{"ERRCODE":"0000","TRANTYPE":"0430","TAMT":"000003000","TRANDATE":"260804",' +
  '"TRANTIME":"140209","AUTHNO":"29258831    ","MERNO":"MER0001"}';
const mockSender = (raw: string | null) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut: false, msgTrace }));

/** 고착 requested(승인·payment_id 있음) 1건을 seed → L2 UNIQUE 모사 + sweep-heal 반영. */
function makeCancelHealStore(seedStuck: boolean) {
  const rows: Array<AttemptRecord & { id: string; paymentId: string | null }> = [];
  const log: string[] = [];
  let seq = 0;
  if (seedStuck) {
    // 승인 성공했으나 terminal 미전이(사일런트 실패)로 status='requested' 고착 + 수납성립(payment_id).
    rows.push({
      id: 'stuck-approve', msgTrace: 'trace-approve', tranType: TRANTYPE_APPROVE, amount: 3000,
      merno: 'MER0001', tid: 'TID12345678', clinicId: 'clinic-1', customerId: 'cust-1',
      checkInId: 'ci-1', originalAuthNo: null, isSimulation: false, status: 'requested',
      paymentId: 'pmt-approve',
    });
  }
  const store: AttemptStore = {
    async insertAttempt(rec) {
      // ★AC-11(mig 20260804210000): L2 partial UNIQUE 를 승인(tran_type='0210') 전용으로 narrowing 한 실 스키마 모사.
      //   승인(0210) 'requested' 끼리만 충돌(이중결제 방어). 취소(0430)는 인덱스 미참여 → 결코 L2 로 차단되지 않음(완전 분리).
      if (
        rec.checkInId &&
        rec.tranType === TRANTYPE_APPROVE &&
        rows.some((r) => r.clinicId === rec.clinicId && r.checkInId === rec.checkInId && r.status === 'requested' && r.tranType === TRANTYPE_APPROVE)
      ) {
        log.push('insert:BLOCKED');
        throw new CbandConcurrentPaymentError('patient_in_progress');
      }
      const id = `att-${++seq}`;
      rows.push({ ...rec, id, paymentId: null });
      log.push(`insert:${rec.tranType}:${id}`);
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const r = rows.find((x) => x.msgTrace === msgTrace);
      if (r && patch.status) r.status = patch.status;
      log.push(`update:${patch.status ?? ''}`);
    },
    async recordCardPayment() { log.push('payment'); },
    // ★sweep-heal: status='requested' ∧ payment_id 있음 → 'approved'(근거게이팅). L2 자연해제.
    async sweepStaleRequested(q) {
      let swept = 0;
      for (const r of rows) {
        if (r.clinicId === q.clinicId && (!q.checkInId || r.checkInId === q.checkInId)
          && r.status === 'requested' && r.paymentId != null) { r.status = 'approved'; swept++; }
      }
      log.push(`sweep:${swept}`);
      return { swept };
    },
  };
  return { store, rows, log };
}

test.describe('취소 = 환자단위 결제잠금 완전 분리 (증분-6 / AC-11 · mig 20260804210000)', () => {
  test('시나리오7: 결제 승인 직후(고착 requested 승인 존재) 즉시 취소 → L2 미참여로 무차단 전송(AC-10+AC-11)', async () => {
    const { store, log } = makeCancelHealStore(true);
    const r = await cancel(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1', originalAuthNo: '29258831' },
      store, mockSender(CANCEL_OK_RESP), { trace: '480400000001' },
    );
    // ★AC-11: 취소는 승인(0210) 전용 L2 인덱스에 참여하지 않으므로, 고착 승인 requested 가 있어도 결코 BLOCKED 되지 않는다.
    //   heal-retry 백스톱조차 발화 불요(구조적 분리) → 취소 즉시 승인.
    expect(log).not.toContain('insert:BLOCKED');
    expect(r.blocked).toBeFalsy();
    expect(r.classification).toBe('APPROVED');
    expect(r.authNo).toBe('29258831');
  });

  test('시나리오8: 같은 환자 진짜 in-flight(미수납 requested 승인)여도 다른 완료건 취소는 무차단(AC-11 핵심)', async () => {
    const { store, log } = makeCancelHealStore(false);
    // 같은 check_in 에 '진짜 in-flight' 승인(payment_id 없음·최근) seed — 실제 결제 진행 중.
    await store.insertAttempt({
      msgTrace: 'trace-inflight', tranType: TRANTYPE_APPROVE, amount: 3000, merno: 'MER0001',
      tid: 'TID12345678', clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1',
      originalAuthNo: null, isSimulation: false, status: 'requested',
    });
    // 다른 완료 건(원거래 AUTHNO 29258831)에 대한 취소 → in-flight 승인과 무관하게 전송되어야 한다.
    const r = await cancel(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1', originalAuthNo: '29258831' },
      store, mockSender(CANCEL_OK_RESP), { trace: '480400000002' },
    );
    expect(log).not.toContain('insert:BLOCKED');   // ★취소는 환자단위 결제잠금을 '참조하지 않음'(완전 분리).
    expect(r.blocked).toBeFalsy();
    expect(r.classification).toBe('APPROVED');
  });

  test('이중결제 방어 무회귀(AC-3/AC-4): 같은 환자 진짜 in-flight 승인은 두 번째 승인(결제)을 계속 하드차단', async () => {
    const { store } = makeCancelHealStore(false);
    // 미수납 in-flight 승인(payment_id 없음) seed.
    await store.insertAttempt({
      msgTrace: 'trace-inflight', tranType: TRANTYPE_APPROVE, amount: 3000, merno: 'MER0001',
      tid: 'TID12345678', clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1',
      originalAuthNo: null, isSimulation: false, status: 'requested',
    });
    // 같은 환자에 대한 '결제(승인)' 재시도 → L2(승인 전용) 로 여전히 차단(이중결제 방지 불변식 보존).
    const r = await approve(
      { tid: 'TID12345678', merno: 'MER0001', catPort: 'COM3', amount: 3000,
        clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1' },
      store, mockSender(CANCEL_OK_RESP), { trace: '021000000009' },
    );
    expect(r.blocked).toBe(true);
    expect(r.needsCheck).toBe(true);
  });
});
