import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260814-foot-PENCHART-SESCOUNT-VISITDATE-ORDINAL-FIX
 *
 * 배경(김주연 총괄 C0ATE5P6JTH, U0ATDB587PV, 스샷 penchart_screenshot.png):
 *   부모 T-20260811-foot-PENCHART-AUTORECORD-SESCOUNT-CUMULATIVE-FIX(deployed 08-11) 의
 *   field-soak watch 현실화. 펜차트(자동기록용) '금일 치료 횟수' 뒤 숫자의 grain 재정의.
 *
 * ★grain 재정의(reporter 권위, §13.1.A):
 *   - 부모 구현 = 뒤 숫자 = 방문일 오름차순 '누적 실차감 세션 수(session grain)'.
 *       → 같은 날 2세션 차감 시 1(1일차)+2(2일차)=3 → 12-3 (현장 기대 12-2와 발산).
 *   - 재정의(본 티켓) = 뒤 숫자 = '방문일 순번'(unique visit_date 오름차순 index).
 *       같은 날 다회 차감이어도 그 날짜는 +1만. 1번째 방문날=12-1, 2번째=12-2, 3번째=12-3.
 *   - 앞 숫자 = packages.total_sessions 고정, 불변.
 *   - 취소/환불 세션 제외(status==='used' 만 산입) — 부모 spec 계승.
 *   - READ-ONLY 파생(db_change=false).
 *
 * 재현 = 임승원 #F-5819(12회권): 08-07=12-1, 08-14(2세션 차감)=12-2.
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260814-foot-PENCHART-SESCOUNT-VISITDATE-ORDINAL-FIX.spec.ts \
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
// 시나리오 1: 방문일 순번 정상 카운트업 — 임승원 #F-5819 재현 (AC-2)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 방문일 순번 카운트업 (임승원 #F-5819 재현)', () => {
  test('12회권 · 08-07(1세션)/08-14(2세션 차감) → 12-1, 12-2 (앞 12 고정)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        // 08-07 = 1번째 방문일(1세션)
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', staff_name: '임별' }),
        // 08-14 = 2번째 방문일, 그 날 2세션 차감
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
      ],
    );
    // 최신순(DESC): 08-14 → 08-07
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // ★핵심: 08-14 = 2번째 방문일 → '12-2'(그 날 2세션이어도 방문일 순번 +1만, 12-3 아님)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
    // 앞 숫자는 12 고정 (AC-3)
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
    // 직교축 무접촉 — 패키지내용은 총회차 표기 유지 (AC-5)
    for (const r of rows) expect(r.packageContent).toBe('12회');
  });

  test('seedEditableRows 계승 — 동일 방문일 순번 + note 공란', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
    for (const r of rows) expect(r.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2: 엣지 케이스 (AC-1/AC-3/AC-5)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 엣지 케이스', () => {
  test('같은 날 3세션 차감 → 그 날짜는 뒤 숫자 +1만(누적 세션 수 아님)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        // 08-14 에 3세션 차감 → 여전히 2번째 방문일
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '지민' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']); // 12-4 아님
    // 같은 날 치료사 3명 join
    const day2 = rows.find((r) => r.date === '2026-08-14')!;
    expect(day2.therapists).toContain('지민');
    expect(day2.therapists).toContain('혜인');
    expect(day2.therapists).toContain('임별');
  });

  test('10회권 → 앞 숫자 10 고정(10-N 방문일 순번)', () => {
    const rows = buildAutoVisitLogRows(
      [{ id: 'pkg-10', total_sessions: 10 }],
      [
        sess({ package_id: 'pkg-10', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-21' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-28' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['10-3', '10-2', '10-1']);
    for (const r of rows) expect(r.todayCount.startsWith('10-')).toBe(true);
  });

  test('첫 방문(1번째 방문일) → {총회수}-1', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-07', staff_name: '임별' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('12-1');
  });

  test('앞 숫자 불변 — 방문 순번이 늘어도 총회수 고정(12-1..12-5)', () => {
    const dates = Array.from({ length: 5 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      dates.map((d) => sess({ package_id: 'pkg-12', session_date: d })),
    );
    // 오름차순 순번 = 12-1 .. 12-5
    expect(rows.map((r) => r.todayCount).reverse()).toEqual(
      Array.from({ length: 5 }, (_, i) => `12-${i + 1}`),
    );
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
  });

  test('취소/환불(status!=used) 세션은 방문일 순번에서 제외 (부모 spec 계승)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-10', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-08-10', status: 'refunded' }),  // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', status: 'used' }),
      ],
    );
    // 취소/환불 날짜(08-10)는 행 자체가 없음 → 방문일 순번에도 미산입
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // 08-07=1번째, 08-14=2번째(08-10 취소/환불 미반영)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
  });

  test('다중 패키지 — 방문일 순번은 패키지별 독립(서로 오염 없음)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-12', total_sessions: 12 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14' }), // 같은날 2세션
        sess({ package_id: 'pkg-10', session_date: '2026-08-09' }),
        sess({ package_id: 'pkg-10', session_date: '2026-08-16' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    // 12회권: 08-14=2번째 방문일(같은날 2세션이어도 +1만), 08-07=1번째
    expect(by('12회')).toEqual(['12-2', '12-1']);
    // 10회권: 08-16=2번째, 08-09=1번째 — 12회권 방문에 오염되지 않음
    expect(by('10회')).toEqual(['10-2', '10-1']);
  });
});
