/**
 * T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE — 도래 회차 간격 설정값 승격 (pure-logic E2E)
 *
 * base canon(T-20260812, commit 4f50d3e4)의 '6배수' 하드코딩을 런타임 조정 가능한 설정값으로 승격.
 *   - 기본값 = 6 → 설정 미변경 시 동작은 기존과 byte-identical(AC-2 하위호환·회귀0).
 *   - '6' 상수만 interval 파라미터로 승격(반전 아님·additive 강화).
 *
 * 검증 대상 = 필터/검증의 결정론적 핵심(설정 UI·localStorage·supabase 조립은 통합 수동 QA):
 *   AC-1 설정값 승격: isSixMultipleTarget 이 interval 파라미터를 단일 소스로 참조(하드코딩 6 제거).
 *   AC-2 하위호환: interval 미지정 = 6 → base canon 판정과 동일(byte-identical).
 *   AC-4 회차 연동: interval 변경 시 도래 판정(anticipatedSession % interval)이 함께 바뀐다.
 *   AC-5 값 검증: isValidCheckpointInterval — 0·음수·비정수 방어. 비정상 interval → 기본값(6) 폴백.
 */
import { test, expect } from '@playwright/test';
import {
  anticipatedSession,
  isSixMultipleTarget,
  isValidCheckpointInterval,
  DEFAULT_CHECKPOINT_INTERVAL,
} from '../../src/lib/progressSixMultiple';

test.describe('DUE-CYCLE-CONFIGURABLE · 기본값 하위호환 (AC-2)', () => {
  test('DEFAULT_CHECKPOINT_INTERVAL = 6 (base canon 6배수 루틴)', () => {
    expect(DEFAULT_CHECKPOINT_INTERVAL).toBe(6);
  });

  test('interval 미지정 = base canon(% 6) 판정과 byte-identical', () => {
    for (const used of [0, 3, 4, 5, 6, 11, 17, 23]) {
      const legacy = anticipatedSession(used) % 6 === 0 && 30 > 0;
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 })).toBe(legacy);
    }
  });

  test('interval=6 명시 = 미지정과 동일', () => {
    for (const used of [5, 6, 11, 12]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 }, 6)).toBe(
        isSixMultipleTarget({ usedSessions: used, totalSessions: 30 }),
      );
    }
  });
});

test.describe('DUE-CYCLE-CONFIGURABLE · 설정값 승격 + 회차 연동 (AC-1/AC-4)', () => {
  test('interval=5 → 완료 4·9·14회(다음 5·10·15) 도래, 6배수는 비대상', () => {
    for (const used of [4, 9, 14]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 }, 5)).toBe(true);
    }
    // interval=5 에서는 6배수(used=5 → 다음 6)가 더 이상 도래 대상이 아니다.
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 30 }, 5)).toBe(false);
  });

  test('interval=3 → 완료 2·5·8회(다음 3·6·9) 도래', () => {
    for (const used of [2, 5, 8]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 }, 3)).toBe(true);
    }
    expect(isSixMultipleTarget({ usedSessions: 3, totalSessions: 30 }, 3)).toBe(false); // 다음 4 → 3배수 아님
  });

  test('interval=1 → 모든 회차 도래(간격 1)', () => {
    for (const used of [0, 1, 2, 3]) {
      expect(isSixMultipleTarget({ usedSessions: used, totalSessions: 30 }, 1)).toBe(true);
    }
  });

  test('tier 0(체험/Re:Born)은 interval 무관 배제(가드 유지)', () => {
    expect(isSixMultipleTarget({ usedSessions: 4, totalSessions: 0 }, 5)).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 4, totalSessions: null }, 5)).toBe(false);
  });
});

test.describe('DUE-CYCLE-CONFIGURABLE · 값 검증 (AC-5)', () => {
  test('isValidCheckpointInterval: 양의 정수만 true', () => {
    for (const n of [1, 2, 5, 6, 12, 100]) expect(isValidCheckpointInterval(n)).toBe(true);
  });

  test('isValidCheckpointInterval: 0·음수·비정수·NaN·비숫자 false', () => {
    for (const n of [0, -1, -6, 1.5, 6.1, NaN, Infinity]) {
      expect(isValidCheckpointInterval(n as number)).toBe(false);
    }
    // 비숫자 타입 방어
    expect(isValidCheckpointInterval('6' as unknown as number)).toBe(false);
    expect(isValidCheckpointInterval(null as unknown as number)).toBe(false);
    expect(isValidCheckpointInterval(undefined as unknown as number)).toBe(false);
  });

  test('비정상 interval → 기본값(6) 폴백(안전)', () => {
    // 비정상 값이 넘어와도 base canon(6배수) 동작으로 폴백 → 데이터 오염 방지.
    for (const bad of [0, -1, 1.5, NaN]) {
      expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 30 }, bad)).toBe(true); // 다음 6 → 6배수
      expect(isSixMultipleTarget({ usedSessions: 3, totalSessions: 30 }, bad)).toBe(false); // 다음 4 → 6배수 아님
    }
  });
});
