/**
 * T-20260730-foot-ASSIGN-FULLSPEC-IMPL — 자동배정 확정 스펙(spec-of-record §094v) 구현 검증.
 *
 * ── 이 스펙의 범위 = G1(랭킹 주매출 윈도우 금주→전주)만 ──────────────────────────
 *  본 티켓의 4대 갭 중 G1 은 독립·저위험이라 선착수·검증(착수 권고 W2). G2(TM 턴배정)·
 *  G3(6경로 분리)·G4(전일휴무 판정)는 게이트 대기(G3=data-architect CONSULT DB게이트,
 *  G2/G4=총괄 재확인 no-guessing) → 게이트 해소 후 별 커밋·spec 확장 예정. 여기선 G1 만 검증한다.
 *
 * ── G1 검증 대상 = 순수 함수 seoulWindowBounds(assignmentStrategy.ts) ────────────
 *  랭킹 엔진 computeRanking 이 쓰는 revenueWeek 윈도우가 '이번주(금주)'가 아니라
 *  '전주(직전주 월~일)'인지, 그리고 전주가 전월로 넘어가는 월초 경계에서 payments 쿼리
 *  하한(fetchStart)이 전월까지 확장되는지 결정론적으로 확인(DB 불요·tz-safe).
 *  디스플레이 랭킹 탭 '전주매출' 컬럼(Assignments.rankingRanges)은 이미 전주 정의였고
 *  본 수정은 배정 엔진의 주매출 윈도우를 그 정의에 정합시킨다.
 */
import { test, expect } from '@playwright/test';
import { seoulWindowBounds } from '../../src/lib/assignmentStrategy';

test.describe('T-20260730 G1 — 랭킹 주매출 윈도우 = 전주(직전주 월~일)', () => {
  // 월 중간(전주가 당월 안): 2026-07-15(수). 이번주 월=07-13, 전주 월=07-06.
  test('G1-1 월 중간 — 주매출 윈도우가 전주(07-06~07-13)로 잡히고 금주가 아님', () => {
    const b = seoulWindowBounds('2026-07-15');
    // 전주 하한 = 직전주 월요일(07-06). ⚠ 금주 월요일(07-13)이 아님(divergence #1 해소 핵심).
    expect(b.weekStart).toBe('2026-07-06T00:00:00+09:00');
    // 전주 상한(미포함) = 이번주 월요일(07-13) = 직전주 일요일 24:00.
    expect(b.weekEnd).toBe('2026-07-13T00:00:00+09:00');
    // 회귀 가드: 옛 코드는 weekStart=금주(07-13)였음 → 이제 절대 07-13 이면 안 됨.
    expect(b.weekStart).not.toBe('2026-07-13T00:00:00+09:00');
    // 당월 하한 불변.
    expect(b.monthStart).toBe('2026-07-01T00:00:00+09:00');
    // 전주(07-06)가 당월(07-01) 이후 → 쿼리 하한은 monthStart 로 충분(확장 불필요).
    expect(b.fetchStart).toBe('2026-07-01T00:00:00+09:00');
  });

  // 월초(전주가 전월로 넘어감): 2026-07-02(목). 이번주 월=06-29, 전주 월=06-22.
  test('G1-2 월초 경계 — 전주가 전월(06-22~06-29)이면 쿼리 하한이 전월로 확장', () => {
    const b = seoulWindowBounds('2026-07-02');
    expect(b.weekStart).toBe('2026-06-22T00:00:00+09:00'); // 전주 월(전월)
    expect(b.weekEnd).toBe('2026-06-29T00:00:00+09:00'); // 이번주 월(=전주 일 24:00)
    expect(b.monthStart).toBe('2026-07-01T00:00:00+09:00');
    // fetchStart = min(monthStart, weekStart) = weekStart(전월) → 전주 데이터(전월분) 누락 방지.
    expect(b.fetchStart).toBe('2026-06-22T00:00:00+09:00');
    expect(b.fetchStart < b.monthStart).toBe(true);
  });

  // 월말: 2026-07-30(목). 이번주 월=07-27, 전주 월=07-20.
  test('G1-3 월말 — 전주 윈도우(07-20~07-27) 정합', () => {
    const b = seoulWindowBounds('2026-07-30');
    expect(b.weekStart).toBe('2026-07-20T00:00:00+09:00');
    expect(b.weekEnd).toBe('2026-07-27T00:00:00+09:00');
    // 전주 구간은 정확히 7일.
    const days =
      (Date.parse(b.weekEnd) - Date.parse(b.weekStart)) / (24 * 3600 * 1000);
    expect(days).toBe(7);
  });

  // 불변식: weekStart 는 항상 weekEnd 정확히 7일 전(전주 = 직전 7일 블록), weekEnd ≤ 당일.
  test('G1-4 불변식 — weekStart = weekEnd − 7d, 전주 상한 ≤ 당일', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-03-09', '2026-12-31', '2027-03-01']) {
      const b = seoulWindowBounds(iso);
      const days = (Date.parse(b.weekEnd) - Date.parse(b.weekStart)) / (24 * 3600 * 1000);
      expect(days).toBe(7);
      // 전주 상한(이번주 월요일 00:00 KST) 은 당일(그날 00:00 KST) 이하 — 미래 주가 아님.
      expect(b.weekEnd <= `${iso}T00:00:00+09:00`).toBe(true);
      // fetchStart 는 monthStart 와 weekStart 중 이른 쪽.
      const earlier = b.weekStart < b.monthStart ? b.weekStart : b.monthStart;
      expect(b.fetchStart).toBe(earlier);
    }
  });
});
