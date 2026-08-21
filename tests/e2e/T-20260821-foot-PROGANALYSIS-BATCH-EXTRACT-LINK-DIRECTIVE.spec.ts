/**
 * Unit spec — T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2)
 *
 * 진료대시보드>경과분석 탭 배치 화면. 이 spec 은 이번 세션에 구현된 §1(D-1 필터 토글, DB 무관)만 커버.
 *   §4(결과 일괄업로드·차트연결) / §5(상태머신) / §6(노쇼 자동폐기 안전)은 신규 스키마 → data-architect
 *   CONSULT 선행 + supervisor DB-GATE GO-token 후 별도 leg 로 구현·spec 추가. (본 spec 미포함 = 아직 미구현.)
 *
 * 대상(순수 함수) — auth/page/server 미사용 → playwright.config 'unit' 프로젝트:
 *   src/lib/progressSixMultiple.ts : filterD1Targets
 *
 * AC 매핑(현장 시나리오 — Phase-2):
 *   시나리오1(§1 D-1 필터 토글):
 *     · 기본(토글 OFF) = 예약무관 6배수 도래자 전체(canon) — 필터 미적용 모집단 보존.
 *     · 토글 ON = 다음 예약이 '내일(D-1)'인 대상자만. 미예약(null)·다른 날짜는 제외. 기본뷰 canon 불변(additive).
 *
 * 실기기 클릭/토글 UI/토스트 = supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import { filterD1Targets } from '../../src/lib/progressSixMultiple';

interface Row {
  rowKey: string;
  nextReservationDate: string | null;
}

const TOMORROW = '2026-08-23'; // 서울 기준 '내일'로 가정한 고정값(순수 함수라 시스템 시계 무관).

function cohort(): Row[] {
  return [
    { rowKey: 'a', nextReservationDate: '2026-08-23' }, // 내일 → D-1 대상
    { rowKey: 'b', nextReservationDate: '2026-08-24' }, // 모레 → 제외
    { rowKey: 'c', nextReservationDate: '2026-08-22' }, // 오늘 → 제외
    { rowKey: 'd', nextReservationDate: null },          // 미예약 → 제외
    { rowKey: 'e', nextReservationDate: '2026-08-23' }, // 내일 → D-1 대상
  ];
}

test.describe('T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §1 D-1 필터', () => {
  test('시나리오1: 토글 ON = 내일(D-1) 예약 도래자만 남고, 다른 날짜·미예약은 제외', () => {
    const rows = cohort();
    const filtered = filterD1Targets(rows, TOMORROW);
    expect(filtered.map((r) => r.rowKey)).toEqual(['a', 'e']);
    // 미예약(null)·오늘·모레는 결과에 없음.
    expect(filtered.some((r) => r.nextReservationDate !== TOMORROW)).toBe(false);
  });

  test('시나리오1: 원본 배열 불변(비파괴) — canon 모집단 보존', () => {
    const rows = cohort();
    const before = rows.length;
    filterD1Targets(rows, TOMORROW);
    expect(rows.length).toBe(before); // 필터는 새 배열만 반환, 기본뷰(canon) 모집단 미변형.
  });

  test('시나리오1: 내일 예약자가 0명이면 빈 목록(엣지) — 기본뷰로 되돌리면 전체 복원', () => {
    const rows: Row[] = [
      { rowKey: 'x', nextReservationDate: '2026-08-24' },
      { rowKey: 'y', nextReservationDate: null },
    ];
    expect(filterD1Targets(rows, TOMORROW)).toEqual([]);
    // 토글 OFF(=미적용) 상태의 모집단은 원본 그대로(컴포넌트에서 d1Only=false → rows 사용).
    expect(rows.length).toBe(2);
  });
});
