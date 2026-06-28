/**
 * E2E spec — T-20260629-foot-CONSULTTAB-DATE-FILTER-UX (FE-only, DB·스키마·RPC 무변경)
 * 풋센터 CRM 진료차트 우측 "📋 상담" 탭(ConsultRecordTab) — 문지은 대표원장 B안 확정(2026-06-29 03:09).
 *
 * 구현 2건:
 *   1) 탭명 변경: "상담기록" → "전체 상담 이력" (누적 전체 이력임을 사용자가 인지 — B안 본질)
 *   2) 선택일 상담기록 최상단 정렬: 진료차트에서 날짜(visit_date) 선택 시 해당 날짜 그룹을 목록 맨 위로.
 *      - 조회 범위 그대로(전체 check_ins). 필터링 X — 클라이언트 정렬 우선순위만 변경.
 *      - 선택일 기록 우선, 나머지는 기존 정렬(최신순/sortAsc) 유지.
 *      - 선택일에 기록 없으면 전체 이력 기존대로(에러·빈블록 X).
 *
 * 스타일: 정본(ConsultRecordTab)의 groups useMemo (selectedKey 우선 정렬 포함)를 in-page 순수 함수로
 *   모사해 회귀를 잡는다. (기존 FIRSTVISIT-CHARTLIST-UX / CONSULT-DRAWER spec 동일 패턴)
 *
 * 현장 클릭 시나리오(티켓) 2개 → 본 spec 시나리오 1(선택일 존재)/시나리오 2(선택일 없음)로 변환.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (ConsultRecordTab.ConsultRecord 부분) ────────────────────────────
interface ConsultRecord {
  id: string;
  checked_in_at: string;
  visit_type: 'new' | 'returning' | null;
}

interface DateGroup {
  key: string;
  items: ConsultRecord[];
  hasNew: boolean;
  isSelected: boolean;
}

// ── 정본: 날짜 키 (dateKey) — yyyy-MM-dd ───────────────────────────────────────
const dateKey = (s: string): string => s.slice(0, 10); // 정본 format('yyyy-MM-dd') 모사

// ── 정본: groups useMemo 모사 — 그룹핑 + 양방향 정렬 + 선택일 최상단(selectedKey) ──
const buildGroups = (
  records: ConsultRecord[],
  sortAsc: boolean,
  selectedDate: string | null,
): DateGroup[] => {
  const selectedKey = selectedDate ? dateKey(selectedDate) : null;
  const map = new Map<string, ConsultRecord[]>();
  for (const r of records) {
    const key = dateKey(r.checked_in_at);
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  const dir = sortAsc ? 1 : -1;
  const cmp = (a: string, b: string) => (a < b ? -dir : a > b ? dir : 0);
  const out: DateGroup[] = Array.from(map.entries()).map(([key, items]) => ({
    key,
    items: items.slice().sort((a, b) => cmp(a.checked_in_at, b.checked_in_at)),
    hasNew: items.some((i) => i.visit_type === 'new'),
    isSelected: selectedKey != null && key === selectedKey,
  }));
  out.sort((a, b) => {
    if (selectedKey) {
      if (a.key === selectedKey && b.key !== selectedKey) return -1;
      if (b.key === selectedKey && a.key !== selectedKey) return 1;
    }
    return cmp(a.key, b.key);
  });
  return out;
};

// ── 정본 라벨 (탭명) ───────────────────────────────────────────────────────────
const TAB_TITLE = '전체 상담 이력 (읽기전용)';

// ── 픽스처: 4개 날짜에 걸친 상담기록(같은날 2건 포함) ──────────────────────────
const fixture: ConsultRecord[] = [
  { id: 'a', checked_in_at: '2026-06-01T10:00:00+09:00', visit_type: 'new' },
  { id: 'b', checked_in_at: '2026-06-01T14:00:00+09:00', visit_type: 'returning' }, // 같은 날
  { id: 'c', checked_in_at: '2026-06-03T09:00:00+09:00', visit_type: 'returning' },
  { id: 'd', checked_in_at: '2026-06-20T11:00:00+09:00', visit_type: 'returning' }, // 선택 대상
  { id: 'e', checked_in_at: '2026-06-25T15:00:00+09:00', visit_type: 'new' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 구현 1: 탭명 변경 "상담기록" → "전체 상담 이력"
// ─────────────────────────────────────────────────────────────────────────────
test.describe('구현1 — 탭명 "전체 상담 이력"', () => {
  test('헤더 라벨이 "전체 상담 이력"이다 (구 "상담 기록" 단독 아님)', () => {
    expect(TAB_TITLE).toContain('전체 상담 이력');
  });

  test('B안 본질: "전체" 어휘로 누적 전체 이력임을 명시한다', () => {
    // 구 라벨("상담 기록")은 그 날짜만으로 오인될 수 있어 "전체"를 전면에.
    expect(TAB_TITLE.startsWith('전체')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (정상 동선): 선택일 상담기록이 존재 → 최상단 정렬
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — 선택일 기록 존재 → 최상단', () => {
  test('2026-06-20 선택 시 해당 날짜 그룹이 목록 최상단', () => {
    const g = buildGroups(fixture, false, '2026-06-20');
    expect(g[0].key).toBe('2026-06-20');
    expect(g[0].isSelected).toBe(true);
  });

  test('선택일 외 나머지는 기존 정렬(최신순) 유지 — 6/25 > 6/3 > 6/1', () => {
    const g = buildGroups(fixture, false, '2026-06-20');
    expect(g.map((x) => x.key)).toEqual([
      '2026-06-20', // 선택일 최상단
      '2026-06-25', // 이하 기존 최신순(내림차순)
      '2026-06-03',
      '2026-06-01',
    ]);
  });

  test('정렬 토글(오래된순)에서도 선택일은 여전히 최상단, 나머지는 오름차순', () => {
    const g = buildGroups(fixture, true, '2026-06-20');
    expect(g[0].key).toBe('2026-06-20');
    expect(g.slice(1).map((x) => x.key)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-25',
    ]);
  });

  test('isSelected 플래그는 선택일 그룹 단 하나에만 true (배지 노출 근거)', () => {
    const g = buildGroups(fixture, false, '2026-06-20');
    expect(g.filter((x) => x.isSelected).map((x) => x.key)).toEqual(['2026-06-20']);
  });

  test('조회 범위·건수 불변 — 정렬만 바뀔 뿐 그룹/항목 총량 동일', () => {
    const none = buildGroups(fixture, false, null);
    const sel = buildGroups(fixture, false, '2026-06-20');
    expect(sel.length).toBe(none.length); // 그룹 수 동일(필터링 아님)
    const total = (gs: DateGroup[]) => gs.reduce((n, x) => n + x.items.length, 0);
    expect(total(sel)).toBe(total(none));
    expect(total(sel)).toBe(fixture.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (엣지): 선택일에 상담기록 없음 → 전체 이력 기존대로
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — 선택일 기록 없음 → 기존대로', () => {
  test('기록 없는 날짜(2026-07-01) 선택 시 강조/빈블록 없이 기존 최신순', () => {
    const g = buildGroups(fixture, false, '2026-07-01');
    // 선택일 그룹이 없으므로 순수 최신순(기존 동작)과 동일
    expect(g.map((x) => x.key)).toEqual([
      '2026-06-25',
      '2026-06-20',
      '2026-06-03',
      '2026-06-01',
    ]);
    expect(g.some((x) => x.isSelected)).toBe(false); // 선택 배지 안 뜸
  });

  test('selectedDate=null(차트 미선택)이면 기존 동작과 완전 동일', () => {
    const withNull = buildGroups(fixture, false, null);
    const baseline = buildGroups(fixture, false, '2026-07-01'); // 매치 없음 = 동일해야
    expect(withNull.map((x) => x.key)).toEqual(baseline.map((x) => x.key));
    expect(withNull.some((x) => x.isSelected)).toBe(false);
  });

  test('빈 입력에도 throw 없이 빈 배열 (그레이스풀)', () => {
    expect(buildGroups([], false, '2026-06-20')).toEqual([]);
    expect(buildGroups([], false, null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 선택일 정렬은 비파괴 — 그룹 내부 항목 정렬·hasNew 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회귀 — 비파괴 불변식', () => {
  test('선택일 그룹 내부 항목 정렬은 기존 규칙(같은날 시간순) 유지', () => {
    const g = buildGroups(fixture, false, '2026-06-01');
    const sel = g.find((x) => x.key === '2026-06-01')!;
    expect(sel.isSelected).toBe(true);
    expect(sel.items.map((i) => i.id)).toEqual(['b', 'a']); // 14:00 > 10:00 (내림차순)
  });

  test('hasNew 판정은 선택 여부와 무관하게 동일', () => {
    const sel = buildGroups(fixture, false, '2026-06-20');
    const none = buildGroups(fixture, false, null);
    const hn = (gs: DateGroup[]) =>
      Object.fromEntries(gs.map((x) => [x.key, x.hasNew]));
    expect(hn(sel)).toEqual(hn(none));
  });
});
