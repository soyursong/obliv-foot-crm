import { test, expect } from '@playwright/test';
import {
  buildAutoVisitLogRows,
  seedEditableRows,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260811-foot-PENCHART-VISITLOG-TODAYCOUNT-CUMULATIVE-FIX
 *
 * 버그(김주연 총괄 C0ATE5P6JTH, 스샷 file_inbox/20260811/penchart_sescount_20260811.png):
 *   펜차트(자동기록용) '금일 치료 횟수' 열이 전 방문행에 '24-1' 동일 표기.
 * 근본원인:
 *   autoVisitLog.ts buildAutoVisitLogRows 가 첫 숫자에 total(=packages.total_sessions, 항상 전체회차)
 *   을 고정 base 로 사용 → 방문 순서 무관 '{total}-{당일차감}' 반복.
 * 정정:
 *   첫 숫자 = 그날 기준 잔여(= total − 그 날짜 이전까지 누적 차감).
 *   패키지별 날짜 오름차순 누적차감 → 내림차순 정렬 시 각 행에 correct cumulative remaining.
 *   표기 = {그날 기준 잔여}-{당일차감} → 24-1, 23-1, 22-1, 21-1 …
 *   READ-ONLY 파생(db_change=false). 직교축('패키지내용' 보험구분 함축) 무접촉.
 *
 * 검증 = 순수 로직(buildAutoVisitLogRows/seedEditableRows) 단언. 현장 클릭 시나리오의 데이터 산출 축을 고정.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260811-foot-PENCHART-VISITLOG-TODAYCOUNT-CUMULATIVE-FIX.spec.ts \
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
// 정상 시나리오 — 방문일별 1회 차감 → 누적차감 표기(24-1, 23-1, 22-1 …)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('정상: 누적차감 표기 (구버그 24-1 반복 제거)', () => {
  test('24회권 · 매 방문 1회 차감 → 24-1, 23-1, 22-1, 21-1 (최신순)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-08-01', staff_name: '지민' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-04', staff_name: '혜인' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-07', staff_name: '임별' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-10', staff_name: '수아' }),
      ],
    );
    // 최신순(DESC): 08-10 → 08-07 → 08-04 → 08-01
    expect(rows.map((r) => r.date)).toEqual(['2026-08-10', '2026-08-07', '2026-08-04', '2026-08-01']);
    // 첫 숫자 = 그날 시작 시점 잔여(누적차감). 구버그였다면 전 행 '24-1'.
    expect(rows.map((r) => r.todayCount)).toEqual(['21-1', '22-1', '23-1', '24-1']);
    // 전 행 동일('24-1' 반복) 이 아님을 명시적으로 재확인.
    expect(new Set(rows.map((r) => r.todayCount)).size).toBe(4);
    // 직교축 무접촉 — 패키지내용은 총회차 표기 유지.
    for (const r of rows) expect(r.packageContent).toBe('24회');
  });

  test('seedEditableRows 계승 — note 공란 + 동일 누적차감', () => {
    const rows = seedEditableRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-08-01' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-04' }),
      ],
    );
    expect(rows.map((r) => r.todayCount)).toEqual(['23-1', '24-1']); // 최신 08-04=잔여23, 08-01=잔여24
    for (const r of rows) expect(r.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 엣지 — 하루 2회 차감 / 취소·환불 제외 / 단일 방문
// ═══════════════════════════════════════════════════════════════════════════
test.describe('엣지 케이스', () => {
  test('하루 2회 차감 → 당일 표기 {잔여}-2, 다음 방문 잔여는 2 감소', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        // 08-01 에 2회 차감
        sess({ package_id: 'pkg-24', session_date: '2026-08-01', staff_name: '지민' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-01', staff_name: '혜인' }),
        // 08-05 에 1회
        sess({ package_id: 'pkg-24', session_date: '2026-08-05', staff_name: '임별' }),
      ],
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-08-05', '2026-08-01']);
    // 08-01: 시작 잔여 24, 당일 2회 → '24-2'
    // 08-05: 시작 잔여 24−2=22, 당일 1회 → '22-1'
    expect(rows.map((r) => r.todayCount)).toEqual(['22-1', '24-2']);
    // 같은 날 치료사 2명 join
    expect(rows[1].therapists).toContain('지민');
    expect(rows[1].therapists).toContain('혜인');
  });

  test('취소/환불(status!=used) 회차는 잔여계산·표기에서 제외', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-08-01', status: 'used' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-03', status: 'cancelled' }), // 제외
        sess({ package_id: 'pkg-24', session_date: '2026-08-03', status: 'refunded' }),  // 제외
        sess({ package_id: 'pkg-24', session_date: '2026-08-05', status: 'used' }),
      ],
    );
    // 취소/환불 날짜(08-03)는 행 자체가 없음. 잔여도 실차감(used)만 반영.
    expect(rows.map((r) => r.date)).toEqual(['2026-08-05', '2026-08-01']);
    // 08-01 잔여24 → '24-1', 08-05 잔여23(08-03 취소/환불 미반영) → '23-1'
    expect(rows.map((r) => r.todayCount)).toEqual(['23-1', '24-1']);
  });

  test('단일 방문 → {total}-{당일차감} (누적 없음)', () => {
    const rows = buildAutoVisitLogRows(
      [PKG_24],
      [sess({ package_id: 'pkg-24', session_date: '2026-08-01', staff_name: '지민' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('24-1');
  });

  test('다중 패키지 — 잔여는 패키지별 독립 누적(서로 오염 없음)', () => {
    const rows = buildAutoVisitLogRows(
      [
        { id: 'pkg-24', total_sessions: 24 },
        { id: 'pkg-10', total_sessions: 10 },
      ],
      [
        sess({ package_id: 'pkg-24', session_date: '2026-08-01' }),
        sess({ package_id: 'pkg-24', session_date: '2026-08-05' }),
        sess({ package_id: 'pkg-10', session_date: '2026-08-03' }),
        sess({ package_id: 'pkg-10', session_date: '2026-08-06' }),
      ],
    );
    const by = (pc: string) => rows.filter((r) => r.packageContent === pc).map((r) => r.todayCount);
    // 24회권: 최신 08-05 잔여23, 08-01 잔여24
    expect(by('24회')).toEqual(['23-1', '24-1']);
    // 10회권: 최신 08-06 잔여9, 08-03 잔여10 — 24회권 차감에 오염되지 않음
    expect(by('10회')).toEqual(['9-1', '10-1']);
  });
});
