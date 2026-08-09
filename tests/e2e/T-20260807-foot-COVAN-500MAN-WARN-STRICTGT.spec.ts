import { test, expect } from '@playwright/test';
import {
  exceedsPerTxnLimit,
  PER_TXN_LIMIT_KRW,
} from '../../src/lib/cband/protocol';
import {
  shouldWarnOverLimit,
  classifySeatTid,
} from '../../src/lib/cband/seatLimitPolicy';

/**
 * T-20260807-foot-COVAN-500MAN-WARN-STRICTGT — 코밴 500만 경고 경계조건 '초과(strictly greater than)' 확정·검증
 * ════════════════════════════════════════════════════════════════════════════
 * 상위: T-20260807-foot-COVAN-500MAN-PREBLOCK-TO-WARN(deployed 75ad2e88) 가 도입한 경고 게이트의
 *   경계 semantic(이상 >= vs 초과 >)을 '초과(>)'로 **확정**하고 그 boundary 를 이 티켓 ID 로 영구 lock 한다.
 *
 * ── 배경(reporter 최필경 총괄, 실데이터 근거) ──────────────────────────────────
 *   · 실결제 691건: 정각 5,000,000원 = 2건 성공, 5,000,000원 초과 = 0건 → 카드사는 '초과'만 차단.
 *   · 안내문 '500만원을 넘는 결제' = 초과(>), 이상(>=) 아님 → 문구-로직 정합.
 *   · >= 이면 정각 5백만마다 불필요한 확인창(UX 마찰).
 *
 * ── ★검증 결과 = 배포본이 이미 strict `>` 로 구현됨(신규 production 코드 무변경) ──────
 *   protocol.ts        exceedsPerTxnLimit(amount) = amount > PER_TXN_LIMIT_KRW   ← `>` (>= 아님)
 *   seatLimitPolicy.ts shouldWarnOverLimit(tid,a)  = classifySeatTid===P2 && exceedsPerTxnLimit(a)
 *   → reporter DoD 3항(a strict>, b 정각 500만 무경고, c 5,000,001↑ 경고) 전부 기충족.
 *
 * ── DoD (reporter) 를 결정론 unit 으로 lock ────────────────────────────────────
 *   DoD-a: 경고 조건 = amount > 5,000,000 (strictly greater — 경계 정각은 미포함)
 *   DoD-b: 정각 5,000,000원 → 경고창 미표시(false)
 *   DoD-c: 5,000,001원 이상 → 경고창 표시(P2 자리 한정, true)
 *
 * 실 카드 승인·태블릿 터치·확인창 렌더 = field-soak(총괄, 갤탭 실기기 confirm — COVAN soak 에 포함).
 */

const P2_SEAT = '1047538231'; // (VAN) 미포함 = 경고 대상(P2). classifySeatTid → 'P2'
const LIMIT = 5_000_000;      // PER_TXN_LIMIT_KRW

test.describe('COVAN-500MAN-STRICTGT — 한도 상수 sanity', () => {
  test('PER_TXN_LIMIT_KRW = 5,000,000', () => {
    expect(PER_TXN_LIMIT_KRW).toBe(LIMIT);
  });
  test('샘플 자리 = P2(경고 대상)', () => {
    expect(classifySeatTid(P2_SEAT)).toBe('P2');
  });
});

test.describe('COVAN-500MAN-STRICTGT — DoD-a: exceedsPerTxnLimit 은 strict `>` (이상 아님)', () => {
  test('정각 한도(5,000,000) → false (경계값 미포함 — `>` 의 핵심)', () => {
    expect(exceedsPerTxnLimit(LIMIT)).toBe(false);
  });
  test('한도 +1(5,000,001) → true (초과 시작점)', () => {
    expect(exceedsPerTxnLimit(LIMIT + 1)).toBe(true);
  });
  test('한도 -1(4,999,999) → false', () => {
    expect(exceedsPerTxnLimit(LIMIT - 1)).toBe(false);
  });
  test('만약 `>=` 였다면 정각 500만이 true 여야 하지만, 실제 false → `>` 확정', () => {
    // 이 단언이 깨지면 누군가 경계를 >= 로 되돌린 회귀. 정각=false 가 semantic 정본.
    expect(exceedsPerTxnLimit(LIMIT)).not.toBe(true);
  });
});

test.describe('COVAN-500MAN-STRICTGT — DoD-b/c: shouldWarnOverLimit 경계(P2 자리)', () => {
  test('DoD-b: P2 + 정각 5,000,000원 → 경고 미표시(false)', () => {
    expect(shouldWarnOverLimit(P2_SEAT, LIMIT)).toBe(false);
  });
  test('DoD-c: P2 + 5,000,001원 → 경고 표시(true)', () => {
    expect(shouldWarnOverLimit(P2_SEAT, LIMIT + 1)).toBe(true);
  });
  test('P2 + 한도 근방 하한(4,999,999) → 무경고(false)', () => {
    expect(shouldWarnOverLimit(P2_SEAT, LIMIT - 1)).toBe(false);
  });
  test('P2 + 대형 초과(30,000,000) → 경고(true)', () => {
    expect(shouldWarnOverLimit(P2_SEAT, 30_000_000)).toBe(true);
  });
});
