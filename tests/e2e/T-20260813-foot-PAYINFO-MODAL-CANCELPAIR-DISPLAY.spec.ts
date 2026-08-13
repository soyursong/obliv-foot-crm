import { test, expect } from '@playwright/test';
import {
  pairApprovalCancel,
  payInfoNetStatusLabel,
  attemptAmount,
  projectRawResponse,
  fmtTranType,
  maskCardNo,
  type PayInfoAttempt,
} from '../../src/lib/cband/payInfoView';
import { normalize, safeParse } from '../../src/lib/cband/protocol';

/**
 * T-20260813-foot-PAYINFO-MODAL-CANCELPAIR-DISPLAY — 결제정보 확인 모달 '승인+취소 동시표시'(기획서 3-2)
 *   결정론 검증(순수 로직). 매칭 키 = AUTHNO(auth_no·원거래 동일) · 구분 = TRANTYPE(0210/0430)+TRANSERIAL(msg_trace).
 * ────────────────────────────────────────────────────────────────────────────
 * 모달 실 조회(supabase·auth·seed)는 물리 환경 필요 → 본 스펙은 페어링/최종상태/금액/PII 순수 로직을
 *   실측 응답전문(T-20260804 REAL_APPROVAL/REAL_CANCEL, 동일 AUTHNO 29258831)으로 고정한다.
 *
 * 현장 클릭 시나리오(티켓) → 순수 로직 대응:
 *   시나리오 1: 취소된 결제행 상세 → 승인 leg + 취소 leg 동시 노출 + '취소됨' 배지.
 *   시나리오 2: 취소 없는 정상 결제행 → 승인 leg only + '정상 승인' 배지.
 *   시나리오 3(엣지): 부분취소 다건 / 승인 부재 / PII 마스킹 계승.
 */

// ── 실측 정본 응답전문(부모 스펙 계승) — 승인·취소가 동일 AUTHNO(29258831)를 공유 ─
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"110341558080",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","MSG1":"거래 승인29258831"}';
const REAL_CANCEL =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"03",' +
  '"TAMT":"000003000","TRANDATE":"260804","TRANTIME":"111230","AUTHNO":"29258831    ",' +
  '"MERNO":"00113742229    ","TRANSERIAL":"111225558081","MSG1":"취소거래승인29258831"}';

function persistedRaw(wire: string): Record<string, unknown> {
  const { raw: _omit, ...safe } = normalize(safeParse(wire));
  return safe as Record<string, unknown>;
}

/** DB row(cband_payment_attempts) → 표시용 PayInfoAttempt (컴포넌트 toAttempt 와 동일 매핑). */
function attemptFromWire(wire: string, opts?: { requested_amount?: number | null }): PayInfoAttempt {
  const n = normalize(safeParse(wire));
  return {
    tran_type: n.tranType,
    auth_no: n.authNo,
    msg_trace: n.msgTrace,
    merno: n.merno,
    cat_tid: null,
    response_code: n.responseCode,
    requested_amount: opts?.requested_amount ?? null,
    raw: projectRawResponse(persistedRaw(wire)),
  };
}

