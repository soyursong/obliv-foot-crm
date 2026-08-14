import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260814-foot-PENCHART-SESCOUNT-SAMEDAY-PERSESSION-ROW-FIX
 *
 * 확정 스펙(reporter 김주연 총괄 U0ATDB587PV, origin C0ATE5P6JTH):
 *   펜차트(자동기록용) '금일 치료 횟수' — 같은 날 다회 차감 시 각 차감을 개별 행으로 표기.
 *     · 차감 1건 = 화면 1행 (같은 날 2회 차감 → 2개 행).
 *     · 뒤 숫자 = 실차감 세션(status==='used') 오름차순 running index(세션 grain, 같은 날도 개별 +1).
 *     · 앞 숫자 = packages.total_sessions 고정, 불변.
 *     · 재현: 임승원 #F-5819(12회권) 08-07=12-1(1행) · 08-14 2회 차감=12-2(행1)·12-3(행2) 2개 행.
 *
 * ★표시 정렬: 일자 최신순(DESC). 같은 날 내부는 running index 오름차순(12-2 위, 12-3 아래) —
 *   티켓 예시 "12-2(행1)·12-3(행2)" 그대로.
 *
 * ★RETRACT 된 방향(재사용 금지) — 직전 3티켓 전부 status:cancelled:
 *   - T-20260814 VISITDATE-GRAIN / VISITDAY-ORDINAL / VISITDATE-ORDINAL-FIX = 방문일 순번으로
 *     같은 날 다회 차감을 1행 collapse(예: 08-14 2회 차감 → 12-2 단일 행). → 정반대 방향, 폐기.
 *   - 부모 T-20260811 SESCOUNT-CUMULATIVE-FIX = 방문일 running-index(1행 collapse).
 *   본 티켓 = '실차감 세션 개별 행 + 세션 running index'로 착지.
 *
 * db_change=false, READ-ONLY 파생(packages/package_sessions write-back 0).
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260814-foot-PENCHART-SESCOUNT-SAMEDAY-PERSESSION-ROW-FIX.spec.ts \
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
// 시나리오 1: 같은 날 다회 차감 = 개별 행 전개 — 임승원 #F-5819 재현 (핵심 AC)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 같은 날 다회 차감 개별 행 (임승원 #F-5819 재현)', () => {
  test('12회권 · 08-07(1회)/08-14(2회 차감) → 12-1 · 12-2(행1) · 12-3(행2) 3개 행', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        // 08-07 = 1번째 차감 → 12-1 (1행)
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 's1', staff_name: '임별' }),
        // 08-14 = 같은 날 2회 차감 → 개별 2행(12-2, 12-3)
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 's2', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 's3', staff_name: '지민' }),
      ],
    );
    // ★핵심: 차감 3건 = 3행 (같은 날 collapse 금지)
    expect(rows).toHaveLength(3);
    // 최신순 DESC: 08-14 2행, 08-07 1행. 같은 날 08-14 내부는 running index 오름차순
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-14', '2026-08-07']);
    // ★뒤 숫자 = 실차감 세션 running index: 08-14=12-2(행1)·12-3(행2), 08-07=12-1
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-3', '12-1']);
    // 앞 숫자 = 12 고정
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
    // 직교축 무접촉 — 패키지내용 총회차 표기 유지
    for (const r of rows) expect(r.packageContent).toBe('12회');
  });

  test('seedEditableRows 계승 — 개별 행 + note 공란', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 's1' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 's2' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 's3' }),
      ],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-3', '12-1']);
    for (const r of rows) expect(r.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2: 엣지 케이스
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 엣지 케이스', () => {
  test('같은 날 3회 차감 → 개별 3행(뒤 숫자 세션 running index)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 's1' }),
        // 08-14 에 3회 차감 → 개별 3행(12-2·12-3·12-4)
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 's2', staff_name: '지민' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 's3', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 4, id: 's4', staff_name: '임별' }),
      ],
    );
    expect(rows).toHaveLength(4);
    // 08-14 3행(오름차순 12-2·12-3·12-4) → 08-07(12-1)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-3', '12-4', '12-1']);
    // 같은 날 3행이 각각 개별 치료사(행별 단일 표기, join 아님)
    const day14 = rows.filter((r) => r.date === '2026-08-14');
    expect(day14.map((r) => r.therapists)).toEqual(['지민', '혜인', '임별']);
  });

  test('앞 숫자 불변 — 같은 날 여러 차감이어도 총회수 고정', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 1, id: 'a' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 'b' }),
      ],
    );
    for (const r of rows) expect(r.todayCount.startsWith('12-')).toBe(true);
    // 같은 날 2행 = 오름차순 12-1·12-2
    expect(rows.map((r) => r.todayCount)).toEqual(['12-1', '12-2']);
  });

  test('첫 차감(1건) → {총회수}-1 단일 행', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 's1', staff_name: '임별' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('12-1');
    expect(rows[0].therapists).toBe('임별');
  });

  test('취소/환불(status!=used) 세션은 개별 행·running index 모두 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 's1', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-10', session_number: 2, id: 's2', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 's3', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 4, id: 's4', status: 'refunded' }),  // 제외
      ],
    );
    // used 만 2건 = 2행. 취소/환불 행 없음.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-07']);
    // 08-07=1번째 used, 08-14=2번째 used (취소/환불 index 미산입)
    expect(rows.map((r) => r.todayCount)).toEqual(['12-2', '12-1']);
  });

  test('같은 날 정렬 결정성 — session_number 오름차순 tiebreak(입력순 무관)', () => {
    // 입력 순서를 뒤섞어도 running index 는 session_number 오름차순으로 결정적
    const rows = buildAutoVisitLogRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 'c', staff_name: 'C' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 1, id: 'a', staff_name: 'A' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 'b', staff_name: 'B' }),
      ],
    );
    // running index = session_number 오름차순(A=12-1, B=12-2, C=12-3), 같은 날 표시도 오름차순
    expect(rows.map((r) => r.todayCount)).toEqual(['12-1', '12-2', '12-3']);
    expect(rows.map((r) => r.therapists)).toEqual(['A', 'B', 'C']);
  });

  test('다중 패키지 — running index 패키지별 독립(같은 날 다회 차감 포함)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-12', total_sessions: 12 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-07', session_number: 1, id: 'x1' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 2, id: 'x2' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-14', session_number: 3, id: 'x3' }), // 같은 날 2회
        sess({ package_id: 'pkg-10', session_date: '2026-08-09', session_number: 1, id: 'y1' }),
        sess({ package_id: 'pkg-10', session_date: '2026-08-16', session_number: 2, id: 'y2' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    // 12회권: 08-14 2회 차감 개별 전개(12-2·12-3), 08-07(12-1)
    expect(by('12회')).toEqual(['12-2', '12-3', '12-1']);
    // 10회권: 각 1회씩(10-2·10-1) — 12회권에 오염되지 않음
    expect(by('10회')).toEqual(['10-2', '10-1']);
  });
});
