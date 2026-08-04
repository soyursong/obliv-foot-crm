import { test, expect } from '@playwright/test';
import {
  isInFlightBlocking,
  hasLiveCompletedPayment,
  classifyConcurrency,
  precheckConcurrentPayment,
  CBAND_ORPHAN_STALE_MINUTES,
  type CbandConcurrencyRow,
  type OpenPaymentProbe,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';

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
