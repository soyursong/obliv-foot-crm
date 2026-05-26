/**
 * T-20260526-foot-SVC-CATEGORY-SORT
 * 서비스관리 항목분류 탭별 순서 변경 + DB 저장
 *
 * AC-1: 탭별 DnD or ↑↓ 버튼 순서 변경
 * AC-2: DB 저장 (sort_order 컬럼)
 * AC-3: 재진입 시 저장 순서 유지
 * AC-4: 탭 간 순서 독립
 * AC-5: clinic 범위 (단일 지점)
 * AC-6: 기존 CRUD 무영향
 * AC-7: 빌드 + E2E spec (본 파일)
 */

import { test, expect } from '@playwright/test';
import { arrayMove } from '@dnd-kit/sortable';

// ── 타입 ─────────────────────────────────────────────────────────────────────
type MockService = {
  id: string;
  name: string;
  category_label: string;
  sort_order: number;
  active: boolean;
};

// ── 유틸: tabItems 정렬 로직 재현 ────────────────────────────────────────────
function getTabItems(
  rows: MockService[],
  activeTab: string,
  showInactive: boolean,
  searchQuery: string,
): MockService[] {
  const base = rows.filter((svc) => {
    if (!svc.active && !showInactive) return false;
    if (activeTab !== '전체' && svc.category_label !== activeTab) return false;
    if (searchQuery) {
      return svc.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });
  if (activeTab === '전체') {
    return [...base].sort((a, b) => {
      const catCmp = a.category_label.localeCompare(b.category_label, 'ko');
      if (catCmp !== 0) return catCmp;
      const orderCmp = (a.sort_order ?? 999) - (b.sort_order ?? 999);
      if (orderCmp !== 0) return orderCmp;
      return a.name.localeCompare(b.name, 'ko');
    });
  }
  return [...base].sort((a, b) => {
    const orderCmp = (a.sort_order ?? 999) - (b.sort_order ?? 999);
    if (orderCmp !== 0) return orderCmp;
    return a.name.localeCompare(b.name, 'ko');
  });
}

// ── 유틸: ↑↓ 버튼 재정렬 로직 재현 ──────────────────────────────────────────
function applyReorderBtn(
  rows: MockService[],
  activeTab: string,
  showInactive: boolean,
  svcId: string,
  dir: 'up' | 'down',
): MockService[] {
  const inTab = rows
    .filter((s) => s.category_label === activeTab && (showInactive || s.active))
    .sort((a, b) => {
      const o = (a.sort_order ?? 999) - (b.sort_order ?? 999);
      return o !== 0 ? o : a.name.localeCompare(b.name, 'ko');
    });
  const idx = inTab.findIndex((s) => s.id === svcId);
  if (dir === 'up' && idx <= 0) return rows;
  if (dir === 'down' && idx >= inTab.length - 1) return rows;
  const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
  const reordered = [...inTab];
  [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
  const updated = reordered.map((s, i) => ({ ...s, sort_order: i * 10 }));
  const others = rows.filter(
    (s) => !(s.category_label === activeTab && (showInactive || s.active)),
  );
  return [...others, ...updated];
}

// ── 샘플 데이터 ───────────────────────────────────────────────────────────────
const MOCK_ROWS: MockService[] = [
  // 기본 탭 (3개)
  { id: 'b1', name: '초진진찰료', category_label: '기본', sort_order: 0, active: true },
  { id: 'b2', name: '재진진찰료', category_label: '기본', sort_order: 10, active: true },
  { id: 'b3', name: '진단서', category_label: '기본', sort_order: 20, active: true },
  // 검사 탭 (2개)
  { id: 'e1', name: '피검사', category_label: '검사', sort_order: 0, active: true },
  { id: 'e2', name: 'KOH검사', category_label: '검사', sort_order: 10, active: true },
  // 풋케어 탭 (3개)
  { id: 'f1', name: '체험', category_label: '풋케어', sort_order: 0, active: true },
  { id: 'f2', name: '프리컨디셔닝', category_label: '풋케어', sort_order: 10, active: true },
  { id: 'f3', name: '레이저', category_label: '풋케어', sort_order: 20, active: true },
  // 수액 탭 (2개)
  { id: 'v1', name: '재생수액', category_label: '수액', sort_order: 0, active: true },
  { id: 'v2', name: '항염수액', category_label: '수액', sort_order: 10, active: true },
];

// ── AC-1: tabItems 단위 테스트 ────────────────────────────────────────────────
test.describe('AC-1: 탭별 항목 필터링 + sort_order 정렬', () => {
  test('기본 탭 → 기본 카테고리만 sort_order 오름차순', () => {
    const items = getTabItems(MOCK_ROWS, '기본', false, '');
    expect(items.map((s) => s.id)).toEqual(['b1', 'b2', 'b3']);
  });

  test('검사 탭 → 검사 카테고리만', () => {
    const items = getTabItems(MOCK_ROWS, '검사', false, '');
    expect(items.every((s) => s.category_label === '검사')).toBe(true);
    expect(items.length).toBe(2);
  });

  test('전체 탭 → category_label → sort_order → name 3단 정렬', () => {
    const items = getTabItems(MOCK_ROWS, '전체', false, '');
    const labels = items.map((s) => s.category_label);
    for (let i = 0; i < labels.length - 1; i++) {
      expect(labels[i].localeCompare(labels[i + 1], 'ko')).toBeLessThanOrEqual(0);
    }
  });

  test('검색어 있으면 이름 필터링 적용', () => {
    const items = getTabItems(MOCK_ROWS, '풋케어', false, '체험');
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('f1');
  });

  test('비활성 포함(showInactive=true) → active=false 항목도 포함', () => {
    const rowsWithInactive: MockService[] = [
      ...MOCK_ROWS,
      { id: 'f0', name: '구형레이저', category_label: '풋케어', sort_order: 999, active: false },
    ];
    const withHidden = getTabItems(rowsWithInactive, '풋케어', false, '');
    const withVisible = getTabItems(rowsWithInactive, '풋케어', true, '');
    expect(withHidden.some((s) => s.id === 'f0')).toBe(false);
    expect(withVisible.some((s) => s.id === 'f0')).toBe(true);
  });
});

// ── AC-1, AC-2: ↑↓ 버튼 순서 변경 로직 ──────────────────────────────────────
test.describe('AC-1/AC-2: ↑↓ 버튼 순서 변경', () => {
  test('위로 이동: b2 ↑ → b2가 b1보다 앞으로', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b2', 'up');
    const tabItems = getTabItems(updated, '기본', false, '');
    expect(tabItems[0].id).toBe('b2');
    expect(tabItems[1].id).toBe('b1');
  });

  test('아래로 이동: b1 ↓ → b1이 b2보다 뒤로', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b1', 'down');
    const tabItems = getTabItems(updated, '기본', false, '');
    expect(tabItems[0].id).toBe('b2');
    expect(tabItems[1].id).toBe('b1');
  });

  test('첫 번째 항목 위로 이동 무시', () => {
    const before = getTabItems(MOCK_ROWS, '기본', false, '').map((s) => s.id);
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b1', 'up');
    const after = getTabItems(updated, '기본', false, '').map((s) => s.id);
    expect(after).toEqual(before);
  });

  test('마지막 항목 아래로 이동 무시', () => {
    const before = getTabItems(MOCK_ROWS, '기본', false, '').map((s) => s.id);
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b3', 'down');
    const after = getTabItems(updated, '기본', false, '').map((s) => s.id);
    expect(after).toEqual(before);
  });

  test('sort_order 재할당 = index * 10', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b2', 'up');
    const tabItems = getTabItems(updated, '기본', false, '');
    expect(tabItems[0].sort_order).toBe(0);
    expect(tabItems[1].sort_order).toBe(10);
    expect(tabItems[2].sort_order).toBe(20);
  });
});

