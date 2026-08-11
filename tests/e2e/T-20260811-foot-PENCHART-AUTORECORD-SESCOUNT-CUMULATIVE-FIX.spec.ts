import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260811-foot-PENCHART-AUTORECORD-SESCOUNT-CUMULATIVE-FIX
 *
 * 버그(김주연 총괄 C0ATE5P6JTH, 하유희 #F-4696, 스샷 penchart_sescount_20260811.png):
 *   펜차트(자동기록용) '금일 치료 횟수' 열이 전 방문행(08-04/07-28/07-21/07-14)에 '24-1' 동일 표기.
 *
 * ★reporter 스펙 정정(MSG-20260811-114508-lci1, §13.1.A reporter 권위 재정의):
 *   '금일 치료 횟수' = "{패키지 총회수(고정)}-{방문 회차 순번}".
 *     앞 = 결제 횟수권 총수(24회권→24, 10회권→10, 방문과 무관 고정)
 *     뒤 = 이번 방문이 몇 번째 회차인지(방문일 오름차순 running index, 1·2·3·4 카운트업)
 *   정답 = 24-1 → 24-2 → 24-3 → 24-4. ★구 planner 해석 '잔여 감소(23·22·21)'는 폐기.
 *   근본원인 = 뒤 숫자에 '당일 차감건수'(하루 1회면 항상 1)를 써서 회차가 늘지 않음.
 *   READ-ONLY 파생(db_change=false). 직교축('패키지내용' 보험구분 함축) 무접촉.
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언. 현장 클릭 시나리오의 데이터 산출 축 고정.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260811-foot-PENCHART-AUTORECORD-SESCOUNT-CUMULATIVE-FIX.spec.ts \
 *     --project=desktop-chrome
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
const PKG_24: AutoVisitLogPackage = { id: 'pkg-24', total_sessions: 24 };
function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1: 방문 회차 순번 정상 표시 (앞 고정·뒤 카운트업) — 하유희 #F-4696 재현
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 방문 회차 순번 카운트업 (구버그 24-1 반복 제거)', () => {
  test('24회권 · 4방문(07-14/07-21/07-28/08-04) → 24-1,24-2,24-3,24-4 (앞 24 고정)', () => {
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
    // 앞=총회수 24 고정, 뒤=방문 회차 순번(방문일 오름차순 1·2·3·4 → DESC 표시 시 4·3·2·1)
    expect(rows.map((r) => r.todayCount)).toEqual(['24-4', '24-3', '24-2', '24-1']);
    // 전 행 '24-1' 동일 표기가 아님(회귀 방지)
    expect(new Set(rows.map((r) => r.todayCount)).size).toBe(4);
    // 앞 숫자는 24 고정
    for (const r of rows) expect(r.todayCount.startsWith('24-')).toBe(true);
    // 직교축 무접촉 — 패키지내용은 총회차 표기 유지
    for (const r of rows) expect(r.packageContent).toBe('24회');
  });

  test('seedEditableRows 계승 — note 공란 + 동일 회차 순번', () => {
    const rows = seedEditableRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-21' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['24-2', '24-1']); // 최신 07-21=2회차, 07-14=1회차
    for (const r of rows) expect(r.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2: 엣지 — 첫 방문 / 10회권(패키지별 총회수 고정) / 다회차 카운트업
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 엣지 케이스', () => {
  test('첫 방문(1회차) → {총회수}-1', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [sess({ package_id: 'pkg-24', session_date: '2026-07-14', staff_name: '지민' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('24-1');
  });

  test('10회권 고객 → 앞 숫자 10 고정(10-N)', () => {
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

  test('방문 많은 고객 → 뒤 숫자 24-10 까지 정상 증가', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      dates.map((d) => sess({ package_id: 'pkg-24', session_date: d })),
    );
    // 최신순: 07-10 이 10회차
    expect(rows[0].date).toBe('2026-07-10');
    expect(rows[0].todayCount).toBe('24-10');
    // 오름차순 회차 = 1..10
    expect(rows.map((r) => r.todayCount).reverse()).toEqual(
      Array.from({ length: 10 }, (_, i) => `24-${i + 1}`),
    );
  });

  test('하루 2회 차감 → package_sessions running index(그 날까지 누적 회차) 채택', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        // 07-14 에 2회 차감(2회차까지)
        sess({ package_id: 'pkg-24', session_date: '2026-07-14', staff_name: '지민' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-14', staff_name: '혜인' }),
        // 07-21 에 1회(3회차)
        sess({ package_id: 'pkg-24', session_date: '2026-07-21', staff_name: '임별' }),
      ],
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-07-21', '2026-07-14']);
    // 07-14: 당일까지 누적 2회 → '24-2', 07-21: 누적 3회 → '24-3'
    expect(rows.map((r) => r.todayCount)).toEqual(['24-3', '24-2']);
    // 같은 날 치료사 2명 join
    expect(rows[1].therapists).toContain('지민');
    expect(rows[1].therapists).toContain('혜인');
  });

  test('취소/환불(status!=used) 회차는 회차 순번에서 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-07-14', status: 'used' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-18', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-24', session_date: '2026-07-18', status: 'refunded' }),  // 제외
        sess({ package_id: 'pkg-24', session_date: '2026-07-21', status: 'used' }),
      ],
    );
    // 취소/환불 날짜(07-18)는 행 자체가 없음. 회차도 used 만 카운트.
    expect(rows.map((r) => r.date)).toEqual(['2026-07-21', '2026-07-14']);
    // 07-14=1회차, 07-21=2회차(07-18 취소/환불 미반영)
    expect(rows.map((r) => r.todayCount)).toEqual(['24-2', '24-1']);
  });

  test('다중 패키지 — 회차 순번은 패키지별 독립(서로 오염 없음)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-24', total_sessions: 24 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-07-14' }),
        sess({ package_id: 'pkg-24', session_date: '2026-07-21' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-16' }),
        sess({ package_id: 'pkg-10', session_date: '2026-07-23' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    // 24회권: 최신 07-21=2회차, 07-14=1회차
    expect(by('24회')).toEqual(['24-2', '24-1']);
    // 10회권: 최신 07-23=2회차, 07-16=1회차 — 24회권 방문에 오염되지 않음
    expect(by('10회')).toEqual(['10-2', '10-1']);
  });
});
