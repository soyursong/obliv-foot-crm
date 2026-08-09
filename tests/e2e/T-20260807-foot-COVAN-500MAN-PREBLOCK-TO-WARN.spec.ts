import { test, expect } from '@playwright/test';
import {
  classifySeatTid,
  shouldWarnOverLimit,
  OVER_LIMIT_WARN_MESSAGE,
  P2_SEAT_TIDS,
  P3_SEAT_TIDS,
} from '../../src/lib/cband/seatLimitPolicy';
import { errcodeMessage, PER_TXN_LIMIT_KRW } from '../../src/lib/cband/protocol';
import {
  approve,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260807-foot-COVAN-500MAN-PREBLOCK-TO-WARN — 코밴 500만 하드 사전차단 → 경고 후 진행
 * ────────────────────────────────────────────────────────────────────────────
 * 본 스펙 = PKG-PAY-EXPAND(commit 54d3478e)가 도입한 "건당 500만원 하드 사전차단"을 제거하고,
 *   TID(결제 자리)별 분기로 P2 자리 + 500만원 초과일 때만 '경고 후 진행'하도록 바꾼 정책을
 *   결정론 unit 으로 고정한다.
 *   · AC-1 하드 사전차단 제거 → 전송 흐름(approve)은 금액이 500만을 넘어도 전송·기록한다(플로우 무차단).
 *   · AC-2 P2 자리 + 초과 → shouldWarnOverLimit=true(FE 확인창 게이트 신호).
 *   · AC-2b P3 자리 → 금액 무관 무경고(870만 실측 통과).
 *   · AC-2c 미등재 TID → 무경고 진행.
 *   · AC-3 확인창 문구 = reporter 확정 verbatim.
 *   · AC-5 단말 8324(승인서버응답 거래거절) → 한글 사유 표시(미출금·재시도 안전).
 *
 * 실 카드 승인·태블릿 터치·확인창 클릭·단말 물리 동작 = field-soak(총괄, 갤탭 실기기 confirm).
 */

// ── 자리(TID) 분류 목록 = reporter 제공 39개 전수(P2 26 / P3 13) ────────────────
const P2_SAMPLE = '1047538231'; // (VAN) 미포함 = 경고 대상
const P3_SAMPLE = '1047535797'; // (VAN) 포함 = 경고 없음(금액무관 통과)
const UNLISTED = '9999999999';  // 39개 목록에 없는 자리

test.describe('COVAN-500MAN — AC-4(b) 자리 목록 상수 분리(P2 26 / P3 13)', () => {
  test('P2 자리 26개, P3 자리 13개(reporter 전수)', () => {
    expect(P2_SEAT_TIDS.size).toBe(26);
    expect(P3_SEAT_TIDS.size).toBe(13);
  });

  test('P2·P3 목록 교집합 없음(자리 중복 배정 방지)', () => {
    for (const t of P2_SEAT_TIDS) expect(P3_SEAT_TIDS.has(t)).toBe(false);
  });

  test('한도값 = 5,000,000원(섹타나인 자리 추정 한도, 미확정)', () => {
    expect(PER_TXN_LIMIT_KRW).toBe(5_000_000);
  });
});

test.describe('COVAN-500MAN — 자리 분류(classifySeatTid)', () => {
  test('P2 목록 → P2', () => {
    expect(classifySeatTid(P2_SAMPLE)).toBe('P2');
    expect(classifySeatTid('1047479483')).toBe('P2'); // P2 목록 끝값
  });
  test('P3 목록 → P3', () => {
    expect(classifySeatTid(P3_SAMPLE)).toBe('P3');
    expect(classifySeatTid('1047479268')).toBe('P3'); // P3 목록 끝값
  });
  test('미등재/빈값/공백 → UNLISTED', () => {
    expect(classifySeatTid(UNLISTED)).toBe('UNLISTED');
    expect(classifySeatTid('')).toBe('UNLISTED');
    expect(classifySeatTid(null)).toBe('UNLISTED');
    expect(classifySeatTid(undefined)).toBe('UNLISTED');
  });
  test('trim 정규화(앞뒤 공백 무시)', () => {
    expect(classifySeatTid(`  ${P2_SAMPLE} `)).toBe('P2');
    expect(classifySeatTid(` ${P3_SAMPLE}`)).toBe('P3');
  });
});

test.describe('COVAN-500MAN — 경고 판정(shouldWarnOverLimit): P2 + 초과일 때만', () => {
  test('AC-2: P2 자리 + 500만원 초과 → 경고(true)', () => {
    expect(shouldWarnOverLimit(P2_SAMPLE, 5_000_001)).toBe(true);
    expect(shouldWarnOverLimit(P2_SAMPLE, 6_700_000)).toBe(true);
    expect(shouldWarnOverLimit(P2_SAMPLE, 30_000_000)).toBe(true);
  });
  test('AC-2 시나리오 3: P2 자리 + 한도 이하/정확히 500만 → 무경고(false, 회귀 락)', () => {
    expect(shouldWarnOverLimit(P2_SAMPLE, 4_999_000)).toBe(false);
    expect(shouldWarnOverLimit(P2_SAMPLE, 5_000_000)).toBe(false); // 경계: 정확히 500만은 무경고
    expect(shouldWarnOverLimit(P2_SAMPLE, 50_000)).toBe(false);
  });
  test('AC-2b: P3 자리 → 금액 무관 무경고(870만도 false, P2 경고 P3 노출 금지)', () => {
    expect(shouldWarnOverLimit(P3_SAMPLE, 8_700_000)).toBe(false);
    expect(shouldWarnOverLimit(P3_SAMPLE, 30_000_000)).toBe(false);
    expect(shouldWarnOverLimit(P3_SAMPLE, 4_999_000)).toBe(false);
  });
  test('AC-2c: 미등재 TID → 금액 무관 무경고(false)', () => {
    expect(shouldWarnOverLimit(UNLISTED, 6_700_000)).toBe(false);
    expect(shouldWarnOverLimit('', 6_700_000)).toBe(false);
    expect(shouldWarnOverLimit(null, 6_700_000)).toBe(false);
  });
});

test.describe('COVAN-500MAN — AC-3 확인창 문구(reporter 확정 verbatim)', () => {
  test('문구 = reporter 제공 그대로', () => {
    expect(OVER_LIMIT_WARN_MESSAGE).toBe(
      '이 자리는 500만원을 넘는 결제가 되지 않을 수 있습니다. (확인 중인 사항입니다) 그래도 진행하시겠습니까?',
    );
  });
  test('개발용어/내부코드 없음(현장 언어 게이트) + 미확정 뉘앙스 포함', () => {
    expect(OVER_LIMIT_WARN_MESSAGE).toContain('확인 중인 사항');
    expect(OVER_LIMIT_WARN_MESSAGE).not.toMatch(/van|섹타나인|\bP2\b|error|code|tid/i);
  });
});

test.describe('COVAN-500MAN — AC-5 8324(승인서버응답 거래거절) 한글 사유 표시', () => {
  test('8324 → 법인카드 할부불가 안내(미출금·재시도 안전)', () => {
    const m = errcodeMessage('8324');
    expect(m).not.toBeNull();
    expect(m).toContain('법인카드');
    expect(m).toContain('할부');
  });
});

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

const REAL_APPROVAL_OVER =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"008700000","TRANDATE":"260807","TRANTIME":"131000","AUTHNO":"00328720    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000771","MSG1":"거래 승인00328720"}';

