/**
 * E2E spec — T-20260629-foot-KOHLIST-INACTIVE-PURGE-DAYMONTH-FILTER
 * 균검사지(KOH) 진료대시보드 명단 — ①비활성(미신청) 건 기본 제외 + '비활성 포함' 토글(기본 OFF)
 *                               ②일별/월별 보기 토글(첫 진입 = 일별, 선택 일자 = 오늘).
 *
 * 검증 대상(현장 클릭 시나리오 변환 — 티켓 §5):
 *   S1 비활성 제외(AC-1/AC-4) — filterKohActive: koh_requested=false 기본 제외, includeInactive=true면 전부.
 *      ⚠ 표시 필터만 — 원배열 무변형(DB DELETE 없음, 데이터 보존).
 *   S2 일자 이동(AC-3) — shiftISODate: ±N일, 월·연·윤년 경계 안전(UTC 정오 기준).
 *   S3 일자 표기 — formatDateKo: 'YYYY-MM-DD' → 'YYYY년 M월 D일'.
 *   S4 일별 일자 매칭(AC-3) — isKohOnSelectedDay: 검사일(UTC)의 KST 캘린더 일자 === selectedDate.
 *   S5 쿼리 월 파생 — 일별=선택 일자의 월, 월별=ym(월 단위 1쿼리 후 일자 필터는 클라).
 *   S6 정본 회귀 가드(source) — 기본값(일별/비활성제외), DELETE 부재, koh_requested 필터, 토글 testid 존재.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(KohReportTab 헬퍼)을 모사해 회귀를 잡는다.
 *   DB·RPC 무변경(표시/조회 조건만, 신규 스키마 0). 물리 삭제 아님.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── 정본 모사: 헬퍼 (KohReportTab.tsx) ────────────────────────────────────────
type KohViewMode = 'day' | 'month';

const filterKohActive = <T extends { koh_requested: boolean }>(rows: T[], includeInactive: boolean): T[] =>
  includeInactive ? rows : rows.filter((r) => r.koh_requested);

const shiftISODate = (iso: string, deltaDays: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
};

const formatDateKo = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
};

// seoulISODate 모사(@/lib/format) — UTC timestamptz → Asia/Seoul 'YYYY-MM-DD'.
const seoulISODate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

const isKohOnSelectedDay = (createdAt: string | null | undefined, selectedDate: string): boolean =>
  !createdAt ? false : seoulISODate(createdAt) === selectedDate;

// 쿼리 월 파생 정본 모사
const queryYm = (viewMode: KohViewMode, selectedDate: string, ym: string): string =>
  viewMode === 'day' ? selectedDate.slice(0, 7) : ym;

// ── S1: 비활성 제외(AC-1/AC-4) ────────────────────────────────────────────────
test.describe('S1 비활성 제외 + 포함 토글(AC-1/AC-4)', () => {
  const rows = [
    { id: 'a', koh_requested: true },
    { id: 'b', koh_requested: false },
    { id: 'c', koh_requested: true },
    { id: 'd', koh_requested: false },
  ];

  test('기본(OFF) — 비활성(koh_requested=false) 제외, 활성만 노출', () => {
    const out = filterKohActive(rows, false);
    expect(out.map((r) => r.id)).toEqual(['a', 'c']);
    expect(out.every((r) => r.koh_requested)).toBe(true);
  });

  test('비활성 포함(ON) — 전체 노출(활성+비활성)', () => {
    const out = filterKohActive(rows, true);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('데이터 보존 — 원배열 무변형(DELETE 아님, 토글로 재조회 가능)', () => {
    const snapshot = JSON.parse(JSON.stringify(rows));
    filterKohActive(rows, false);
    filterKohActive(rows, true);
    expect(rows).toEqual(snapshot); // 원본 4건 그대로 — 물리 삭제 없음
  });
});

// ── S2: 일자 이동(AC-3) ───────────────────────────────────────────────────────
test.describe('S2 일자 이동 — shiftISODate(AC-3)', () => {
  test('±1일 기본', () => {
    expect(shiftISODate('2026-06-15', 1)).toBe('2026-06-16');
    expect(shiftISODate('2026-06-15', -1)).toBe('2026-06-14');
  });

  test('월 경계 — 말일/초일 넘김', () => {
    expect(shiftISODate('2026-06-30', 1)).toBe('2026-07-01');
    expect(shiftISODate('2026-07-01', -1)).toBe('2026-06-30');
  });

  test('연 경계', () => {
    expect(shiftISODate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftISODate('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('윤년 2월 — 2028-02-28 +1 = 2028-02-29', () => {
    expect(shiftISODate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftISODate('2028-02-29', 1)).toBe('2028-03-01');
  });

  test('평년 2월 — 2026-02-28 +1 = 2026-03-01', () => {
    expect(shiftISODate('2026-02-28', 1)).toBe('2026-03-01');
  });
});

// ── S3: 일자 표기 ─────────────────────────────────────────────────────────────
test.describe('S3 일자 표기 — formatDateKo', () => {
  test("'YYYY-MM-DD' → 'YYYY년 M월 D일'(0패딩 제거)", () => {
    expect(formatDateKo('2026-06-01')).toBe('2026년 6월 1일');
    expect(formatDateKo('2026-12-25')).toBe('2026년 12월 25일');
  });
});

// ── S4: 일별 일자 매칭(AC-3) ──────────────────────────────────────────────────
test.describe('S4 일별 일자 매칭 — isKohOnSelectedDay(AC-3)', () => {
  test('같은 KST 일자 — 매칭', () => {
    // 2026-06-15 03:00 KST = 2026-06-14T18:00:00Z
    expect(isKohOnSelectedDay('2026-06-14T18:00:00Z', '2026-06-15')).toBe(true);
  });

  test('다른 일자 — 미매칭', () => {
    expect(isKohOnSelectedDay('2026-06-14T18:00:00Z', '2026-06-14')).toBe(false);
  });

  test('KST 자정 직후(UTC 전날 15:00) — KST 일자로 귀속', () => {
    // 2026-06-30T15:30:00Z = 2026-07-01 00:30 KST → 2026-07-01
    expect(isKohOnSelectedDay('2026-06-30T15:30:00Z', '2026-07-01')).toBe(true);
    expect(isKohOnSelectedDay('2026-06-30T15:30:00Z', '2026-06-30')).toBe(false);
  });

  test('결측 created_at = 미매칭', () => {
    expect(isKohOnSelectedDay(null, '2026-06-15')).toBe(false);
    expect(isKohOnSelectedDay(undefined, '2026-06-15')).toBe(false);
  });
});

// ── S5: 쿼리 월 파생 ──────────────────────────────────────────────────────────
test.describe('S5 쿼리 월 파생 — queryYm', () => {
  test('일별 — 선택 일자의 월(YYYY-MM)', () => {
    expect(queryYm('day', '2026-06-15', '2026-04')).toBe('2026-06');
    expect(queryYm('day', '2026-12-31', '2026-04')).toBe('2026-12');
  });

  test('월별 — ym 그대로', () => {
    expect(queryYm('month', '2026-06-15', '2026-04')).toBe('2026-04');
  });
});

// ── S6: 정본 회귀 가드(source) ────────────────────────────────────────────────
test.describe('S6 정본 회귀 가드(KohReportTab.tsx)', () => {
  const SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/doctor/KohReportTab.tsx'),
    'utf-8',
  );

  test('기본값 — 보기 토글 첫 진입 = 일별', () => {
    expect(SRC).toMatch(/useState<KohViewMode>\('day'\)/);
  });

  test('기본값 — 비활성 포함 = OFF(false)', () => {
    expect(SRC).toMatch(/const \[includeInactive, setIncludeInactive\] = useState\(false\)/);
  });

  test('AC-1 — koh_requested 기준 활성 필터 존재', () => {
    expect(SRC).toContain('filterKohActive');
    expect(SRC).toMatch(/rows\.filter\(\(r\) => r\.koh_requested\)/);
  });

  test('AC-4 — KOH 명단 경로에 물리 삭제(DELETE) 없음(데이터 보존)', () => {
    // supabase delete 는 무인자 `.delete()` — JS Set.delete(id)(선택 토글)와 구분.
    expect(SRC).not.toMatch(/\.delete\(\s*\)/);
    expect(SRC).not.toMatch(/DELETE\s+FROM/i);
  });

  test('AC-2/AC-3 — 토글·네비 testid 존재', () => {
    for (const tid of [
      'koh-view-toggle', 'koh-view-day', 'koh-view-month',
      'koh-day-nav', 'koh-prev-day', 'koh-next-day', 'koh-day-label',
      'koh-include-inactive',
    ]) {
      expect(SRC).toContain(`data-testid="${tid}"`);
    }
  });

  test('월별 네비(기존 UI)와 공존 — koh-month-nav 보존(AC-5)', () => {
    expect(SRC).toContain('data-testid="koh-month-nav"');
    expect(SRC).toContain('data-testid="koh-month-label"');
  });
});
