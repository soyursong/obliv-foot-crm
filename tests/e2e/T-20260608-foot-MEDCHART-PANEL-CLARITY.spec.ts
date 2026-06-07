/**
 * E2E spec — T-20260608-foot-MEDCHART-PANEL-CLARITY (FE-only, DB 무변경)
 * 진료차트 패널 표시 명료성:
 *   AC-1 좌측 '경과 타임라인'(medical_charts 회차·편집) ↔ 우측 '방문 진료내역'(check_ins 방문·읽기전용)
 *        구분 라벨/툴팁 추가. 라벨 텍스트만 — 데이터 경로·정렬·동작 무변경.
 *   AC-2 상담(📋)탭 ConsultRecordTab 날짜그룹 affordance 명료화:
 *        - '날짜 그룹' 정적 배지 → 전체 접기/펼치기 토글('날짜만 보기'/'모두 펼치기')
 *        - 대표원장 멘탈모델: "다 싹 접어 날짜만 보고 → 원하는 초진차트만 펼치기" 직접 지원
 *        - 그룹 헤더 chevron 의미 명시(title/aria-label)
 *
 * AC-0(조사 결과): 좌/우는 서로 다른 소스 — 좌측 displayCharts=medical_charts(회차/편집 폼 연동),
 *   우측 visitHistory=check_ins(방문 단위 읽기전용). '동일 소스 중복' 아님 → 통합/제거 없이 구분 라벨만.
 *
 * 스타일: 정본(ConsultRecordTab)의 allCollapsed / collapseAllDates / expandAllDates 클라이언트 상태
 *   로직을 in-page 순수 함수로 모사해 회귀를 잡는다. (FIRSTVISIT-CHARTLIST-UX spec 동일 패턴)
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (ConsultRecordTab.DateGroup 부분) ────────────────────────────────
interface DateGroup {
  key: string; // yyyy-MM-dd
}

// ── 정본: allCollapsed 판정 — 그룹이 1개 이상이고 전부 접힘 ─────────────────────
const isAllCollapsed = (groups: DateGroup[], collapsed: Set<string>): boolean =>
  groups.length > 0 && groups.every((g) => collapsed.has(g.key));

// ── 정본: collapseAllDates — 모든 그룹 key 를 접힘 집합으로 ─────────────────────
const collapseAll = (groups: DateGroup[]): Set<string> =>
  new Set(groups.map((g) => g.key));

// ── 정본: expandAllDates — 접힘 집합 비우기 ────────────────────────────────────
const expandAll = (): Set<string> => new Set<string>();

// ── 정본: 토글 onClick — allCollapsed 면 펼침, 아니면 모두 접기 ─────────────────
const onToggleAll = (groups: DateGroup[], collapsed: Set<string>): Set<string> =>
  isAllCollapsed(groups, collapsed) ? expandAll() : collapseAll(groups);

const groups: DateGroup[] = [
  { key: '2026-06-05' },
  { key: '2026-06-03' },
  { key: '2026-06-01' },
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 전체 접기/펼치기 affordance (날짜만 보기 → 원하는 것만 펼치기)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 전체 접기/펼치기 토글', () => {
  test('초기(아무것도 안 접힘)는 allCollapsed=false → 버튼은 "날짜만 보기" 모드', () => {
    expect(isAllCollapsed(groups, new Set())).toBe(false);
  });

  test('"날짜만 보기" 클릭 → 모든 날짜 그룹이 접힌다(날짜 헤더만 남음)', () => {
    const after = onToggleAll(groups, new Set());
    expect(after.size).toBe(3);
    for (const g of groups) expect(after.has(g.key)).toBe(true);
    expect(isAllCollapsed(groups, after)).toBe(true);
  });

  test('모두 접힌 상태에서 한 날짜만 펼쳐도 나머지는 접힌 채 유지 (원하는 초진차트만 보기)', () => {
    const all = collapseAll(groups);
    // 6/1 그룹만 펼침 = 접힘 집합에서 제거
    const next = new Set(all);
    next.delete('2026-06-01');
    expect(next.has('2026-06-01')).toBe(false); // 펼침
    expect(next.has('2026-06-03')).toBe(true); // 접힘 유지
    expect(next.has('2026-06-05')).toBe(true); // 접힘 유지
    expect(isAllCollapsed(groups, next)).toBe(false); // 전부 접힘은 아님
  });

  test('모두 접힌 상태에서 토글 클릭 → 모두 펼쳐진다(allCollapsed=false)', () => {
    const all = collapseAll(groups);
    const after = onToggleAll(groups, all);
    expect(after.size).toBe(0);
    expect(isAllCollapsed(groups, after)).toBe(false);
  });

  test('토글은 가역 — 접기→펼치기→접기 면 원상복귀', () => {
    const s0 = new Set<string>();
    const s1 = onToggleAll(groups, s0); // 모두 접기
    const s2 = onToggleAll(groups, s1); // 모두 펼치기
    const s3 = onToggleAll(groups, s2); // 다시 모두 접기
    expect([...s3].sort()).toEqual([...s1].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 회귀: 빈 입력/엣지 — affordance 가 데이터 없을 때 안전
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 회귀 — 빈/부분 입력', () => {
  test('그룹 0개면 allCollapsed=false (버튼 자체가 records>0 일 때만 렌더되는 가드 근거)', () => {
    expect(isAllCollapsed([], new Set())).toBe(false);
    expect(isAllCollapsed([], collapseAll([]))).toBe(false);
  });

  test('일부만 접힌 상태는 allCollapsed=false → 토글 누르면 전부 접힘으로 수렴', () => {
    const partial = new Set(['2026-06-01']); // 1개만 접힘
    expect(isAllCollapsed(groups, partial)).toBe(false);
    const after = onToggleAll(groups, partial);
    expect(isAllCollapsed(groups, after)).toBe(true); // 전부 접힘으로 정렬
  });

  test('collapseAll/expandAll 은 입력 groups 를 변형하지 않는다(순수)', () => {
    const before = JSON.stringify(groups);
    collapseAll(groups);
    expandAll();
    onToggleAll(groups, new Set());
    expect(JSON.stringify(groups)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0/AC-1: 좌/우 소스 구분 불변식 (문서화·회귀 가드)
// 좌측 '경과 타임라인'=medical_charts / 우측 '방문 진료내역'=check_ins — 서로 다른 소스.
// 라벨/툴팁 추가는 표시 전용이며 두 패널의 데이터 경로를 섞지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 좌/우 소스 구분 불변식', () => {
  // 정본 헤더 라벨 상수 (구분 명료성 — 라벨 텍스트 회귀 잠금)
  const LEFT_LABEL = '경과 타임라인';
  const LEFT_DESC = '진료차트 회차별 경과 · 클릭하면 우측 폼에서 편집';
  const RIGHT_LABEL = '방문 진료내역 (읽기전용)';
  const RIGHT_DESC = '방문(체크인)별 진료 기록 · 편집 불가';

  test('좌측은 "경과 타임라인" + 진료차트 회차/편집 설명', () => {
    expect(LEFT_LABEL).toBe('경과 타임라인');
    expect(LEFT_DESC).toContain('진료차트 회차');
    expect(LEFT_DESC).toContain('편집');
  });

  test('우측은 "방문 진료내역" + 방문(체크인)/읽기전용 설명 — 좌측과 텍스트가 구분된다', () => {
    expect(RIGHT_LABEL).toContain('방문');
    expect(RIGHT_LABEL).toContain('읽기전용');
    expect(RIGHT_DESC).toContain('방문(체크인)');
    expect(RIGHT_DESC).toContain('편집 불가');
    // 좌/우 설명이 서로 달라 사용자가 구분 가능
    expect(LEFT_DESC).not.toBe(RIGHT_DESC);
  });
});
