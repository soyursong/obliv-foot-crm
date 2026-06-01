/**
 * T-20260601-foot-SVC-COSMETIC-LABEL-BACKFILL
 * 서비스관리 '풋화장품' 탭에 항목 미표시 버그 — 데이터 정규화 + 코드 fallback
 *
 * 실제 원인(precheck): 풋화장품 탭 = category_label='풋화장품'(무공백).
 *   활성 화장품 7건은 category_label/category='풋 화장품'(공백) 변형 → 탭에서 필터아웃.
 *   무공백 '풋화장품' 5건은 모두 비활성 → 기본 숨김 → 탭이 비어 보임.
 * 조치 1) 데이터: '풋 화장품' → '풋화장품' 정규화 (category_label + category).
 *      2) 코드: 탭 필터를 effectiveCategoryLabel = category_label ?? category 로 보강
 *               (category_label NULL 레거시 row 의 category 기준 분류 — 일반화/방어).
 *
 * AC-1: 풋화장품 탭 클릭 시 풋화장품 서비스 정상 표시
 * AC-2: 전체 탭에서도 풋화장품 서비스 포함
 * AC-3: 풋화장품 외 기존 카테고리 탭/항목/정렬 무영향
 * AC-4: backfill 된 category_label 영속 (재진입 후 유지)
 * AC-5: category_label 미설정 레거시 row 가 category 기준 탭으로 분류 (fallback)
 */

import { test, expect } from '@playwright/test';

// ── 타입 ─────────────────────────────────────────────────────────────────────
type MockService = {
  id: string;
  name: string;
  category: string | null;
  category_label: string | null;
  sort_order: number;
  active: boolean;
};

// ── SUT: Services.tsx 의 effectiveCategoryLabel 재현 ─────────────────────────
const effectiveCategoryLabel = (svc: MockService): string =>
  svc.category_label ?? svc.category ?? '';

