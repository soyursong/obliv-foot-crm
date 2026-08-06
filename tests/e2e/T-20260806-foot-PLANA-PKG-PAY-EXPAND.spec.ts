import { test, expect } from '@playwright/test';
import {
  exceedsPerTxnLimit,
  perTxnLimitBlockMessage,
  PER_TXN_LIMIT_KRW,
  buildMsg,
  TRANTYPE_APPROVE,
} from '../../src/lib/cband/protocol';
import {
  approve,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260806-foot-PLANA-PKG-PAY-EXPAND — 플랜A ④ 패키지 결제 확장 (2순위)
 * ────────────────────────────────────────────────────────────────────────────
 * 본 스펙 커버 범위 = AC-2(건당 500만원 초과 FE 사전차단)를 결정론 unit 으로 고정한다.
 *   AC-2 는 카드 탭·패키지 탭 공용 단말 전송 게이트(CbandPayEntryButton onApprove)에 적용되며,
 *   전송 이전(과금 0) 차단이라 순수 술어(exceedsPerTxnLimit) + 흐름 비전송으로 완전 관측 가능하다.
 *
 * ⚠ AC-1(패키지 탭 버튼 배치)·AC-3(패키지/차트 매칭 기록)·AC-4(취소 커플링)의 **영속 모델**은
 *   패키지 결제 기록 착지 위치(payments.package_id + paid_amount 정합 vs package_payments CAT 캐논 컬럼)가
 *   데이터 모델 결정을 요구 → DA CONSULT 재평가 대상(티켓 리스크#1). 본 스펙은 AC-2 안전게이트만 고정하고,
 *   나머지 AC 는 DA 판정 후 별도 스펙으로 확장한다(over-correct 금지·paid_amount 정합 훼손 방지).
 *
 * 실 카드 승인·태블릿 터치·단말 물리 동작 = field-soak(총괄, 갤탭 실기기 confirm).
 */

// ── in-memory AttemptStore + 송신 관측(전송 여부 = sentCount) ──────────────────
function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string; attemptId: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) {
      const id = `attempt-${++seq}`;
      attempts.set(rec.msgTrace, { ...rec });
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
    },
    async recordCardPayment(rec) {
      payments.push(rec);
    },
  };
  return { store, attempts, payments };
}

const REAL_APPROVAL_5M =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"005000000","TRANDATE":"260806","TRANTIME":"131000","AUTHNO":"00328710    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000770","MSG1":"거래 승인00328710"}';

const BASE = {
  tid: 'TID12345678',
  merno: '00918554560',
  catPort: 3,
  clinicId: 'clinic-foot',
  customerId: 'cust-1',
  checkInId: 'ci-1',
};

test.describe('T-20260806 PKG-PAY-EXPAND — AC-2 건당 500만원 초과 사전차단(순수 술어)', () => {
  test('한도값 = 5,000,000원(섹타나인 자리 한도)', () => {
    expect(PER_TXN_LIMIT_KRW).toBe(5_000_000);
  });

  test('한도 이하/정확히 한도 = 전송 허용(false)', () => {
    expect(exceedsPerTxnLimit(1)).toBe(false);
    expect(exceedsPerTxnLimit(50_000)).toBe(false);
    expect(exceedsPerTxnLimit(4_999_999)).toBe(false);
    // ★경계: 정확히 500만원은 허용(초과=차단, 한도값 자체는 통과).
    expect(exceedsPerTxnLimit(5_000_000)).toBe(false);
  });

  test('한도 초과(500만원 + 1원 이상) = 사전 차단(true)', () => {
    expect(exceedsPerTxnLimit(5_000_001)).toBe(true);
    expect(exceedsPerTxnLimit(6_700_000)).toBe(true);
    expect(exceedsPerTxnLimit(30_000_000)).toBe(true);
  });

  test('유효하지 않은 금액(0/음수/NaN/무한)은 한도판정 대상 아님(false — 상위 amount>0 가드가 차단)', () => {
    expect(exceedsPerTxnLimit(0)).toBe(false);
    expect(exceedsPerTxnLimit(-1)).toBe(false);
    expect(exceedsPerTxnLimit(Number.NaN)).toBe(false);
    // 비유한(Infinity)은 유효 금액이 아니므로 한도판정 대상 아님(false) — amount>0·정수 가드가 상위에서 차단.
    expect(exceedsPerTxnLimit(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test('안내 문구 = 개발용어 없는 한국어 + 한도 천단위 콤마 표기', () => {
    const msg = perTxnLimitBlockMessage();
    expect(msg).toContain('5,000,000원');
    expect(msg).toContain('나누어');
    // 개발용어/내부코드 배제(현장 언어 게이트).
    expect(msg).not.toMatch(/limit|van|섹타나인|P2|error|code/i);
  });
});

test.describe('T-20260806 PKG-PAY-EXPAND — AC-2 흐름: 한도는 전송 게이트일 뿐 승인경로 무회귀', () => {
  test('정확히 500만원 = 정상 전송·승인(회귀 없음)', async () => {
    const { store, payments } = makeMemStore();
    let sent = 0;
    const sender = async (_m: string, msgTrace: string): Promise<SendResult> => {
      sent += 1;
      return { raw: REAL_APPROVAL_5M, timedOut: false, msgTrace };
    };
    const r = await approve({ ...BASE, amount: 5_000_000 }, store, sender);
    expect(sent).toBe(1);                    // 한도 이하 → 전송됨
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(5_000_000);
  });

  test('전문 조립도 500만원 TAMT 9자리 정합(전송 게이트는 조립과 직교)', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 5_000_000, catPort: BASE.catPort, msgTrace: '111122225000',
    });
    expect(body.TAMT).toBe('005000000');
  });
});
