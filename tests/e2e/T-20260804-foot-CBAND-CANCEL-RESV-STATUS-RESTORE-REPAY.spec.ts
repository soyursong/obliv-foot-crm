import { test, expect } from '@playwright/test';
import { netPaidFromPayments, type PackagePaymentRow } from '../../src/lib/footBilling';
import {
  isInFlightBlocking,
  hasLiveCompletedPayment,
  classifyConcurrency,
  type CbandConcurrencyRow,
} from '../../src/lib/cband/paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-CANCEL-RESV-STATUS-RESTORE-REPAY — 코밴 단말기 취소(S1) 성공 후
 * 예약/방문 '결제완료' 상태 자동 복원 + 재결제 무차단 (P0 hotfix)
 * ────────────────────────────────────────────────────────────────────────────
 * RCA(dev 확정, 코드 대조):
 *   ① 결제 성공은 예약/방문에 **stored 상태를 남기지 않는다** — settle 경로는 status='done'/
 *      dark_gray/visit_type 전이를 모두 제거함(T-20260727-foot-PMW-SETTLE-NOAUTOCOMPLETE).
 *      따라서 '결제완료'는 payments 합에서 파생되는 **표시 배지**다(CheckInDetailSheet).
 *   ② 그런데 그 배지의 파생값 totalPaid 가 `payment_type==='payment'` 만 합산 →
 *      환불(refund) 행을 차감하지 않았다. S1 취소 = refund 행 INSERT + 원거래 payments 물리
 *      UPDATE 없음(3-way canon AC-4) → 취소 후에도 원 payment 행이 남아 배지 '결제완료' 잔존.
 *   ③ 동시성 배너(patient_completed)는 cband_payment_attempts 파생(hasLiveCompletedPayment,
 *      취소 AUTHNO 상쇄) — 자매 PAYLOCK 티켓이 소유·해소. 배지와 배너가 같은 취소-완료 트랜잭션
 *      (= refund 행 + 취소 attempt)에서 함께 복원되어야 화면-정책이 정합.
 *
 * 수정(본 티켓): CheckInDetailSheet 의 '결제완료' 배지 파생값을 순납부액(Σpayment − Σrefund)으로
 *   재계산(netPaidFromPayments SSOT 재사용). db_change=false·display 파생만·forward-only.
 *
 * 단일 취소-완료 핸들러 수렴(REDEFINITION_NOTE §13.1.A): S1 취소 성공 시 refund 행 1건이
 *   (a) net 납부액 차감 → 배지 '결제완료' 복원[본 티켓] (b) 취소 attempt(AUTHNO 상쇄) →
 *   patient_completed 해제[본 티켓] (c) in-flight 정밀화 → patient_in_progress 해제[자매]를
 *   모두 파생시킨다 — 경쟁하는 두 핸들러 없음.
 *
 * 커버(현장 클릭 시나리오 E2E 변환):
 *   · 시나리오1(취소 후 재결제 무차단, AC-1/AC-2): 전액 취소 → net=0(배지 미결제) + 배너 무차단.
 *   · 시나리오2(취소 실패는 상태 유지, AC-3): refund 행 미생성 → net 불변(결제완료 유지).
 *   · 시나리오3(미취소 완료건 유지, AC-4): 취소 없음 → net>0(결제완료) + 배너 정책대로 confirm.
 *   · 시나리오4(자매 정합, AC-5): 취소 후 두 배너(진행중·완료) 어느 것도 차단 안 함.
 */

const NOW = Date.parse('2026-08-04T05:10:00.000Z');
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function pay(over: Partial<PackagePaymentRow>): PackagePaymentRow {
  return { amount: 0, payment_type: 'payment', ...over };
}
function crow(over: Partial<CbandConcurrencyRow>): CbandConcurrencyRow {
  return { status: 'requested', tranType: TRANTYPE_APPROVE, authNo: null, paymentId: null, createdAt: minAgo(1), ...over };
}

