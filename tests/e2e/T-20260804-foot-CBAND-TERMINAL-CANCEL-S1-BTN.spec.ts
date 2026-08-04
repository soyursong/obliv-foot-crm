import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  pad9,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
  CBAND_TCODE,
  CBAND_TCODE_CANCEL,
} from '../../src/lib/cband/protocol';
import {
  cancel,
  approve,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';
import { isPlanACardPayment } from '../../src/components/CbandTerminalCancelButton';

/**
 * T-20260804-foot-CBAND-TERMINAL-CANCEL-S1-BTN — 코밴 [단말기 취소] 버튼(S1 전문) + CRM 취소 분리
 * ────────────────────────────────────────────────────────────────────────────
 * ★ 대원칙(REDEFINITION_RISK 준수): 취소 전문 로직은 PLANA-BUILD §C(cancel()/store) 재사용.
 *   본 스펙은 이 티켓이 신규로 추가한 delta 만 결정론으로 고정한다:
 *     · AC-2  S1 전문     : 취소(0430)=header.TCODE 'S1', 승인(0210)=header.TCODE 'S0'(회귀 금지) + ORI_DATE/ORI_AUTHNO/TAMT.
 *     · AC-3  refund 착지 : 취소 성공 = 별도 refund 기록(tranType 0430), external_approval_no=원거래 AUTHNO(동일값).
 *     · AC-5  멱등 링크키  : refund 조회키(external_approval_no)=원거래 AUTHNO → 재취소 가드가 이 키로 판정.
 *     · AC-1/6/8 버튼 분리 : isPlanACardPayment 판별자(플랜A=[단말기취소]활성/3버튼비활성, 수기=3버튼존치/취소disabled).
 *     · AC-4  파생 표시    : refund 행(external_approval_no) 존재 → 원거래 파생 '취소' 표시(물리 UPDATE 없음).
 *
 * ※ AC-7(BETA 배지)=별 티켓 canonical, 본 스펙 무대상. 실 카드 취소=물리 단말 의존 → field-soak(총괄).
 *   여기선 WS 모킹으로 전문 조립·refund 착지·판별자·파생 상태만 결정론 검증.
 */

// ── 실측 정본 응답 원문(35KB SSOT 부록 · 승인 10:44:26 / 취소 10:44:57) ──────────
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104426","AUTHNO":"28102510    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000759",' +
  '"ISSUECARD":"하나기업","PURCHASECARD":"하나카드","SIGNPATH":"","MSG1":"거래 승인28102510"}';
const REAL_CANCEL =
  '{"ERRCODE":"0000","TRANTYPE":"0430","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104457","AUTHNO":"28102510    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104452000913","MSG1":"취소거래승인28102510"}';

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

// in-memory AttemptStore (부수효과 관측) — PLANA-BUILD 하네스와 동형.
function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) {
      if (attempts.has(rec.msgTrace)) throw new Error('MSG_TRACE 중복');
      const id = `attempt-${++seq}`;
      attempts.set(rec.msgTrace, { ...rec });
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
    },
    async recordCardPayment(rec) {
      payments.push(rec as AttemptRecord & { authNo: string });
    },
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
  return { store, attempts, payments };
}

