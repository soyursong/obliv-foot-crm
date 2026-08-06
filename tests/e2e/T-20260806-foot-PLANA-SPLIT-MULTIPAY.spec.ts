import { test, expect } from '@playwright/test';
import {
  createSplitSession,
  nextPendingLeg,
  applyLegResult,
  resetLegForRetry,
  classifySession,
  advanceHalts,
  partialFailureOptions,
  collectApprovals,
  type SplitSession,
} from '../../src/lib/cband/splitPayment';
import { classifyConcurrency } from '../../src/lib/cband/paymentFlow';
import type { PaymentFlowResult } from '../../src/lib/cband/paymentFlow';

/**
 * T-20260806-foot-PLANA-SPLIT-MULTIPAY — 플랜A ② 분할결제(복수 결제수단) · AC-0 design-first
 * ────────────────────────────────────────────────────────────────────────────
 * 설계: docs/PLANA-SPLIT-MULTIPAY-DESIGN.md
 * ★물리 CAT 단말은 Playwright 왕복 불가(INSTALLMENT-HALBU/NULLREF 선례) → 순수 상태머신 단위로 assert.
 *   실단말 2건 분할·중간실패·연속전송 잠금은 현장 field-soak(총괄).
 *
 * 3대 불변식 검증:
 *   1. 자동취소 금지(AC-2) — 중간실패는 halt만, 승인분 자동취소 경로 부재.
 *   2. 하드락 유지(AC-3) — splitContext 는 소프트(patient_completed)만 억제, 하드락은 유지.
 *   3. 스키마 무접촉(AC-4) — 승인번호 묶음 = check_in_id 링크(신규 컬럼 0).
 */

const CTX = { checkInId: 'ci-1', clinicId: 'cl-1', customerId: 'cu-1' };

/** PaymentFlowResult 헬퍼(테스트용 최소 필드). */
function approved(authNo: string, msgTrace = 'trace-a'): PaymentFlowResult {
  return {
    classification: 'APPROVED', msgTrace, response: null, userMessage: '',
    needsCheck: false, authNo, approvalDate: '260806', approvalTime: '120000',
  };
}
function failed(msgTrace = 'trace-f'): PaymentFlowResult {
  return {
    classification: 'FAIL', msgTrace, response: null, userMessage: '',
    needsCheck: false, authNo: null, approvalDate: null, approvalTime: null,
  };
}
function attention(msgTrace = 'trace-x'): PaymentFlowResult {
  return {
    classification: 'ATTENTION', msgTrace, response: null, userMessage: '',
    needsCheck: true, authNo: null, approvalDate: null, approvalTime: null,
  };
}

test.describe('AC-1 순차 전송 · 개별 승인번호', () => {
  test('세션 생성: amount≤0 레그 제외 + totalAmount 합산', () => {
    const s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 0 },       // 제외
      { method: 'cash', amount: 50000 },
    ]);
    expect(s.legs).toHaveLength(2);
    expect(s.totalAmount).toBe(150000);
    expect(s.legs.map((l) => l.index)).toEqual([0, 1]);
  });

  test('nextPendingLeg: 순차로 다음 pending 레그를 반환, 없으면 null', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    expect(nextPendingLeg(s)?.index).toBe(0);
    s = applyLegResult(s, 0, approved('AUTH001'));
    expect(nextPendingLeg(s)?.index).toBe(1);
    s = applyLegResult(s, 1, approved('AUTH002'));
    expect(nextPendingLeg(s)).toBeNull();
  });

  test('각 레그가 개별 승인번호를 각인 → completed', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000, installmentMonths: 3 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001', 't1'));
    s = applyLegResult(s, 1, approved('AUTH002', 't2'));
    expect(classifySession(s)).toBe('completed');
    expect(s.legs[0].authNo).toBe('AUTH001');
    expect(s.legs[1].authNo).toBe('AUTH002');
    expect(s.legs[1].installmentMonths).toBe(3);
  });
});

