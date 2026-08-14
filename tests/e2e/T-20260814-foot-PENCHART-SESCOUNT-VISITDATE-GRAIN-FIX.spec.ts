import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260814-foot-PENCHART-SESCOUNT-VISITDATE-GRAIN-FIX
 *
 * 버그(김주연 총괄 C0ATE5P6JTH, 임승원 #F-5819 12회권, 스샷 penchart_screenshot.png):
 *   펜차트(자동기록용) '금일 치료 횟수' 뒤 숫자가 '누적 실차감 회차 수'(세션-grain)로 세어져서,
 *   같은 날 2회 차감된 방문일이 순번을 2칸 건너뜀.
 *     08-07(1회차감)=12-1 ✓ / 08-14(2회차감)=12-3 ✗ → 현장 기대 12-2(2번째 방문 날짜).
 *
 * ★부모 T-20260811-...-SESCOUNT-CUMULATIVE-FIX field-soak watch 현실화(§13.1.A reporter 권위 재정의):
 *   부모는 뒤 숫자를 session-grain(cumUsed += g.count)로 구현하며
 *   "reporter 의도가 방문일=1회차라면 재정정 필요" watch 를 명시로 남김. 본건이 그 어긋남을 노출.
 *   재정의 = 뒤 숫자 grain = 방문일-grain(unique session_date 순번, cumUsed += 1).
 *     같은 날 몇 번 차감돼도 그 날은 순번 1칸만 증가(방문 날짜 수, 차감 세션 총수 아님).
 *   앞 숫자(packages.total_sessions)·정렬(DESC)·therapists 집계 무접촉. READ-ONLY(db_change=false).
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언. 현장 클릭 시나리오의 데이터 산출 축 고정.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260814-foot-PENCHART-SESCOUNT-VISITDATE-GRAIN-FIX.spec.ts \
 *     --project=desktop-chrome
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
const PKG_12: AutoVisitLogPackage = { id: 'pkg-12', total_sessions: 12 };
const PKG_24: AutoVisitLogPackage = { id: 'pkg-24', total_sessions: 24 };
function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1: 같은 날 2회 차감 방문일 순번 (본건 핵심) — 임승원 #F-5819 재현
//   AC-1(방문일-grain) · AC-2(08-14 2세션 차감 = 12-2, 3 아님)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 같은 날 2회 차감이 순번을 2칸 건너뛰지 않음 (12-3 회귀 방지)', () => {
  test('임승원 #F-5819(12회권) · 08-07(1차감)=12-1, 08-14(2차감)=12-2 (3 아님)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        // 08-07: 1회 차감(1번째 방문 날짜)
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', staff_name: '임별' }),
        // 08-14: 2회 차감(2번째 방문 날짜) — 방문일-grain 이므로 순번은 1칸만 증가
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', staff_name: '지민' }),
      ],
    );
    // 최신순(DESC): 08-14 → 08-07
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // ★핵심: 08-14(2세션 차감) = 12-2(방문 날짜 순번), 12-3 아님. 08-07 = 12-1.
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
    // 회귀 감지: 08-14 행이 절대 '12-3' 이 아니어야 함(버그 재발 감지)
    const aug14 = rows.find((r) => r.date === '2026-08-14');
    expect(aug14?.todayCount).toBe('12-2');
    expect(aug14?.todayCount).not.toBe('12-3');
    // 앞 숫자 12 고정
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
    // 같은 날 2치료사 join(therapists 집계 무접촉)
    expect(aug14?.therapists).toContain('임별');
    expect(aug14?.therapists).toContain('지민');
  });

  test('seedEditableRows 계승 — 방문일-grain 순번 동일 + note 공란', () => {
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
// 시나리오 2: 회귀 방지 — 하루 1회 차감 케이스 불변 (하유희 #F-4696)
//   AC-4: 방문일마다 1회 차감이면 세션-grain==방문일-grain → 결과 동일해야 함
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 하루 1회 차감 4방문 불변 (세션-grain==방문일-grain)', () => {
  test('하유희 #F-4696(24회권) · 07-14/07-21/07-28/08-04 → 24-1·24-2·24-3·24-4 불변', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-07-14', staff_name: '지민' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-21', staff_name: '혜인' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-28', staff_name: '임별' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-04', staff_name: '수아' }),
      ],
    );
    // 최신순(DESC): 08-04 → 07-28 → 07-21 → 07-14
    expect(rows.map((r) => r.date)).toEqual(['2026-08-04', '2026-07-28', '2026-07-21', '2026-07-14']);
    // 방문일-grain 전환이 하루 1회 차감 케이스를 깨지 않음(부모 티켓 결과와 동일)
    expect(rows.map((r) => r.todayCount)).toEqual(['24-4', '24-3', '24-2', '24-1']);
    expect(new Set(rows.map((r) => r.todayCount)).size).toBe(4);
    for (const r of rows) expect(r.packageContent).toBe('24회');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3: 엣지 케이스
//   AC-3(앞 숫자 총회수 고정) · 첫 방문 · 혼합(일부 하루 2회 차감) = 방문 날짜 수 정확 일치
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 엣지 케이스', () => {
  test('10회권 → 앞 숫자 10 고정(10-N) · 패키지별 총회수 고정', () => {
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

  test('첫 방문(1회차, 하루 1회 차감) → {총회수}-1', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-07-14', staff_name: '지민' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('12-1');
  });

  test('혼합(일부 하루 2회·3회 차감) → 뒤 숫자 = 방문 날짜 수 정확 일치(차감 세션 총수 아님)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        // 07-14: 3회 차감(세션 3) → 방문 날짜 1
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        // 07-21: 1회 차감 → 방문 날짜 2
        sess({ package_id: 'pkg-24', session_date: '2026-07-21' }),
        // 07-28: 2회 차감 → 방문 날짜 3
        sess({ package_id: 'pkg-24', session_date: '2026-07-28' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-28' }),
      ],
    );
    // 차감 세션 총수 = 6 이지만 방문 날짜 수 = 3 → 뒤 숫자 최대 3
    expect(rows.map((r) => r.date)).toEqual(['2026-07-28', '2026-07-21', '2026-07-14']);
    expect(rows.map((r) => r.todayCount)).toEqual(['24-3', '24-2', '24-1']);
  });

  test('취소/환불(status!=used) 회차는 방문 날짜 순번에서 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-07-14', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-07-18', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-07-18', status: 'refunded' }),  // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-07-21', status: 'used' }),
      ],
    );
    // 취소/환불 날짜(07-18)는 행 자체 없음, 방문 날짜 순번도 used 만
    expect(rows.map((r) => r.date)).toEqual(['2026-07-21', '2026-07-14']);
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
  });

  test('다중 패키지 — 방문 날짜 순번은 패키지별 독립(오염 없음, 각 하루 2회 차감 포함)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-24', total_sessions: 24 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        // pkg-24: 07-14(2회차감), 07-21(1회) → 방문 날짜 2
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-21' }),
        // pkg-10: 07-16, 07-23 → 방문 날짜 2
        sess({ package_id: 'pkg-10', session_date: '2026-07-16' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-23' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    // 24회권: 07-14 하루 2회 차감이어도 방문 날짜 순번은 1칸 → 07-21=24-2, 07-14=24-1
    expect(by('24회')).toEqual(['24-2', '24-1']);
    // 10회권: 07-23=10-2, 07-16=10-1 — 24회권 방문에 오염되지 않음
    expect(by('10회')).toEqual(['10-2', '10-1']);
  });
});