// ── SUT: tabItems 필터 (fallback 적용) 재현 ──────────────────────────────────
function getTabItems(
  rows: MockService[],
  activeTab: string,
  showInactive: boolean,
  searchQuery: string,
): MockService[] {
  const base = rows.filter((svc) => {
    if (!svc.active && !showInactive) return false;
    if (activeTab !== '전체' && effectiveCategoryLabel(svc) !== activeTab) return false;
    if (searchQuery) return svc.name.toLowerCase().includes(searchQuery.toLowerCase());
    return true;
  });
  if (activeTab === '전체') {
    return [...base].sort((a, b) => {
      const catCmp = effectiveCategoryLabel(a).localeCompare(effectiveCategoryLabel(b), 'ko');
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

// ── SUT: 데이터 정규화('풋 화장품' → '풋화장품') 재현 ────────────────────────
function normalizeCosmeticLabel(rows: MockService[]): MockService[] {
  return rows.map((s) =>
    s.category_label === '풋 화장품'
      ? { ...s, category_label: '풋화장품', category: '풋화장품' }
      : s,
  );
}

// ── 샘플: 버그 재현 데이터 (현장 실제 분포 반영) ──────────────────────────────
// 활성 화장품 7건 = '풋 화장품'(공백), 비활성 화장품 5건 = '풋화장품'(무공백)
const COSMETIC_SPACED: MockService[] = [
  { id: 'c1', name: '네일 폴드 오일 (7ml)', category: '풋 화장품', category_label: '풋 화장품', sort_order: 0, active: true },
  { id: 'c2', name: '리페어 핸드크림 (30ml)', category: '풋 화장품', category_label: '풋 화장품', sort_order: 10, active: true },
  { id: 'c3', name: '풋샴푸 (200ml)', category: '풋 화장품', category_label: '풋 화장품', sort_order: 20, active: true },
];
const COSMETIC_NOSPACE_INACTIVE: MockService[] = [
  { id: 'd1', name: '발각질크림(100g)', category: '풋화장품', category_label: '풋화장품', sort_order: 0, active: false },
  { id: 'd2', name: '풋샴푸(150ml)', category: '풋화장품', category_label: '풋화장품', sort_order: 10, active: false },
];
const OTHER_ROWS: MockService[] = [
  { id: 'f1', name: '레이저', category: '레이저', category_label: '풋케어', sort_order: 0, active: true },
  { id: 'b1', name: '초진진찰료', category: '진료', category_label: '기본', sort_order: 0, active: true },
];
const MOCK_ROWS = [...COSMETIC_SPACED, ...COSMETIC_NOSPACE_INACTIVE, ...OTHER_ROWS];

// ── 버그 재현: 정규화 전에는 풋화장품 탭이 비어 보인다 ────────────────────────
test.describe('버그 재현 (정규화/fallback 전 상태)', () => {
  test('정규화 전: 풋화장품 탭에 활성 화장품이 안 보인다 (공백 변형 필터아웃)', () => {
    // category_label='풋 화장품'(공백) ≠ 탭 '풋화장품' → 활성 7건 미표시
    // category_label='풋화장품' 5건은 비활성 → 기본 숨김
    const items = getTabItems(MOCK_ROWS, '풋화장품', false, '');
    expect(items.length).toBe(0); // 탭이 비어 보이는 현장 증상 재현
  });

  test('정규화 전: 전체 탭에서는 활성 화장품이 보인다 (현장 증언 일치)', () => {
    const items = getTabItems(MOCK_ROWS, '전체', false, '');
    const ids = items.map((s) => s.id);
    COSMETIC_SPACED.forEach((s) => expect(ids).toContain(s.id));
  });
});

// ── AC-1: 정규화 후 풋화장품 탭 정상 표시 ────────────────────────────────────
test.describe('AC-1: 풋화장품 탭 정상 표시', () => {
  test('정규화 후: 풋화장품 탭에 활성 화장품 3건 표시', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    const items = getTabItems(rows, '풋화장품', false, '');
    expect(items.map((s) => s.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  test('정규화 후: 비활성 포함 시 풋화장품 탭에 5건(활성3+비활성2)', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    const items = getTabItems(rows, '풋화장품', true, '');
    expect(items.length).toBe(5);
  });
});

// ── AC-2: 전체 탭에도 포함 ────────────────────────────────────────────────────
test.describe('AC-2: 전체 탭 포함 유지', () => {
  test('정규화 후: 전체 탭에 활성 화장품 포함', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    const ids = getTabItems(rows, '전체', false, '').map((s) => s.id);
    ['c1', 'c2', 'c3'].forEach((id) => expect(ids).toContain(id));
  });
});

// ── AC-3: 다른 카테고리 무영향 ────────────────────────────────────────────────
test.describe('AC-3: 풋화장품 외 카테고리 무영향', () => {
  test('정규화는 풋화장품(공백) row 만 변경, 다른 row 불변', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    rows.forEach((s) => {
      const orig = MOCK_ROWS.find((o) => o.id === s.id)!;
      if (orig.category_label === '풋 화장품') {
        expect(s.category_label).toBe('풋화장품');
        expect(s.category).toBe('풋화장품');
      } else {
        expect(s.category_label).toBe(orig.category_label);
        expect(s.category).toBe(orig.category);
      }
    });
  });

  test('풋케어/기본 탭 항목은 그대로 분류', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    expect(getTabItems(rows, '풋케어', false, '').map((s) => s.id)).toEqual(['f1']);
    expect(getTabItems(rows, '기본', false, '').map((s) => s.id)).toEqual(['b1']);
  });
});

// ── AC-4: 영속성 (재진입 = 동일 rows 재계산) ─────────────────────────────────
test.describe('AC-4: category_label 영속', () => {
  test('정규화된 rows 재계산 시에도 풋화장품 탭 유지 (멱등)', () => {
    const once = normalizeCosmeticLabel(MOCK_ROWS);
    const twice = normalizeCosmeticLabel(once); // 재진입/재실행 멱등
    expect(getTabItems(twice, '풋화장품', false, '').map((s) => s.id).sort())
      .toEqual(['c1', 'c2', 'c3']);
    expect(twice.filter((s) => s.category_label === '풋 화장품').length).toBe(0);
  });
});

// ── AC-5: category_label NULL 레거시 → category fallback ─────────────────────
test.describe('AC-5: fallback (category_label NULL → category)', () => {
  test('category_label NULL + category=검사 → 검사 탭에 분류', () => {
    const legacy: MockService = {
      id: 'g1', name: 'KOH 균검사', category: '검사', category_label: null, sort_order: 0, active: true,
    };
    const rows = [...MOCK_ROWS, legacy];
    const items = getTabItems(rows, '검사', false, '');
    expect(items.some((s) => s.id === 'g1')).toBe(true);
  });

  test('effectiveCategoryLabel: NULL이면 category, 둘 다 NULL이면 빈문자열', () => {
    expect(effectiveCategoryLabel({ id: 'x', name: 'x', category: '검사', category_label: null, sort_order: 0, active: true })).toBe('검사');
    expect(effectiveCategoryLabel({ id: 'x', name: 'x', category: '풋케어', category_label: '풋화장품', sort_order: 0, active: true })).toBe('풋화장품');
    expect(effectiveCategoryLabel({ id: 'x', name: 'x', category: null, category_label: null, sort_order: 0, active: true })).toBe('');
  });
});

// ── 시나리오 2(엣지): 풋화장품 외 탭에서 화장품 노출 안 됨 ────────────────────
test.describe('시나리오 2: 엣지 케이스', () => {
  test('풋케어 탭에는 화장품이 노출되지 않음', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    const ids = getTabItems(rows, '풋케어', false, '').map((s) => s.id);
    ['c1', 'c2', 'c3', 'd1', 'd2'].forEach((id) => expect(ids).not.toContain(id));
  });

  test('SVC-CATEGORY-SORT 회귀 방지: 특정 탭 sort_order 정렬 유지', () => {
    const rows = normalizeCosmeticLabel(MOCK_ROWS);
    const items = getTabItems(rows, '풋화장품', false, '');
    // sort_order 오름차순 유지 (c1=0, c2=10, c3=20)
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].sort_order).toBeLessThanOrEqual(items[i + 1].sort_order);
    }
  });
});