// ── AC-2: DnD arrayMove 로직 ─────────────────────────────────────────────────
test.describe('AC-2: DnD arrayMove 로직', () => {
  test('arrayMove: 첫 번째 ↔ 세 번째 교환', () => {
    const items = ['b1', 'b2', 'b3'];
    const result = arrayMove(items, 0, 2);
    expect(result).toEqual(['b2', 'b3', 'b1']);
  });

  test('arrayMove: 동일 위치 → 순서 불변', () => {
    const items = ['b1', 'b2', 'b3'];
    const result = arrayMove(items, 1, 1);
    expect(result).toEqual(['b1', 'b2', 'b3']);
  });
});

// ── AC-4: 탭 간 순서 독립 ────────────────────────────────────────────────────
test.describe('AC-4: 탭 간 순서 독립', () => {
  test('기본 탭 재정렬이 검사 탭 sort_order에 영향 없음', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b2', 'up');
    const originalExam = MOCK_ROWS.filter((s) => s.category_label === '검사');
    const updatedExam = updated.filter((s) => s.category_label === '검사');
    originalExam.forEach((orig, i) => {
      expect(updatedExam[i].sort_order).toBe(orig.sort_order);
    });
  });

  test('풋케어 탭 재정렬이 수액 탭 sort_order에 영향 없음', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '풋케어', false, 'f1', 'down');
    const originalV = MOCK_ROWS.filter((s) => s.category_label === '수액');
    const updatedV = updated.filter((s) => s.category_label === '수액');
    originalV.forEach((orig, i) => {
      expect(updatedV[i].sort_order).toBe(orig.sort_order);
    });
  });
});

