/**
 * T-20260730-foot-ASSIGN-FULLSPEC-IMPL (§094v 나. + Q1/Q2/Q3) — TM 턴 배정(G2) + 전일휴무 판정(G4) 순수-로직 가드
 *
 * spec-of-record: MSG-20260729-170611-094v (김주연 총괄 7/29 17:00 확정) + Q1/Q2/Q3 (총괄 7/30 09:00/09:15 confirm).
 *   G2 = TM 배정: 전일휴무 실장부터 기본순번 턴 + 동일 30분 슬롯 비TM 예약 랭킹투영 skip.
 *   G4 = 전일 휴무 판정: 어제 출근상태≠출근=휴무(주말·연차·오프 포함), 월요일 예외(일요일 스킵→토요일).
 *
 * 본 spec = auth/browser 불요 순수 unit(결정론). 배정 엔진은 시각·DB 의존이라 pure 함수 단위로 커버.
 *
 * 검증 축:
 *  · AC-G4a  previousBusinessDayISO: 화~토 = 하루전 / 월요일 = 토요일(일요일 고정휴무 스킵, Q3 월요일 예외).
 *  · AC-G4b  previousBusinessDayISO: 요일기반 이전 영업일 일반화(임의 고정휴무일 집합 확장 대비).
 *  · AC-G2a  buildTmTurnOrder: 전일휴무자부터 → 나머지, 각 구간 기본순번(baseOrder) 유지(Q3 복수 휴무자 순서).
 *  · AC-G2b  tmRankingSkipSet: 슬롯 비TM 예약 N → 랭킹 상위 N명 skip(Q1 랭킹투영, '보유실장' 아님).
 *  · AC-G2c  pickTmFromTurn: 커서 walk + skip 건너뜀 + nextCursor 전진 + 전원skip 엣지(배정 유지).
 *  · AC-G2d  toHalfHourSlot: 30분 슬롯 floor(Q2) — 10:00/10:30/11:00 블록 경계.
 *  · AC-G2e  통합: 전일휴무+skip 결합 시 첫 배정 대상(휴무자 우선, 랭킹상위 skip)이 스펙대로 결정.
 */
import { test, expect } from '@playwright/test';
import {
  previousBusinessDayISO,
  FIXED_HOLIDAY_DOWS,
  buildTmTurnOrder,
  tmRankingSkipSet,
  pickTmFromTurn,
  toHalfHourSlot,
} from '../../src/lib/assignmentStrategy';

test.describe('T-20260730 G4 — 전일(이전 영업일) 휴무 판정', () => {
  // ── AC-G4a: 요일별 이전 영업일 ─────────────────────────────────────────────────
  test('AC-G4a — 화~토는 하루 전, 월요일은 토요일(일요일 고정휴무 스킵)', () => {
    // 2026-07-30 = 목요일 → 전일 = 수요일 07-29.
    expect(previousBusinessDayISO('2026-07-30')).toBe('2026-07-29');
    // 2026-07-28 = 화요일 → 월요일 07-27.
    expect(previousBusinessDayISO('2026-07-28')).toBe('2026-07-27');
    // 2026-08-01 = 토요일 → 금요일 07-31.
    expect(previousBusinessDayISO('2026-08-01')).toBe('2026-07-31');
    // ★ 월요일 예외: 2026-08-03 = 월요일 → 일요일(08-02, 고정휴무) 스킵 → 토요일 08-01.
    expect(previousBusinessDayISO('2026-08-03')).toBe('2026-08-01');
    // ★ 월요일 2026-07-27 → 토요일 07-25(일요일 07-26 스킵).
    expect(previousBusinessDayISO('2026-07-27')).toBe('2026-07-25');
  });

  // ── AC-G4b: 고정휴무 요일 집합 일반화 ──────────────────────────────────────────
  test('AC-G4b — 고정휴무 집합은 일요일(0), 임의 집합 확장 시 해당 요일 스킵', () => {
    expect(FIXED_HOLIDAY_DOWS.has(0)).toBe(true); // 일요일 고정휴무
    expect(FIXED_HOLIDAY_DOWS.has(6)).toBe(false); // 토요일은 영업일
    // 일·월 둘 다 고정휴무라고 가정하면 화요일(07-28)의 전일 = 토요일(07-25): 월(27)·일(26) 스킵.
    expect(previousBusinessDayISO('2026-07-28', new Set([0, 1]))).toBe('2026-07-25');
    // 고정휴무 없음(빈 집합) → 항상 하루 전(월요일도 일요일).
    expect(previousBusinessDayISO('2026-08-03', new Set())).toBe('2026-08-02');
  });
});