test.describe('시나리오 1: 취소된 결제 — 승인+취소 동시표시', () => {
  const legs = pairApprovalCancel([attemptFromWire(REAL_APPROVAL), attemptFromWire(REAL_CANCEL)]);

  test('페어링 — 승인(0210) leg 1 + 취소(0430) leg 1 분리', () => {
    expect(legs.approval).not.toBeNull();
    expect(fmtTranType(legs.approval!.tran_type)).toBe('승인 (0210)');
    expect(legs.cancels).toHaveLength(1);
    expect(fmtTranType(legs.cancels[0].tran_type)).toBe('취소 (0430)');
  });

  test('매칭 키 = AUTHNO(auth_no) — 승인·취소가 동일 원거래', () => {
    expect(legs.approval!.auth_no).toBe('29258831');
    expect(legs.cancels[0].auth_no).toBe('29258831');
    expect(legs.approval!.auth_no).toBe(legs.cancels[0].auth_no);
  });

  test('구분자 = TRANSERIAL(msg_trace) — 승인·취소 행이 서로 다른 거래고유번호', () => {
    expect(legs.approval!.msg_trace).toBe('110341558080');
    expect(legs.cancels[0].msg_trace).toBe('111225558081');
    expect(legs.approval!.msg_trace).not.toBe(legs.cancels[0].msg_trace);
    expect(legs.cancels[0].msg_trace).toMatch(/^\d{12}$/);
  });

  test('최종상태 — 취소 존재 시 cancelled=true / 배지 "취소됨"', () => {
    expect(legs.cancelled).toBe(true);
    expect(payInfoNetStatusLabel(legs)).toBe('취소됨');
  });

  test('금액 — 승인/취소 각 leg 금액(raw.amount 우선)', () => {
    expect(attemptAmount(legs.approval)).toBe(3000);
    expect(attemptAmount(legs.cancels[0])).toBe(3000);
  });

  test('PII HARD — 취소 leg 도 카드번호 마스킹 계승(평문 PAN 0)', () => {
    const masked = maskCardNo(legs.cancels[0].raw.cardNoMasked);
    expect(masked).toBe('55318440****364*');
    expect(masked).not.toMatch(/\b\d{13,19}\b/);
  });
});

test.describe('시나리오 2: 취소 없는 정상 결제 — 승인 only', () => {
  const legs = pairApprovalCancel([attemptFromWire(REAL_APPROVAL)]);

  test('승인 leg only / 취소 leg 없음', () => {
    expect(legs.approval).not.toBeNull();
    expect(legs.cancels).toHaveLength(0);
  });

  test('최종상태 — cancelled=false / 배지 "정상 승인"', () => {
    expect(legs.cancelled).toBe(false);
    expect(payInfoNetStatusLabel(legs)).toBe('정상 승인');
  });
});

test.describe('시나리오 3: 엣지', () => {
  test('부분취소 다건 — 취소 leg N건이 TRANSERIAL 오름차순 정렬', () => {
    const cancelB = attemptFromWire(
      '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"03",' +
        '"TAMT":"000001000","TRANDATE":"260804","TRANTIME":"113000","AUTHNO":"29258831    ",' +
        '"MERNO":"00113742229    ","TRANSERIAL":"113000558099"}',
    );
    const cancelA = attemptFromWire(REAL_CANCEL); // TRANSERIAL 111225558081
    const legs = pairApprovalCancel([attemptFromWire(REAL_APPROVAL), cancelB, cancelA]);
    expect(legs.cancels).toHaveLength(2);
    // 오름차순: 111225558081 < 113000558099
    expect(legs.cancels.map((c) => c.msg_trace)).toEqual(['111225558081', '113000558099']);
    expect(legs.cancelled).toBe(true);
  });

  test('승인 부재(취소만) — approval=null 이나 cancelled=true 안전 반환', () => {
    const legs = pairApprovalCancel([attemptFromWire(REAL_CANCEL)]);
    expect(legs.approval).toBeNull();
    expect(legs.cancels).toHaveLength(1);
    expect(legs.cancelled).toBe(true);
    expect(payInfoNetStatusLabel(legs)).toBe('취소됨');
  });

  test('빈 입력 방어 — approval=null, cancels=[], cancelled=false', () => {
    const legs = pairApprovalCancel([]);
    expect(legs.approval).toBeNull();
    expect(legs.cancels).toHaveLength(0);
    expect(legs.cancelled).toBe(false);
    expect(payInfoNetStatusLabel(legs)).toBe('정상 승인');
  });

  test('금액 폴백 — raw.amount 부재 시 requested_amount 사용', () => {
    const noAmount: PayInfoAttempt = {
      tran_type: '0210', auth_no: 'X', msg_trace: '000000000001', merno: null, cat_tid: null,
      response_code: '0000', requested_amount: 5000,
      raw: { tranDate: null, tranTime: null, amount: null, halbu: null, cardNoMasked: null, cardName: null },
    };
    expect(attemptAmount(noAmount)).toBe(5000);
    expect(attemptAmount(null)).toBeNull();
  });
});