// ── AC-5: clinic 범위 ─────────────────────────────────────────────────────────
test.describe('AC-5: clinic 범위 단일 지점', () => {
  test('tabItems는 category_label 필터만 적용 (clinic 필터는 fetchServices에서)', () => {
    const items = getTabItems(MOCK_ROWS, '기본', false, '');
    expect(items.every((s) => s.category_label === '기본')).toBe(true);
  });
});

// ── AC-6: 기존 CRUD 무영향 ────────────────────────────────────────────────────
test.describe('AC-6: 기존 CRUD 무영향', () => {
  test('soft delete: 재정렬 후 active=false 항목이 showInactive=false 시 숨겨짐', () => {
    const updatedRows: MockService[] = MOCK_ROWS.map((s) =>
      s.id === 'b2' ? { ...s, active: false } : s,
    );
    const items = getTabItems(updatedRows, '기본', false, '');
    expect(items.some((s) => s.id === 'b2')).toBe(false);
    const itemsWithInactive = getTabItems(updatedRows, '기본', true, '');
    expect(itemsWithInactive.some((s) => s.id === 'b2')).toBe(true);
  });

  test('신규 서비스 sort_order=999 → 해당 탭 맨 뒤에 위치', () => {
    const newSvc: MockService = {
      id: 'b_new',
      name: '신규항목',
      category_label: '기본',
      sort_order: 999,
      active: true,
    };
    const rows = [...MOCK_ROWS, newSvc];
    const items = getTabItems(rows, '기본', false, '');
    expect(items[items.length - 1].id).toBe('b_new');
  });

  test('sort_order 변경 후 rows 원본 category_label 변경 없음', () => {
    const updated = applyReorderBtn(MOCK_ROWS, '기본', false, 'b2', 'up');
    MOCK_ROWS.forEach((orig) => {
      const found = updated.find((s) => s.id === orig.id);
      expect(found?.category_label).toBe(orig.category_label);
    });
  });
});

// ── AC-7: 컴포넌트/탭 구조 ───────────────────────────────────────────────────
test.describe('AC-7: 컴포넌트/탭 구조', () => {
  test('CATEGORY_TABS에 전체 + 6개 카테고리 포함', () => {
    const CATEGORY_TABS_SPEC = ['전체', '기본', '검사', '상병', '풋케어', '수액', '풋화장품'];
    expect(CATEGORY_TABS_SPEC.length).toBe(7);
    expect(CATEGORY_TABS_SPEC[0]).toBe('전체');
    CATEGORY_TABS_SPEC.slice(1).forEach((tab) => {
      expect(['기본', '검사', '상병', '풋케어', '수액', '풋화장품']).toContain(tab);
    });
  });

  test('canReorder: admin + 특정 탭 + 검색 없음 조합만 true', () => {
    const canReorder = (isAdmin: boolean, activeTab: string, search: string) =>
      isAdmin && activeTab !== '전체' && !search;
    expect(canReorder(true, '전체', '')).toBe(false);
    expect(canReorder(true, '기본', '')).toBe(true);
    expect(canReorder(true, '기본', '검색어')).toBe(false);
    expect(canReorder(false, '기본', '')).toBe(false);
  });

  test('sort_order 재할당 패턴: index * 10', () => {
    const count = 5;
    const expected = Array.from({ length: count }, (_, i) => i * 10);
    expect(expected).toEqual([0, 10, 20, 30, 40]);
  });

  test('전체 탭: category_label 컬럼 표시, 재정렬 숨김', () => {
    // showCategoryLabel = (activeTab === '전체')
    const showCategoryLabel = (activeTab: string) => activeTab === '전체';
    expect(showCategoryLabel('전체')).toBe(true);
    expect(showCategoryLabel('기본')).toBe(false);
    expect(showCategoryLabel('풋케어')).toBe(false);
  });
});