test.describe('T-20260730 G2 — TM 턴 순서 + 랭킹투영 skip', () => {
  // ── AC-G2a: 전일휴무자부터 기본순번 턴 ─────────────────────────────────────────
  test('AC-G2a — buildTmTurnOrder: 휴무자(기본순번순) ++ 나머지(기본순번순)', () => {
    const baseOrder = ['A', 'B', 'C', 'D']; // 기본순번 asc
    // B, D 가 전일 휴무 → [B, D] ++ [A, C].
    expect(buildTmTurnOrder(baseOrder, new Set(['B', 'D']))).toEqual(['B', 'D', 'A', 'C']);
    // 아무도 휴무 아님 → baseOrder 그대로.
    expect(buildTmTurnOrder(baseOrder, new Set())).toEqual(['A', 'B', 'C', 'D']);
    // 전원 휴무 → baseOrder 그대로(전원 off-first).
    expect(buildTmTurnOrder(baseOrder, new Set(['A', 'B', 'C', 'D']))).toEqual(['A', 'B', 'C', 'D']);
    // 휴무자 순서도 기본순번(입력 baseOrder) 유지 — 집합 삽입순 아님.
    expect(buildTmTurnOrder(['A', 'B', 'C'], new Set(['C', 'A']))).toEqual(['A', 'C', 'B']);
  });

  // ── AC-G2b: 랭킹 상위 N skip(Q1 랭킹투영) ──────────────────────────────────────
  test('AC-G2b — tmRankingSkipSet: 비TM 예약 N → 랭킹 상위 N명 skip', () => {
    const ranked = ['R1', 'R2', 'R3', 'R4']; // 랭킹 1→4위
    expect([...tmRankingSkipSet(ranked, 0)]).toEqual([]); // N=0 → skip 없음
    expect([...tmRankingSkipSet(ranked, 1)]).toEqual(['R1']); // 상위 1명
    expect([...tmRankingSkipSet(ranked, 2)]).toEqual(['R1', 'R2']); // 상위 2명
    // N ≥ 후보수 → 전원(초과분은 무시).
    expect(tmRankingSkipSet(ranked, 9).size).toBe(4);
    // 음수 방어.
    expect(tmRankingSkipSet(ranked, -3).size).toBe(0);
  });

  // ── AC-G2c: 커서 walk + skip ───────────────────────────────────────────────────
  test('AC-G2c — pickTmFromTurn: skip 건너뛰고 다음 순번, nextCursor 전진', () => {
    const turn = ['B', 'D', 'A', 'C'];
    // cursor=0, skip 없음 → B, next=1.
    expect(pickTmFromTurn(turn, new Set(), 0)).toEqual({ chosen: 'B', nextCursor: 1 });
    // cursor=0, B skip → D, next=2.
    expect(pickTmFromTurn(turn, new Set(['B']), 0)).toEqual({ chosen: 'D', nextCursor: 2 });
    // cursor=1, D·A skip → C, next=4.
    expect(pickTmFromTurn(turn, new Set(['D', 'A']), 1)).toEqual({ chosen: 'C', nextCursor: 4 });
    // 커서 순환(cursor=3=C) → C, next=4.
    expect(pickTmFromTurn(turn, new Set(), 3)).toEqual({ chosen: 'C', nextCursor: 4 });
    // 커서가 길이 초과 → 모듈러 순환.
    expect(pickTmFromTurn(turn, new Set(), 4)).toEqual({ chosen: 'B', nextCursor: 1 });
    // 전원 skip(엣지) → 배정 막지 않고 cursor 위치 선택.
    expect(pickTmFromTurn(turn, new Set(['B', 'D', 'A', 'C']), 2)).toEqual({
      chosen: 'A',
      nextCursor: 3,
    });
    // 빈 턴 → null.
    expect(pickTmFromTurn([], new Set(), 0)).toEqual({ chosen: null, nextCursor: 0 });
  });

  // ── AC-G2d: 30분 슬롯 floor(Q2) ────────────────────────────────────────────────
  test('AC-G2d — toHalfHourSlot: 30분 블록 floor 경계', () => {
    expect(toHalfHourSlot('10:00')).toBe('10:00');
    expect(toHalfHourSlot('10:15')).toBe('10:00');
    expect(toHalfHourSlot('10:29')).toBe('10:00');
    expect(toHalfHourSlot('10:30')).toBe('10:30');
    expect(toHalfHourSlot('10:45')).toBe('10:30');
    expect(toHalfHourSlot('11:00')).toBe('11:00');
    expect(toHalfHourSlot('09:05:30')).toBe('09:00'); // 초 포함도 floor
    expect(toHalfHourSlot('9:30')).toBe('09:30'); // 1자리 시각 → zero-pad
    expect(toHalfHourSlot(null)).toBeNull();
    expect(toHalfHourSlot('bad')).toBeNull();
  });

  // ── AC-G2e: 통합 — 전일휴무 우선 + 랭킹상위 skip 결합 ──────────────────────────
  test('AC-G2e — 통합: 전일휴무자 시작 + 슬롯 비TM 랭킹투영 skip 결합 결정', () => {
    // 후보 기본순번 [A,B,C,D]. 전일휴무 = {C}. 랭킹 1→4 = [A,B,C,D]. 슬롯 비TM 예약 2건 → 상위2(A,B) skip.
    const baseOrder = ['A', 'B', 'C', 'D'];
    const ranked = ['A', 'B', 'C', 'D'];
    const turn = buildTmTurnOrder(baseOrder, new Set(['C'])); // [C, A, B, D]
    expect(turn).toEqual(['C', 'A', 'B', 'D']);
    const skip = tmRankingSkipSet(ranked, 2); // {A, B}
    // cursor=0 → 턴 첫 C 는 skip 아님(C 는 랭킹 3위, skip=상위2) → C 배정.
    const r1 = pickTmFromTurn(turn, skip, 0);
    expect(r1).toEqual({ chosen: 'C', nextCursor: 1 });
    // 다음 배정(cursor=1): A(skip)·B(skip) 건너뛰고 D.
    const r2 = pickTmFromTurn(turn, skip, r1.nextCursor);
    expect(r2).toEqual({ chosen: 'D', nextCursor: 4 });
  });
});
