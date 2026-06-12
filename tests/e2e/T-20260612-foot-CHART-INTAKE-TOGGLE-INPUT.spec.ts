/**
 * E2E Spec — T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT
 *
 * 요청(문지은 대표원장): 진료차트 입력부 정리 — 좌우+발가락을 토글/버튼식으로 입력해
 *   'Rt 1지 …'처럼 조합. 확정(2026-06-13): 형식 간소화 = 방향 L/R + 번호 1~5, 'L1'/'R3'
 *   (알파벳1+숫자1, 상태 텍스트 없음), 단일 선택, 치료사 모달(CheckInDetailSheet) 내 입력.
 *   저장: check_ins.treatment_memo jsonb 의 foot_site 서브키 = {side, toe} (신규 컬럼 없음).
 *
 * AC-2(좌우+발가락 토글): {side,toe} → canonical 'L1'/'R3' 파생 (DB엔 shape만, 표시문자열 저장 금지).
 * AC-5(회귀가드): 잘못된 값/불완전 값은 ''로 안전 처리 — 기존 차트 저장 동선 불변.
 *
 * 실행: npx playwright test T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT.spec.ts
 * NOTE: formatFootSite/parseFootSite는 순수 함수 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import { formatFootSite, parseFootSite, isCompleteFootSite, type FootSite } from '../../src/components/FootSiteSelector';

// ── AC-2: {side,toe} → canonical 표시문자열 ──────────────────────────────────
test.describe('AC-2: formatFootSite — 좌우+발가락 단일 조합', () => {
  test('좌측 1지 → L1', () => {
    expect(formatFootSite({ side: 'L', toe: 1 })).toBe('L1');
  });
  test('우측 3지 → R3', () => {
    expect(formatFootSite({ side: 'R', toe: 3 })).toBe('R3');
  });
  test('우측 5지 → R5 (경계값)', () => {
    expect(formatFootSite({ side: 'R', toe: 5 })).toBe('R5');
  });
});

// ── AC-5: 불완전/이상 값 안전 처리 (회귀가드) ───────────────────────────────
test.describe('AC-5: 안전 fallback — 불완전 값은 빈 문자열', () => {
  test('null/undefined → 빈 문자열', () => {
    expect(formatFootSite(null)).toBe('');
    expect(formatFootSite(undefined)).toBe('');
  });
  test('toe 미선택(0) → 빈 문자열', () => {
    expect(formatFootSite({ side: 'L', toe: 0 } as FootSite)).toBe('');
  });
  test('범위 밖 toe(6) → 빈 문자열', () => {
    expect(formatFootSite({ side: 'R', toe: 6 } as FootSite)).toBe('');
  });
  test('잘못된 side → 빈 문자열', () => {
    expect(formatFootSite({ side: 'X', toe: 1 } as unknown as FootSite)).toBe('');
  });
});

// ── FIX(TOGGLE-INPUT): 저장 게이트 — 불완전 값은 DB 미기록 ──────────────────
// supervisor FIX-REQUEST(MSG-20260613-020322): side-only 또는 toe-only 불완전 객체가
//   memoObj.foot_site로 적재되던 결함 차단. 완전 값일 때만 true.
test.describe('isCompleteFootSite — 저장 게이트(완전 값만 기록)', () => {
  test('완전 값(L1/R3) → true', () => {
    expect(isCompleteFootSite({ side: 'L', toe: 1 })).toBe(true);
    expect(isCompleteFootSite({ side: 'R', toe: 3 })).toBe(true);
  });
  test('side만 선택(toe=0) → false (불완전, DB 미기록)', () => {
    expect(isCompleteFootSite({ side: 'L', toe: 0 } as FootSite)).toBe(false);
    expect(isCompleteFootSite({ side: 'R', toe: 0 } as FootSite)).toBe(false);
  });
  test('toe만 있고 side 이상값 → false', () => {
    expect(isCompleteFootSite({ side: '' as unknown as 'L', toe: 2 } as FootSite)).toBe(false);
  });
  test('null/undefined/범위밖 → false', () => {
    expect(isCompleteFootSite(null)).toBe(false);
    expect(isCompleteFootSite(undefined)).toBe(false);
    expect(isCompleteFootSite({ side: 'R', toe: 6 } as FootSite)).toBe(false);
  });
});

// ── parseFootSite: jsonb 로드 안전 파싱 ──────────────────────────────────────
test.describe('parseFootSite — treatment_memo.foot_site 로드', () => {
  test('정상 객체 → FootSite', () => {
    expect(parseFootSite({ side: 'L', toe: 2 })).toEqual({ side: 'L', toe: 2 });
  });
  test('이상 값/타입 → null', () => {
    expect(parseFootSite(null)).toBeNull();
    expect(parseFootSite('L1')).toBeNull(); // 표시문자열이 잘못 저장돼도 안전
    expect(parseFootSite({ side: 'L' })).toBeNull(); // toe 누락
    expect(parseFootSite({ side: 'L', toe: 9 })).toBeNull(); // 범위 밖
  });
  test('round-trip: parse → format 일관', () => {
    const parsed = parseFootSite({ side: 'R', toe: 4 });
    expect(formatFootSite(parsed)).toBe('R4');
  });
});
