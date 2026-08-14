import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260814-foot-PENCHART-SESCOUNT-VISITDAY-ORDINAL-FIX
 *
 * ★부모 T-20260811-foot-PENCHART-AUTORECORD-SESCOUNT-CUMULATIVE-FIX(deployed 08-11) field-soak 정정.
 *   부모는 뒤 숫자에 '누적 실차감 세션 수'(session grain, cumUsed += g.count)를 썼으나,
 *   reporter 의도 = '방문일 순번'(당일 차감건수 무관, 날짜당 +1)임이 field-soak 로 확정됨.
 *
 * 증상(임승원, 남, #F-5819, 12회 패키지, 차감치료사 임별):
 *   08-07 방문(1세션) = 12-1 (정상)
 *   08-14 방문(2세션 차감) = 구 구현 12-3 (1+2 누적) → 현장 기대 12-2 (2번째 방문일)
 *
 * 기대 동작:
 *   금일 치료 횟수 = "{패키지 총회수(고정)}-{방문일 순번}".
 *     앞 = 패키지 총회수(12회권→12, 방문 무관 고정)
 *     뒤 = unique visit_date 오름차순 순번(같은 날 다회 차감이어도 그 날짜는 +1만)
 *   1번째 방문날=12-1, 2번째=12-2, 3번째=12-3.
 *
 * AC:
 *   1. 같은 방문일 2세션+ 차감돼도 뒤 숫자=방문 순번(임승원 08-14→12-2).
 *   2. 하루 1회 차감 케이스 회귀 없음(부모 spec 2-visit 12-2 유지).
 *   3. 앞 숫자=패키지 총회수 고정(10회=10-N, 12회=12-N).
 *   4. 실차감/결제/잔여 회차 원장 데이터 무접촉(표시 파생만, db_change=false).
 *   5. 취소/환불 세션은 방문일 순번 계산 제외(부모 취소환불제외 시나리오 계승).
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언. db_change=false READ-ONLY 파생.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260814-foot-PENCHART-SESCOUNT-VISITDAY-ORDINAL-FIX.spec.ts \
 *     --project=desktop-chrome
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
const PKG_12: AutoVisitLogPackage = { id: 'pkg-12', total_sessions: 12 };
function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1(주 회귀): 하루 다회 차감 — 임승원 #F-5819 재현
//   AC-1: 같은 방문일 2세션+ 차감돼도 뒤 숫자 = 방문일 순번(+1만)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 하루 다회 차감 → 방문일 순번(임승원 #F-5819)', () => {
  test('12회권 · 08-07(1세션)=12-1 · 08-14(2세션 차감)=12-2 (구 산출 12-3 정정)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        // 08-07: 1세션 → 방문일 순번 1
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', staff_name: '임별' }),
        // 08-14: 2세션 차감 → 방문일 순번은 여전히 2 (그날 +1만)
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
      ],
    );
    // 최신순(DESC): 08-14 → 08-07
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // ★핵심 AC-1: 08-14=12-2 (구 session-grain 구현이면 12-3 이었을 값)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
    // 앞 숫자 = 총회수 12 고정
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
    // 직교축 무접촉 — 패키지내용은 총회차 표기 유지
    for (const r of rows) expect(r.packageContent).toBe('12회');
  });

  test('하루 3세션 차감이어도 그 방문일은 +1만 (12-1, 12-2, 12-3)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-01' }),
        // 08-08: 3세션 한 날 차감 → 방문일 순번 2
        sess({ package_id: 'pkg-12', session_date: '2026-08-08' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
      ],
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-08', '2026-08-01']);
    // 방문일 순번: 08-01=1, 08-08=2(3세션이어도 +1), 08-14=3
    expect(rows.map((r) => r.todayCount)).toEqual(['12-3', '12-2', '12-1']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2: AC-2 하루 1회 차감 회귀 없음 (부모 spec 2-visit 12-2 유지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 하루 1회 차감 회귀 없음', () => {
  test('2방문(1세션씩) → 12-1, 12-2 (부모 spec grain 유지)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']); // 최신 08-14=2번째 방문일
  });

  test('4방문(1세션씩) → 12-1..12-4 카운트업', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-12', session_date: '2026-07-21' }),
        sess({ package_id: 'pkg-12', session_date: '2026-07-28' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-04' }),
      ],
    );
    // 오름차순 방문일 순번 1..4 → DESC 표시 4·3·2·1
    expect(rows.map((r) => r.todayCount)).toEqual(['12-4', '12-3', '12-2', '12-1']);
    expect(new Set(rows.map((r) => r.todayCount)).size).toBe(4);
  });

  test('seedEditableRows 계승 — note 공란 + 동일 방문일 순번', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
    for (const r of rows) expect(r.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3: AC-3 앞 숫자 = 패키지 총회수 고정
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 앞 숫자 패키지 총회수 고정', () => {
  test('10회권 → 앞 숫자 10 고정(하루 다회 차감 섞여도)', () => {
    const rows = buildAutoVisitLogRows(
      [{ id: 'pkg-10', total_sessions: 10 }],
      [
        sess({ package_id: 'pkg-10', session_date: '2026-07-14' }),
        // 07-21: 2세션
        sess({ package_id: 'pkg-10', session_date: '2026-07-21' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-21' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-28' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['10-3', '10-2', '10-1']);
    for (const r of rows) expect(r.todayCount.startsWith('10-')).toBe(true);
  });

  test('다중 패키지 — 방문일 순번은 패키지별 독립(오염 없음)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-12', total_sessions: 12 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }), // 하루 2세션
        sess({ package_id: 'pkg-10', session_date: '2026-08-08' }),
        sess({ package_id: 'pkg-10', session_date: '2026-08-15' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    expect(by('12회')).toEqual(['12-2', '12-1']); // 08-14(2세션)=방문일2, 08-07=방문일1
    expect(by('10회')).toEqual(['10-2', '10-1']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4: AC-5 취소/환불 세션은 방문일 순번 계산 제외
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 취소/환불 세션 제외(방문일 순번 무영향)', () => {
  test('취소/환불 날짜는 행/순번 모두 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-10', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-08-10', status: 'refunded' }), // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', status: 'used' }), // 하루 2세션
      ],
    );
    // 취소/환불 날짜(08-10)는 행 자체가 없음
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // 08-07=방문일1, 08-14=방문일2 (취소/환불 08-10 미반영, 하루 2세션도 +1만)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
  });
});
