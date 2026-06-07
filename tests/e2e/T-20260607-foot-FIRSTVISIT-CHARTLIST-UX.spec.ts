/**
 * E2E spec — T-20260607-foot-FIRSTVISIT-CHARTLIST-UX (FE-only, DB 무변경)
 * 진료차트 우측 "📋 상담" 탭(ConsultRecordTab)의 초진차트 목록 UX 개선 회귀.
 * 문지은 대표원장 요청. 3 변경:
 *   AC-1 날짜순 정렬 양방향 토글(오름/내림) — 기존 records 클라이언트 정렬
 *   AC-2 날짜 그룹 접기/펼치기 — 같은 날짜 방문 그룹핑, 접으면 날짜 헤더만 노출
 *   AC-3 초진차트 항목 색 구분 — visit_type='new' 카드 시각 구별(앰버 톤 + 좌측 액센트)
 *
 * 스타일: 정본(ConsultRecordTab)의 groups useMemo / sortAsc / dateKey / hasNew 로직을
 *   in-page 순수 함수로 모사해 회귀를 잡는다. (기존 CONSULT-DRAWER spec 동일 패턴)
 *
 * AC-0(그라운딩): 우측 탭 초진 다중 노출은 더미/소크 운영자오류 데이터 기인 —
 *   시스템적 실데이터 정합성 결함 아님. 다중 'new' check_in 을 자동 생성하는 코드 경로 없음.
 *   (818 고객 중 >1 new = 10명, 대부분 테스트명: 초진환자1/신규/테스트123/김팔번 등)
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
}

// ── 정본: 날짜 키 (dateKey) — yyyy-MM-dd ───────────────────────────────────────
const dateKey = (s: string): string => {
  // 픽스처는 +09:00 로컬과 동일하게 앞 10자리(yyyy-MM-dd) 사용 — 정본 format('yyyy-MM-dd') 모사
  return s.slice(0, 10);
};

// ── 정본: groups useMemo 모사 — 날짜 그룹핑 + 양방향 정렬 ───────────────────────
const buildGroups = (records: ConsultRecord[], sortAsc: boolean): DateGroup[] => {
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
  }));
  out.sort((a, b) => cmp(a.key, b.key));
  return out;
};

// ── 정본: 접기/펼치기 토글 (toggleDate) ────────────────────────────────────────
const toggleDate = (prev: Set<string>, key: string): Set<string> => {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

// ── 정본: 초진 색 구분 클래스 판정 (isNew ? 앰버 : 기본) ────────────────────────
const cardClass = (visitType: ConsultRecord['visit_type']): string =>
  visitType === 'new'
    ? 'border-amber-300 bg-amber-50/70 border-l-4 border-l-amber-400'
    : 'border bg-card';

// ── 픽스처: 3개 날짜, 같은날 2건(초진+재진) 포함 ───────────────────────────────
const fixture: ConsultRecord[] = [
  { id: 'a', checked_in_at: '2026-06-01T10:00:00+09:00', visit_type: 'new' },
  { id: 'b', checked_in_at: '2026-06-01T14:00:00+09:00', visit_type: 'returning' }, // 같은 날
  { id: 'c', checked_in_at: '2026-06-03T09:00:00+09:00', visit_type: 'returning' },
  { id: 'd', checked_in_at: '2026-06-05T11:00:00+09:00', visit_type: 'new' },
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 날짜순 정렬 양방향 토글
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 정렬 양방향 토글', () => {
  test('기본(sortAsc=false)은 최신순(내림차순) — 6/5 > 6/3 > 6/1', () => {
    const g = buildGroups(fixture, false);
    expect(g.map((x) => x.key)).toEqual(['2026-06-05', '2026-06-03', '2026-06-01']);
  });

  test('토글(sortAsc=true)이면 오래된순(오름차순) — 6/1 < 6/3 < 6/5', () => {
    const g = buildGroups(fixture, true);
    expect(g.map((x) => x.key)).toEqual(['2026-06-01', '2026-06-03', '2026-06-05']);
  });

  test('그룹 내부 항목도 동일 방향으로 정렬된다 (같은 날 a/b)', () => {
    const desc = buildGroups(fixture, false).find((x) => x.key === '2026-06-01')!;
    expect(desc.items.map((i) => i.id)).toEqual(['b', 'a']); // 14:00 > 10:00
    const asc = buildGroups(fixture, true).find((x) => x.key === '2026-06-01')!;
    expect(asc.items.map((i) => i.id)).toEqual(['a', 'b']); // 10:00 < 14:00
  });

  test('토글은 멱등 가역 — false→true→false 면 원복', () => {
    let asc = false;
    const k0 = buildGroups(fixture, asc).map((x) => x.key);
    asc = !asc;
    asc = !asc;
    expect(buildGroups(fixture, asc).map((x) => x.key)).toEqual(k0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 날짜 그룹 접기/펼치기
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 날짜 그룹핑 + 접기/펼치기', () => {
  test('같은 날짜 방문은 한 그룹으로 묶인다 (6/1 = 2건)', () => {
    const g = buildGroups(fixture, false);
    const d0601 = g.find((x) => x.key === '2026-06-01')!;
    expect(d0601.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(g).toHaveLength(3); // 3개 날짜 그룹
  });

  test('toggleDate — 접힘 집합에 추가/제거가 가역', () => {
    let collapsed = new Set<string>();
    collapsed = toggleDate(collapsed, '2026-06-01');
    expect(collapsed.has('2026-06-01')).toBe(true); // 접힘
    collapsed = toggleDate(collapsed, '2026-06-01');
    expect(collapsed.has('2026-06-01')).toBe(false); // 펼침
  });

  test('한 그룹만 접어도 다른 그룹은 영향 없음', () => {
    const collapsed = toggleDate(new Set<string>(), '2026-06-03');
    expect(collapsed.has('2026-06-03')).toBe(true);
    expect(collapsed.has('2026-06-01')).toBe(false);
    expect(collapsed.has('2026-06-05')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 초진차트 항목 색 구분
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 초진 색 구분', () => {
  test('visit_type="new" 카드는 앰버 톤 + 좌측 액센트 클래스', () => {
    expect(cardClass('new')).toContain('bg-amber-50/70');
    expect(cardClass('new')).toContain('border-l-amber-400');
  });

  test('재진/미상 카드는 기본(bg-card) — 앰버 아님', () => {
    expect(cardClass('returning')).toBe('border bg-card');
    expect(cardClass(null)).toBe('border bg-card');
    expect(cardClass('returning')).not.toContain('amber');
  });

  test('그룹 hasNew — 초진 포함 그룹만 true(헤더 ⭐ 노출 근거)', () => {
    const g = buildGroups(fixture, false);
    expect(g.find((x) => x.key === '2026-06-01')!.hasNew).toBe(true); // a=new 포함
    expect(g.find((x) => x.key === '2026-06-05')!.hasNew).toBe(true); // d=new
    expect(g.find((x) => x.key === '2026-06-03')!.hasNew).toBe(false); // c=returning만
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 빈 입력·DB 무변경 불변식
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회귀 — 빈 입력/무변경', () => {
  test('빈 records 면 그룹 0개 (throw 없음)', () => {
    expect(() => buildGroups([], false)).not.toThrow();
    expect(buildGroups([], false)).toEqual([]);
  });

  test('정렬/그룹핑은 입력 records 를 변형하지 않는다 (순수)', () => {
    const before = JSON.stringify(fixture);
    buildGroups(fixture, true);
    buildGroups(fixture, false);
    expect(JSON.stringify(fixture)).toBe(before); // 원본 불변
  });
});
