import { test, expect } from '@playwright/test';
import { isPlanACardPayment } from '../../src/components/CbandTerminalCancelButton';
import { classify, exceedsPerTxnLimit, type NormalizedResponse } from '../../src/lib/cband/protocol';
import {
  approve,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT — 상담실 회차권 결제 3버튼(전부 BETA)
 * ────────────────────────────────────────────────────────────────────────────
 * 본 스펙 = 이 티켓의 **결정론 신규 로직**을 순수 unit 으로 고정한다:
 *   ① VG-4 판별자: isPlanACardPayment (플랜A vs 기존방식) — AC-3 짝맞춤의 심장.
 *   ② AC-3 짝맞춤 진리표: 기존 환불 buttonEnabled ⟺ !플랜A / 플랜A 환불 buttonEnabled ⟺ 플랜A(버튼 disabled 강제).
 *   ③ AC-1 atomic(VG-2): classify 3분류 → onSettle 분기(승인=티켓유지 / 정의적FAIL=티켓삭제 rollback / 확인필요=티켓보존).
 *   ④ AC-1/AC-2 착지: package 결제도 500만 한도 게이트·packageId 전파(package_payments 착지) 계승(PKG-PAY-EXPAND SSOT 재사용).
 *
 * ⚠ 화면 배치(AC-1 [결제 및 티켓 생성] 모달 하단 · AC-2 티켓행 [결제] · AC-3 일마감 결제내역 신규 컬럼)와
 *   실 단말 승인·태블릿 터치·DB 행 착지·paid_amount 재계산 = field-soak(총괄, 갤탭 실기기 confirm) + browser-verify.
 *   본 스펙은 판별/분기 로직만 결정론으로 고정(paid_amount 정합 훼손 방지·over-assert 금지).
 */

// ── NormalizedResponse 최소 팩토리(classify 결정론 관측용) ──────────────────────
function nr(partial: Partial<NormalizedResponse>): NormalizedResponse {
  return {
    tranType: null, authNo: null, responseCode: null, dllRet: null,
    responseMessage: null, merno: null, amount: null, msgTrace: null,
    tranDate: null, tranTime: null, cardName: null, halbu: null,
    cardNoMasked: null, raw: { X: 1 }, // raw 비어있지 않게(파싱실패 폴백 회피)
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① VG-4 — isPlanACardPayment 판별자 진리표 (AC-3 짝맞춤의 결정론 근거)
//    플랜A(단말기 직결) = payment_attempt_id(CAT-origin FK) ∧ external_approval_no(AUTHNO) 존재.
//    구분(패키지/단건) 무관 — 결제방식으로만 판단(티켓 AC-3).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('VG-4 플랜A 판별자 — isPlanACardPayment', () => {
  test('플랜A = payment_attempt_id ∧ external_approval_no 둘 다 존재', () => {
    expect(isPlanACardPayment({ id: 'p1', amount: 1000, payment_attempt_id: 'att-1', external_approval_no: '00328710' })).toBe(true);
  });

  test('기존방식(수기/외부) = payment_attempt_id 없음 → false', () => {
    expect(isPlanACardPayment({ id: 'p2', amount: 1000, payment_attempt_id: null, external_approval_no: '00328710' })).toBe(false);
    expect(isPlanACardPayment({ id: 'p3', amount: 1000, external_approval_no: '00328710' })).toBe(false);
  });

  test('AUTHNO 없음/공백 → false(취소 전문 ORI_AUTHNO 필수라 승인번호 없으면 플랜A 취소 불가·안전측)', () => {
    expect(isPlanACardPayment({ id: 'p4', amount: 1000, payment_attempt_id: 'att-1', external_approval_no: null })).toBe(false);
    expect(isPlanACardPayment({ id: 'p5', amount: 1000, payment_attempt_id: 'att-1', external_approval_no: '   ' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② AC-3 짝맞춤 진리표 — 버튼 비활성 강제(안내문 회피). 오판별 = 환불 오활성 사고 → 결정론 고정.
//    기존 환불 enabled ⟺ !플랜A · 플랜A 환불(BETA) enabled ⟺ 플랜A. 상호배타(동시 활성/동시 비활성 금지).
// ─────────────────────────────────────────────────────────────────────────────
type RefundRow = { payment_attempt_id?: string | null; external_approval_no?: string | null };
// Closing.tsx rowIsPlanAPayment 와 동치인 파생(동일 판별자 재사용) — 진리표 관측용.
function pairing(row: RefundRow) {
  const planA = isPlanACardPayment({ id: '', amount: 0, ...row });
  return { legacyRefundEnabled: !planA, planARefundEnabled: planA };
}

test.describe('AC-3 결제방식↔환불방식 짝맞춤(상호배타)', () => {
  test('플랜A 결제행 → 기존 환불 비활성 · 플랜A 환불 활성', () => {
    const r = pairing({ payment_attempt_id: 'att-9', external_approval_no: '00328697' });
    expect(r.legacyRefundEnabled).toBe(false);
    expect(r.planARefundEnabled).toBe(true);
  });

  test('기존방식 결제행 → 기존 환불 활성 · 플랜A 환불 비활성', () => {
    const r = pairing({ payment_attempt_id: null, external_approval_no: null });
    expect(r.legacyRefundEnabled).toBe(true);
    expect(r.planARefundEnabled).toBe(false);
  });

  test('상호배타 불변식 — 두 버튼이 동시에 같은 상태일 수 없음(오활성 방지)', () => {
    for (const row of [
      { payment_attempt_id: 'a', external_approval_no: 'b' },
      { payment_attempt_id: null, external_approval_no: 'b' },
      { payment_attempt_id: 'a', external_approval_no: null },
      {},
    ] as RefundRow[]) {
      const r = pairing(row);
      expect(r.legacyRefundEnabled).not.toBe(r.planARefundEnabled);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ AC-1 atomic(VG-2) — classify 3분류가 onSettle 티켓 rollback 분기를 결정.
//    승인(APPROVED·needsCheck=false) → 티켓 유지 / 정의적 FAIL(needsCheck=false) → 티켓 삭제(rollback)
//    / ATTENTION(무응답·불확실) → 티켓 보존(과금 가능성 배제 못함, 자동 삭제/재시도 금지).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 atomic — 결제 분류 → 티켓 rollback 분기(VG-2)', () => {
  test('APPROVED = 승인번호 수신 → 티켓 유지(생성 확정)', () => {
    expect(classify(nr({ responseCode: '0000', authNo: '00328710' }))).toBe('APPROVED');
  });

  test('정의적 FAIL = 명확한 거절코드(승인번호 없음) → 티켓 삭제(rollback·과금 미발생 확정)', () => {
    // 승인 실패(예: 한도/거절) — ATTENTION 집합 아님 + AUTHNO 없음.
    expect(classify(nr({ responseCode: '0051', authNo: null }))).toBe('FAIL');
  });

  test('무응답(타임아웃) = ATTENTION → 티켓 보존(삭제 금지·과금 성립 가능성)', () => {
    expect(classify(null)).toBe('ATTENTION');
  });

  test('단말 통신이상(C011/8003/8555)·전문불일치 = ATTENTION → 티켓 보존', () => {
    expect(classify(nr({ responseCode: 'C011' }))).toBe('ATTENTION');
    expect(classify(nr({ responseCode: '8555' }))).toBe('ATTENTION');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ AC-1/AC-2 착지 — 패키지 결제도 500만 한도 게이트 + packageId 전파(package_payments 착지) 계승.
//    (PKG-PAY-EXPAND SSOT 재사용 — 상담실 surface 도 동일 CbandPayEntryButton 전송 게이트/착지 판별자 사용.)
// ─────────────────────────────────────────────────────────────────────────────
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"002960000","TRANDATE":"260807","TRANTIME":"131000","AUTHNO":"00328710    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000770","MSG1":"거래 승인00328710"}';

function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string; attemptId: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) { attempts.set(rec.msgTrace, { ...rec }); return { id: `attempt-${++seq}` }; },
    async updateAttempt(msgTrace, patch) { const c = attempts.get(msgTrace); if (c) attempts.set(msgTrace, { ...c, ...patch }); },
    async recordCardPayment(rec) { payments.push(rec); },
  };
  return { store, payments };
}

const BASE = { tid: 'TID12345678', merno: '00918554560', catPort: 3, clinicId: 'clinic-foot', customerId: 'cust-1', checkInId: null as string | null };

test.describe('AC-1/AC-2 착지 — 패키지 총액 결제(package_payments 판별자 전파)', () => {
  const sender = (raw: string) => async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut: false, msgTrace });

  test('패키지 총액 2,960,000원(≤500만) = 전송 허용 + 승인 + package_payments 착지 판별자', async () => {
    // 티켓 예시 금액 2,960,000 = 한도 이하(경고 없음) + 할부 대상(5만 초과)이나 본 스펙은 착지 판별만 관측.
    expect(exceedsPerTxnLimit(2_960_000)).toBe(false);
    const { store, payments } = makeMemStore();
    const r = await approve({ ...BASE, packageId: 'pkg-consult-1', amount: 2_960_000 }, store, sender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    // ★VG-1: packageId 전파 → package_payments 착지(payments 중복 revenue행 금지).
    expect(payments[0].packageId).toBe('pkg-consult-1');
  });

  test('패키지 총액 500만원 초과 = 사전차단 게이트 계승(경고 후 진행 대상)', () => {
    expect(exceedsPerTxnLimit(5_000_001)).toBe(true);
  });
});