test.describe('🔴 AC-2 중간 실패 = 부분결제 · 자동취소 절대 금지', () => {
  test('1건 승인 + 2건 실패 → partial_failure, 진행 halt', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001'));
    s = applyLegResult(s, 1, failed());
    expect(classifySession(s)).toBe('partial_failure');
    expect(advanceHalts(s)).toBe(true);   // ★자동 진행 금지
  });

  test('부분결제 옵션: 승인분은 자동취소 대상이 아니라 "취소 가능 후보"로만 노출', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001'));
    s = applyLegResult(s, 1, failed());
    const opt = partialFailureOptions(s);
    expect(opt.isPartial).toBe(true);
    expect(opt.retryableLegs).toEqual([1]);          // 실패 레그만 재시도
    expect(opt.cancellableApprovedLegs).toEqual([0]); // 승인 레그 = 사람이 골라야 취소
    expect(opt.approvedTotal).toBe(100000);
    expect(opt.outstanding).toBe(200000);            // 유지 시 잔액
    expect(opt.userMessage).toContain('자동으로 취소하지 않았습니다');
  });

  test('실패 레그 재시도: failed→pending, 승인분(approved)은 절대 되돌리지 않음', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001'));
    s = applyLegResult(s, 1, failed());
    s = resetLegForRetry(s, 1);
    expect(s.legs[1].outcome).toBe('pending');
    expect(s.legs[0].outcome).toBe('approved');  // ★승인분 불변
    expect(nextPendingLeg(s)?.index).toBe(1);
    // 재시도 성공 → completed
    s = applyLegResult(s, 1, approved('AUTH002'));
    expect(classifySession(s)).toBe('completed');
  });

  test('확인필요(attention)는 재시도 불가 대상 · resetLegForRetry 무효(D 상태머신 규칙 계승)', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001'));
    s = applyLegResult(s, 1, attention());
    expect(classifySession(s)).toBe('partial_failure');
    const opt = partialFailureOptions(s);
    expect(opt.attentionLegs).toEqual([1]);
    expect(opt.retryableLegs).toEqual([]);           // attention 은 재시도 후보 아님
    s = resetLegForRetry(s, 1);
    expect(s.legs[1].outcome).toBe('attention');     // ★되돌려지지 않음
  });

  test('전부 실패(승인 0) → failed', () => {
    let s = createSplitSession(CTX, [{ method: 'card', amount: 100000 }]);
    s = applyLegResult(s, 0, failed());
    expect(classifySession(s)).toBe('failed');
    expect(partialFailureOptions(s).isPartial).toBe(false);
  });
});

test.describe('AC-3 이중결제 잠금 예외 — 소프트만 억제, 하드락 유지', () => {
  test('splitContext=true: patient_completed(소프트) 통과', () => {
    const probe = { patientInProgress: false, patientCompleted: true, terminalBusy: false };
    expect(classifyConcurrency(probe).blocked).toBe(true);                 // 기본: 완료건 confirm
    expect(classifyConcurrency(probe, { splitContext: true }).blocked).toBe(false); // 분할: 통과
  });

  test('splitContext=true 여도 patient_in_progress(하드락)은 계속 차단', () => {
    const probe = { patientInProgress: true, patientCompleted: false, terminalBusy: false };
    const d = classifyConcurrency(probe, { splitContext: true });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('patient_in_progress');
  });

  test('splitContext=true 여도 terminal_busy(하드락)은 계속 차단', () => {
    const probe = { patientInProgress: false, patientCompleted: false, terminalBusy: true };
    const d = classifyConcurrency(probe, { splitContext: true });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('terminal_busy');
  });

  test('회귀: opts 미지정 시 기존 동작 완전 동일', () => {
    expect(classifyConcurrency({ patientInProgress: false, patientCompleted: true, terminalBusy: false }).allowOverride).toBe(true);
    expect(classifyConcurrency({ patientInProgress: false, patientCompleted: false, terminalBusy: false }).blocked).toBe(false);
  });
});

test.describe('AC-4 한 수납 ↔ 복수 승인번호 묶음 (스키마 무접촉 · check_in_id)', () => {
  test('collectApprovals: 승인 레그만 묶음 + approvalNumbers/총액/checkInId 앵커', () => {
    let s: SplitSession = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001', 't1'));
    s = applyLegResult(s, 1, approved('AUTH002', 't2'));
    const g = collectApprovals(s);
    expect(g.checkInId).toBe('ci-1');                 // ★묶음 앵커 = 기존 check_in_id
    expect(g.approvalNumbers).toEqual(['AUTH001', 'AUTH002']);
    expect(g.total).toBe(300000);
    expect(g.items[0].authNo).toBe('AUTH001');        // external_approval_no ↔ 레드페이 별개 승인 1:1
  });

  test('부분결제 상태에서도 승인분만 묶음(미승인 레그 제외)', () => {
    let s = createSplitSession(CTX, [
      { method: 'card', amount: 100000 },
      { method: 'card', amount: 200000 },
    ]);
    s = applyLegResult(s, 0, approved('AUTH001'));
    s = applyLegResult(s, 1, failed());
    const g = collectApprovals(s);
    expect(g.approvalNumbers).toEqual(['AUTH001']);
    expect(g.total).toBe(100000);
  });
});