// ════════════════════════════════════════════════════════════════════════════
// AC-2 / AC-3 / AC-4 — '결제완료' 배지 파생값(순납부액) 이 환불을 차감한다
// ════════════════════════════════════════════════════════════════════════════
test.describe("결제완료 배지 순납부액 — netPaidFromPayments (AC-2/3/4)", () => {
  test('AC-2 시나리오1: 전액 취소(payment=refund) → net=0 → 배지 미결제(수납 이전 복원)', () => {
    const rows = [
      pay({ amount: 30000, payment_type: 'payment' }),
      pay({ amount: 30000, payment_type: 'refund' }),  // S1 취소 성공 = refund 행 INSERT
    ];
    const totalPaid = netPaidFromPayments(rows);
    expect(totalPaid).toBe(0);
    expect(totalPaid > 0).toBe(false);  // 배지 조건(totalPaid>0)=false → '미결제'
  });

  test('AC-3 시나리오2: 취소 실패(refund 행 미생성) → net 불변 → 결제완료 유지', () => {
    const rows = [pay({ amount: 30000, payment_type: 'payment' })];  // 취소 미성립 → refund 없음
    const totalPaid = netPaidFromPayments(rows);
    expect(totalPaid).toBe(30000);
    expect(totalPaid > 0).toBe(true);   // 배지 '결제완료' 유지(과잉복원 0·이중결제 방지)
  });

  test('AC-4 시나리오3: 미취소 완료건 → net>0 → 결제완료 유지', () => {
    const rows = [
      pay({ amount: 50000, payment_type: 'payment' }),
      pay({ amount: 20000, payment_type: 'payment' }),
    ];
    expect(netPaidFromPayments(rows)).toBe(70000);
  });

  test('AC-4: 부분취소 → 잔액만큼 결제완료 유지(과잉복원 금지)', () => {
    const rows = [
      pay({ amount: 50000, payment_type: 'payment' }),
      pay({ amount: 20000, payment_type: 'refund' }),  // 부분 환불
    ];
    const totalPaid = netPaidFromPayments(rows);
    expect(totalPaid).toBe(30000);
    expect(totalPaid > 0).toBe(true);   // 잔액 남음 → 여전히 '결제완료'
  });

  test('환불행 amount 는 양수 저장·음수 반영(표시 규약 정합)', () => {
    // 환불 amount 는 양수로 저장되고 배지/목록에서 음수로 반영(CheckInDetailSheet 2158 '-' prefix).
    expect(netPaidFromPayments([pay({ amount: 10000, payment_type: 'refund' })])).toBe(-10000);
  });

  test('빈/누락 입력 안전(파생 0)', () => {
    expect(netPaidFromPayments([])).toBe(0);
    expect(netPaidFromPayments(null)).toBe(0);
    expect(netPaidFromPayments(undefined)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC-5 — 단일 취소-완료 트랜잭션(refund 행 + 취소 attempt) 이 배지·두 배너를 함께 복원
//   (배너 술어는 자매 PAYLOCK 소유이나, 본 티켓의 '수렴' 계약을 회귀 가드로 고정한다.)
// ════════════════════════════════════════════════════════════════════════════
test.describe('취소 후 재결제 무차단 — 배지·두 배너 정합 수렴 (AC-1/AC-5)', () => {
  test('시나리오1/4: 취소 후 → 배지 미결제 + 두 배너(진행중·완료) 모두 무차단', () => {
    const AUTH = '29258831';
    // 코밴 결제 승인 → S1 취소 성공: 원거래 approve + 취소 attempt(동일 AUTHNO 상쇄) + refund payments.
    const cbandRows: CbandConcurrencyRow[] = [
      crow({ tranType: TRANTYPE_APPROVE, status: 'approved', authNo: AUTH, paymentId: 'pmt-orig', createdAt: minAgo(3) }),
      crow({ tranType: TRANTYPE_CANCEL, status: 'approved', authNo: AUTH, paymentId: 'pmt-refund', createdAt: minAgo(1) }),
    ];
    const decision = classifyConcurrency({
      patientInProgress: cbandRows.some((r) => isInFlightBlocking(r, NOW)),
      patientCompleted: hasLiveCompletedPayment(cbandRows),
      terminalBusy: false,
    });
    expect(decision.blocked).toBe(false);       // 두 배너 어느 것도 차단 안 함(AC-5)
    expect(decision.reason).toBeNull();

    // 같은 취소 트랜잭션의 payments(원 payment + refund) → 배지 net=0(수납 이전 복원, AC-2).
    const payRows = [
      pay({ amount: 30000, payment_type: 'payment' }),
      pay({ amount: 30000, payment_type: 'refund' }),
    ];
    expect(netPaidFromPayments(payRows)).toBe(0);
  });

  test('시나리오3 정합: 미취소 완료건은 배지 결제완료 + patient_completed confirm 유도(정책 무변경)', () => {
    const cbandRows: CbandConcurrencyRow[] = [
      crow({ tranType: TRANTYPE_APPROVE, status: 'approved', authNo: 'A1', paymentId: 'pmt-1', createdAt: minAgo(3) }),
    ];
    const decision = classifyConcurrency({
      patientInProgress: cbandRows.some((r) => isInFlightBlocking(r, NOW)),
      patientCompleted: hasLiveCompletedPayment(cbandRows),
      terminalBusy: false,
    });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('patient_completed');
    expect(decision.allowOverride).toBe(true);  // confirm 후 진행 허용(차단 아님)
    expect(netPaidFromPayments([pay({ amount: 30000, payment_type: 'payment' })])).toBe(30000);
  });
});