const REAL_REJECT_8324 =
  '{"ERRCODE":"8324","TRANTYPE":"0210","MSG1":"할부개월수 오류","TRANSERIAL":"104421000772"}';

const BASE = {
  merno: '00918554560',
  catPort: 3,
  clinicId: 'clinic-foot',
  customerId: 'cust-1',
  checkInId: 'ci-1',
};

test.describe('COVAN-500MAN — AC-1 흐름: 하드 사전차단 제거 = 500만 초과도 전송·기록(플로우 무차단)', () => {
  test('P2 자리 870만원(초과) → 실 전송 + 승인 기록(경고는 FE 게이트일 뿐, 흐름은 안 막음)', async () => {
    const { store, payments } = makeMemStore();
    let sent = 0;
    const sender = async (_m: string, msgTrace: string): Promise<SendResult> => {
      sent += 1;
      return { raw: REAL_APPROVAL_OVER, timedOut: false, msgTrace };
    };
    const r = await approve({ ...BASE, tid: P2_SAMPLE, amount: 8_700_000 }, store, sender);
    expect(sent).toBe(1); // ★하드 사전차단 제거 — 500만 초과여도 전송됨
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(8_700_000);
  });

  test('AC-5: 단말 8324 거절 → FAIL 로 수렴(자동 재시도 아님·미출금 안전)', async () => {
    const { store } = makeMemStore();
    const sender = async (_m: string, msgTrace: string): Promise<SendResult> =>
      ({ raw: REAL_REJECT_8324, timedOut: false, msgTrace });
    const r = await approve({ ...BASE, tid: P2_SAMPLE, amount: 6_700_000 }, store, sender);
    // 8324 = 0000/ATTENTION/UNCLEAR 어디에도 없어 classify 가 FAIL 로 폴백(재시도 안전).
    expect(r.classification).toBe('FAIL');
    expect(errcodeMessage('8324')).toContain('법인카드');
  });
});
