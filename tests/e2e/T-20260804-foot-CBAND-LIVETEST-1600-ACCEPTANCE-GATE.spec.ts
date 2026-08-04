import { test, expect } from '@playwright/test';
import { netPaidFromPayments, type PackagePaymentRow } from '../../src/lib/footBilling';
import {
  isInFlightBlocking,
  hasLiveCompletedPayment,
  classifyConcurrency,
  precheckConcurrentPayment,
  type CbandConcurrencyRow,
  type OpenPaymentProbe,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-LIVETEST-1600-ACCEPTANCE-GATE — CBAND 단말기직접결제
 * 16:00 라이브 테스트 인수 게이트 (acceptance-verification umbrella)
 * ────────────────────────────────────────────────────────────────────────────
 * 본 spec 은 신규 스펙이 아니라 현장(reporter U05L6HE7QF6, 채널 C0ATE5P6JTH)이 제시한
 * 6개 인수기준(AC1~AC6)을, 이미 prod 반영된 하위 CBAND 티켓의 배포 계약(순수함수)에
 * 묶어 **acceptance-level 회귀 가드**로 고정한다. 현장 클릭 시나리오 3종을 E2E 로 변환한다.
 *
 * 인수기준 ↔ 배포 계약(SSOT) 매핑:
 *  · AC1 (결제 완료 시 정확히 그 환자 CRM 에 적재)
 *      → PAYRESP-RECORD-PERSIST-VERIFY / CATRECEIPT-REALPAY-Y (deployed)
 *      → 배지 파생: netPaidFromPayments(Σpayment − Σrefund)
 *  · AC2 (취소 즉시 가능 + 취소기록 전부 적재)
 *      → TERMINAL-CANCEL-S1-BTN / PAYMENT-APPROVE-CANCEL-TIMESTAMP (deployed)
 *      → hasLiveCompletedPayment(취소 AUTHNO 상쇄)
 *  · AC3 (결제금액 취소 → 자동 '미결제' 전환)
 *      → CANCEL-RESV-STATUS-RESTORE-REPAY (deployed, f185c3f7)
 *      → netPaidFromPayments 전액취소 → net=0 → 배지 '미결제'
 *  · AC4 (결제 후 즉시 취소 + 취소 후 즉시 재결제)
 *      → CANCEL-PAYLOCK-RELEASE-REPAY (deployed, 7e97ba98/PR#86)
 *      → isInFlightBlocking / precheck sweep-heal → 재결제 무차단
 *  · AC5 (모든 동작 정확·신속)
 *      → PAY-ASYNCFLOW-CONFIRM (done) — 배너 분기 결정론성(순수함수)
 *  · AC6 (기존 결제시스템 무변동 + 교차 이중결제 차단·선택가능·취소 전까지)
 *      → PAYCOMPLETE-CONFIRM-GUARD / MATAEMIN-PAYMENT-COMPLETE-ROLLBACK
 *      → classifyConcurrency(patient_completed → 차단, allowOverride=true 선택가능)
 *
 * 라이브 하드웨어(실 카드 트랜잭션)는 Playwright 로 구동 불가 → 배포 계약(순수함수) 계약고정으로
 * 인수기준 불변식을 회귀 가드한다. UI 통합·실단말 승인은 현장 라이브 테스트가 담당(standby).
 */

const NOW = Date.parse('2026-08-04T07:00:00.000Z'); // 16:00 KST
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function crow(over: Partial<CbandConcurrencyRow>): CbandConcurrencyRow {
  return { status: 'requested', tranType: TRANTYPE_APPROVE, authNo: null, paymentId: null, createdAt: minAgo(1), ...over };
}
function pay(over: Partial<PackagePaymentRow>): PackagePaymentRow {
  return { amount: 0, payment_type: 'payment', ...over };
}
function probeOf(rows: CbandConcurrencyRow[], terminalBusy = false): OpenPaymentProbe {
  return {
    patientInProgress: rows.some((r) => isInFlightBlocking(r, NOW)),
    patientCompleted: hasLiveCompletedPayment(rows),
    terminalBusy,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 시나리오 1: 정상 결제 → 적재 (AC1)
//   데스크에서 환자 선택 → CBAND 결제 → 승인 완료 → CRM 결제내역에 정확한 금액 표시
// ════════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 정상 결제 → 적재 (AC1)', () => {
  test('AC1: 단말 승인 완료 결제행 → 배지 순납부액에 정확히 반영', () => {
    // 3만원 CBAND 승인 1건 → CRM 결제내역 배지 = 30000
    const rows = [pay({ amount: 30000, payment_type: 'payment' })];
    expect(netPaidFromPayments(rows)).toBe(30000);
  });

  test('AC1: 완료(approved·미취소) 승인 시도 → patient_completed 로 인지(적재 확인)', () => {
    const rows = [crow({ status: 'approved', authNo: 'A1', paymentId: 'p1' })];
    expect(hasLiveCompletedPayment(rows)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 시나리오 2: 취소 → 미결제 → 재결제 (AC2 / AC3 / AC4)
// ════════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 취소 → 미결제 → 재결제 (AC2/AC3/AC4)', () => {
  test('AC2: 취소 기록(refund 행) 적재 — 취소 AUTHNO 상쇄로 완료 인지 해제', () => {
    // 승인(A1) + 동일 AUTHNO 취소 → 취소기록 남고, 살아있는 완료건 없음
    const rows = [
      crow({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1' }),
      crow({ status: 'approved', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund' }),
    ];
    expect(hasLiveCompletedPayment(rows)).toBe(false);
  });

  test('AC3: 결제금액 전액 취소 → net=0 → 배지 자동 "미결제" 전환', () => {
    // S1 취소 = refund 행 INSERT(원거래 물리 UPDATE 없음) → 순납부액 0
    const rows = [
      pay({ amount: 30000, payment_type: 'payment' }),
      pay({ amount: 30000, payment_type: 'refund' }),
    ];
    expect(netPaidFromPayments(rows)).toBe(0); // 0 = '미결제'(수납 이전 상태 복원)
  });

  test('AC3: 부분 취소 → 잔액만 결제완료로 유지(전액 아닐 때 미결제 아님)', () => {
    const rows = [
      pay({ amount: 30000, payment_type: 'payment' }),
      pay({ amount: 10000, payment_type: 'refund' }),
    ];
    expect(netPaidFromPayments(rows)).toBe(20000);
  });

  test('AC4: 취소 후 재결제 무차단 — 취소 시도는 in-flight 잠금 아님', () => {
    // 취소(0430) 시도가 status=requested 로 고착(환불행)되어도 '결제 진행 중' 아님
    const cancelStuck = crow({ tranType: TRANTYPE_CANCEL, status: 'requested', paymentId: 'p-refund', createdAt: minAgo(0) });
    expect(isInFlightBlocking(cancelStuck, NOW)).toBe(false);

    // 취소로 상쇄된 상태 → 재결제 진입 시 배너 무차단
    const rows = [
      crow({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p-approve', createdAt: minAgo(30) }),
      crow({ status: 'requested', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund', createdAt: minAgo(5) }),
    ];
    expect(classifyConcurrency(probeOf(rows)).blocked).toBe(false);
  });

  test('AC4: 재결제 정밀검사가 고착 requested 를 sweep-heal 선행 → L2 잠금 자연 해제', async () => {
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
    expect(calls).toEqual([{ clinicId: 'clinic-1', checkInId: 'ci-1' }]); // heal 선행 배선
    expect(decision.blocked).toBe(false); // 취소 후 재결제 허용
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 시나리오 3: 중복결제 방어 (AC6) — 취소 전까지 교차 이중결제 차단(선택가능)
// ════════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 중복결제 방어 (AC6)', () => {
  test('AC6: 단말/기존 어느 쪽이든 완료건 존재 → 재결제 시 차단(안내)', () => {
    // 살아있는 완료 결제(취소 없음) → 교차 재결제 시도 시 '이미 결제됨' 차단
    const rows = [crow({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1', createdAt: minAgo(20) })];
    const d = classifyConcurrency(probeOf(rows));
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('patient_completed');
  });

  test('AC6: 선택가능 — 완료건 차단은 실장 confirm 후 진행 허용(allowOverride=true)', () => {
    const rows = [crow({ status: 'approved', authNo: 'A1', paymentId: 'p1', createdAt: minAgo(20) })];
    const d = classifyConcurrency(probeOf(rows));
    expect(d.allowOverride).toBe(true); // 추가 결제가 맞으면 confirm 후 진행(선택가능)
  });

  test('AC6: 취소 후에는 재결제 허용(취소 전까지만 차단)', () => {
    // 완료건이 동일 AUTHNO 취소로 상쇄 → 차단 해제
    const rows = [
      crow({ status: 'approved', tranType: TRANTYPE_APPROVE, authNo: 'A1', paymentId: 'p1', createdAt: minAgo(20) }),
      crow({ status: 'approved', tranType: TRANTYPE_CANCEL, authNo: 'A1', paymentId: 'p-refund', createdAt: minAgo(3) }),
    ];
    expect(classifyConcurrency(probeOf(rows)).blocked).toBe(false);
  });

  test('AC6: 진짜 in-flight(응답 전 미수납) → 하드차단, override 불가(이중결제 하드백스톱)', () => {
    const rows = [crow({ status: 'requested', paymentId: null, createdAt: minAgo(0) })];
    const d = classifyConcurrency(probeOf(rows));
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('patient_in_progress');
    expect(d.allowOverride).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 시나리오 5(횡단): 모든 동작 정확·신속 (AC5) — 분기 결정의 결정론성
//   같은 probe 는 항상 같은 결정(비결정/레이스 없음) → 신속·정확 계약 고정
// ════════════════════════════════════════════════════════════════════════════
test.describe('횡단: 분기 결정론성 (AC5)', () => {
  test('AC5: 우선순위 진행중 > 단말사용중 > 완료 (동시 조건 시 안전 우선)', () => {
    const probe: OpenPaymentProbe = { patientInProgress: true, terminalBusy: true, patientCompleted: true };
    expect(classifyConcurrency(probe).reason).toBe('patient_in_progress');
  });

  test('AC5: 단말 사용중 → 하드차단(override 불가)', () => {
    const probe: OpenPaymentProbe = { patientInProgress: false, terminalBusy: true, patientCompleted: false };
    const d = classifyConcurrency(probe);
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('terminal_busy');
    expect(d.allowOverride).toBe(false);
  });

  test('AC5: 클린 상태(진행중·단말·완료 모두 없음) → 즉시 결제 허용', () => {
    const probe: OpenPaymentProbe = { patientInProgress: false, terminalBusy: false, patientCompleted: false };
    expect(classifyConcurrency(probe).blocked).toBe(false);
  });
});