// ══════════════════════════════════════════════════════════════════════════
// AC-2 — S1 전문(취소=S1 / 승인=S0 회귀금지) + ORI 필드
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 S1 전문 조립 (취소 전용 header.TCODE=S1)', () => {
  test('취소(0430) 전문 → header.TCODE="S1" + ORI_DATE/ORI_AUTHNO/TAMT 정확 착지', () => {
    const { header, fields } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: BASE.merno,
      amount: 1002, catPort: 3, msgTrace: makeTrace(),
      originalAuthNo: '28102510', originalAuthDate: '260731',
    });
    // ★ 핵심 delta: 취소 전문만 header.TCODE 를 S1 로 교체(7/31 실취소 원문 SSOT).
    expect(header.TCODE).toBe('S1');
    expect(CBAND_TCODE_CANCEL).toBe('S1');
    // body: 승인/취소 구분자 + 원거래 참조 + 원승인금액 동일.
    expect(fields.TRANTYPE).toBe('0430');
    expect(fields.ORI_AUTHNO).toBe('28102510');
    expect(fields.ORI_DATE).toBe('260731');
    expect(fields.TAMT).toBe(pad9(1002)); // TAMT=원승인금액 9pad
  });

  test('승인(0210) 전문 → header.TCODE="S0" 회귀 금지 (field-soak 성공값 불변)', () => {
    const { header, fields } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 1002, catPort: 3, msgTrace: makeTrace(),
    });
    // ⚠ 승인은 S0 유지(11:03 실승인 field-soak 성공값) — S1 분기는 취소에만 적용.
    expect(header.TCODE).toBe('S0');
    expect(CBAND_TCODE).toBe('S0');
    expect(fields.TRANTYPE).toBe('0210');
    // 승인 전문에는 원거래 참조 없음(빈값).
    expect(fields.ORI_AUTHNO).toBe('');
    expect(fields.ORI_DATE).toBe('');
  });

  test('취소는 원거래 AUTHNO(ORI_AUTHNO) 필수 — 누락 시 조립 거부', () => {
    expect(() => buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: BASE.merno,
      amount: 1002, catPort: 3, msgTrace: makeTrace(),
    })).toThrow(/AUTHNO/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-3 / AC-5 — refund 착지 + 멱등 링크키(external_approval_no=원거래 AUTHNO)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-3/AC-5 refund 착지 + 링크키', () => {
  test('취소 성공 → refund 기록(0430) + authNo=원거래 AUTHNO(동일값) = 멱등 조회키', async () => {
    const { store, payments } = makeMemStore();
    const r = await cancel(
      { ...BASE, amount: 1002, originalAuthNo: '28102510', originalAuthDate: '260731' },
      store, mockSender(REAL_CANCEL));
    expect(r.classification).toBe('APPROVED');
    expect(r.needsCheck).toBe(false);
    // 별도 refund 기록 1건(원거래 삭제/UPDATE 아님 — store 는 신규 행 push).
    expect(payments).toHaveLength(1);
    expect(payments[0].tranType).toBe('0430'); // store 가 payment_type='refund' 로 착지
    // ★AC-5 링크키: 취소 응답 AUTHNO == 원거래 AUTHNO → external_approval_no 홈 = 재취소 가드 조회키.
    expect(payments[0].authNo).toBe('28102510');
  });

  test('취소 응답 AUTHNO 는 원거래와 동일 → TRANTYPE(0430)로만 취소 판별(AUTHNO로 구분 불가)', async () => {
    const { store, payments } = makeMemStore();
    await approve({ ...BASE, amount: 1002 }, store, mockSender(REAL_APPROVAL));
    await cancel(
      { ...BASE, amount: 1002, originalAuthNo: '28102510', originalAuthDate: '260731' },
      store, mockSender(REAL_CANCEL));
    // 승인·취소 두 기록 모두 authNo 동일(28102510) — 구분자는 tranType(0210 vs 0430).
    expect(payments.map((p) => p.authNo)).toEqual(['28102510', '28102510']);
    expect(payments.map((p) => p.tranType)).toEqual(['0210', '0430']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-1 / AC-6 / AC-8 — 플랜A 판별자(버튼 분리)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-1/6/8 플랜A 판별자 (버튼 분리)', () => {
  const row = (over: Partial<Parameters<typeof isPlanACardPayment>[0]>) =>
    ({ id: 'p1', amount: 1002, payment_attempt_id: 'att-1', external_approval_no: '28102510', ...over });

  test('플랜A(단말기 직결) = payment_attempt_id NOT NULL + AUTHNO 존재 → true ([단말기취소] 활성/3버튼 비활성)', () => {
    expect(isPlanACardPayment(row({}))).toBe(true);
  });

  test('수기 건(payment_attempt_id 없음) → false (기존 3버튼 존치 AC-6 / [단말기취소] disabled AC-8)', () => {
    expect(isPlanACardPayment(row({ payment_attempt_id: null }))).toBe(false);
    expect(isPlanACardPayment(row({ payment_attempt_id: undefined }))).toBe(false);
  });

  test('AUTHNO 부재 → false (안전측 수기 취급 — 취소 전문 ORI_AUTHNO 불가하므로 [단말기취소] 비노출)', () => {
    expect(isPlanACardPayment(row({ external_approval_no: null }))).toBe(false);
    expect(isPlanACardPayment(row({ external_approval_no: '   ' }))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-4 — 파생 '취소' 표시(원거래 물리 UPDATE 없이 refund 행 존재로 판정)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 파생 취소 표시 (refund 링크키 집합 멤버십)', () => {
  // CheckInDetailSheet 의 파생 판정과 동형: 목록 refund 행들의 external_approval_no 집합에
  // 원거래 external_approval_no 가 포함되면 '취소' 파생 표시(원거래 status 는 'active' 유지).
  type P = { payment_type: string; external_approval_no?: string | null };
  const refundedSet = (list: P[]) =>
    new Set(list.filter((r) => r.payment_type === 'refund' && r.external_approval_no?.trim())
      .map((r) => (r.external_approval_no as string).trim()));
  const isDerivedCancelled = (p: P, list: P[]) =>
    p.payment_type !== 'refund' && !!p.external_approval_no?.trim()
    && refundedSet(list).has(p.external_approval_no.trim());

  test('원거래에 링크된 refund 행 존재 → 파생 취소=true', () => {
    const orig: P = { payment_type: 'payment', external_approval_no: '28102510' };
    const refund: P = { payment_type: 'refund', external_approval_no: '28102510' };
    expect(isDerivedCancelled(orig, [orig, refund])).toBe(true);
  });

  test('refund 행 없음 → 파생 취소=false (원거래만 존재)', () => {
    const orig: P = { payment_type: 'payment', external_approval_no: '28102510' };
    expect(isDerivedCancelled(orig, [orig])).toBe(false);
  });

  test('다른 AUTHNO refund 는 무관 → 파생 취소=false (링크키 불일치)', () => {
    const orig: P = { payment_type: 'payment', external_approval_no: '28102510' };
    const otherRefund: P = { payment_type: 'refund', external_approval_no: '99999999' };
    expect(isDerivedCancelled(orig, [orig, otherRefund])).toBe(false);
  });
});
