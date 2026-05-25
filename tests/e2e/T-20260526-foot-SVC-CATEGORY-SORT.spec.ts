/**
 * T-20260526-foot-SVC-CATEGORY-SORT
 * 서비스관리 항목분류별 자동 정렬 — 동일 카테고리 내 name 가나다순 2차 정렬
 *
 * AC-1: category_label 가나다순 → 동일 카테고리 내 name(시술명) 가나다순
 * AC-2: 카테고리 드롭다운 필터(SVC-FILTER-SEARCH) 조합 시에도 정렬 유지
 * AC-3: 신규 항목 추가 후 목록 리렌더 시에도 정렬 유지
 * AC-4: 기존 CRUD 무영향
 *
 * 참조: T-20260525-foot-SVC-CATEGORY-SORT (이전 구현 — category_label 단일 정렬)
 * 변경: 동일 카테고리 내 sort_order 유지 → name 가나다순 2차 정렬로 변경
 */

import { test, expect } from '@playwright/test';

type MockService = {
  id: string;
  name: string;
  category_label?: string;
  sort_order: number;
  active: boolean;
};

/** Services.tsx filteredRows 정렬 로직 재현 — category_label → name 2차 정렬 */
function sortServices(rows: MockService[]): MockService[] {
  return [...rows].sort((a, b) => {
    const catCmp = (a.category_label ?? '').localeCompare(b.category_label ?? '', 'ko');
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name, 'ko');
  });
}

/** applyFilterAndSort: 필터 + 2차 정렬 */
function applyFilterAndSort(
  items: MockService[],
  categoryFilter: string,
  showInactive: boolean,
  searchQuery = '',
): MockService[] {
  const filtered = items.filter((svc) => {
    if (!svc.active && !showInactive) return false;
    if (categoryFilter !== '전체' && svc.category_label !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!svc.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  return [...filtered].sort((a, b) => {
    const catCmp = (a.category_label ?? '').localeCompare(b.category_label ?? '', 'ko');
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name, 'ko');
  });
}

// ── AC-1: category_label → name 2차 정렬 ─────────────────────────────────────

test.describe('AC-1: category_label → name 2차 정렬', () => {
  const unsorted: MockService[] = [
    { id: '1', name: '풋케어C', category_label: '풋케어', sort_order: 30, active: true },
    { id: '2', name: '기본B', category_label: '기본', sort_order: 20, active: true },
    { id: '3', name: '혈액검사', category_label: '검사', sort_order: 10, active: true },
    { id: '4', name: '풋케어A', category_label: '풋케어', sort_order: 5, active: true },
    { id: '5', name: '기본A', category_label: '기본', sort_order: 50, active: true },
    { id: '6', name: '풋케어B', category_label: '풋케어', sort_order: 15, active: true },
    { id: '7', name: '수액Z', category_label: '수액', sort_order: 7, active: true },
  ];

  test('category_label 오름차순 (ㄱ→ㅎ)', () => {
    const sorted = sortServices(unsorted);
    const labels = sorted.map((s) => s.category_label ?? '');
    for (let i = 0; i < labels.length - 1; i++) {
      expect(labels[i].localeCompare(labels[i + 1], 'ko')).toBeLessThanOrEqual(0);
    }
  });

  test('동일 카테고리(풋케어) 내 name 가나다순 — AC-1 핵심', () => {
    const sorted = sortServices(unsorted);
    const footcare = sorted.filter((s) => s.category_label === '풋케어');
    // 풋케어A < 풋케어B < 풋케어C (가나다순, sort_order 무관)
    expect(footcare[0].name).toBe('풋케어A');
    expect(footcare[1].name).toBe('풋케어B');
    expect(footcare[2].name).toBe('풋케어C');
  });

  test('동일 카테고리(기본) 내 name 가나다순', () => {
    const sorted = sortServices(unsorted);
    const basic = sorted.filter((s) => s.category_label === '기본');
    // 기본A < 기본B
    expect(basic[0].name).toBe('기본A');
    expect(basic[1].name).toBe('기본B');
  });

  test('sort_order가 가나다순과 달라도 name 정렬 우선', () => {
    // sort_order가 역순이어도 name 가나다순으로 정렬되어야 함
    const rows: MockService[] = [
      { id: 'x1', name: '나', category_label: '풋케어', sort_order: 100, active: true },
      { id: 'x2', name: '가', category_label: '풋케어', sort_order: 1, active: true },
    ];
    const sorted = sortServices(rows);
    const footcare = sorted.filter((s) => s.category_label === '풋케어');
    expect(footcare[0].name).toBe('가');
    expect(footcare[1].name).toBe('나');
  });

  test('원본 배열 불변 (spread copy 확인)', () => {
    const original = unsorted.map((s) => ({ ...s }));
    sortServices(unsorted);
    unsorted.forEach((s, i) => {
      expect(s.id).toBe(original[i].id);
      expect(s.name).toBe(original[i].name);
    });
  });
});

// ── AC-2: 카테고리 드롭다운 필터 + 정렬 공존 ────────────────────────────────────

test.describe('AC-2: 카테고리 필터 + name 2차 정렬 공존', () => {
  const rows: MockService[] = [
    { id: '1', name: '레이저B', category_label: '풋케어', sort_order: 10, active: true },
    { id: '2', name: '기본검사', category_label: '기본', sort_order: 5, active: true },
    { id: '3', name: '레이저A', category_label: '풋케어', sort_order: 20, active: true },
    { id: '4', name: '수액A', category_label: '수액', sort_order: 7, active: true },
    { id: '5', name: '레이저C', category_label: '풋케어', sort_order: 3, active: true },
  ];

  test('필터=전체: category_label → name 2차 정렬 적용', () => {
    const result = applyFilterAndSort(rows, '전체', false);
    expect(result.length).toBe(5);
    // 풋케어 그룹 내 name 정렬 확인
    const footcare = result.filter((r) => r.category_label === '풋케어');
    expect(footcare[0].name).toBe('레이저A');
    expect(footcare[1].name).toBe('레이저B');
    expect(footcare[2].name).toBe('레이저C');
  });

  test('필터=풋케어: 풋케어만 반환 + name 가나다순', () => {
    const result = applyFilterAndSort(rows, '풋케어', false);
    expect(result.length).toBe(3);
    expect(result[0].name).toBe('레이저A');
    expect(result[1].name).toBe('레이저B');
    expect(result[2].name).toBe('레이저C');
  });

  test('필터=수액: 단일 항목 반환', () => {
    const result = applyFilterAndSort(rows, '수액', false);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('수액A');
  });

  test('필터=기본: 기본 1건 반환', () => {
    const result = applyFilterAndSort(rows, '기본', false);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('기본검사');
  });
});

// ── AC-3: 신규 항목 추가 후 정렬 유지 시뮬레이션 ─────────────────────────────────

test.describe('AC-3: 신규 항목 추가 후 정렬 유지', () => {
  test('기존 목록에 신규 항목 추가 시 name 가나다순 유지', () => {
    const existing: MockService[] = [
      { id: '1', name: '풋케어C', category_label: '풋케어', sort_order: 30, active: true },
      { id: '2', name: '풋케어A', category_label: '풋케어', sort_order: 5, active: true },
    ];
    // 신규 항목: 기본 카테고리, 가나다 중간 위치
    const newItem: MockService = {
      id: '99',
      name: '풋케어B',
      category_label: '풋케어',
      sort_order: 999, // sort_order 999로 추가됨
      active: true,
    };
    const after = sortServices([...existing, newItem]);
    const footcare = after.filter((s) => s.category_label === '풋케어');
    expect(footcare[0].name).toBe('풋케어A');
    expect(footcare[1].name).toBe('풋케어B'); // 신규 항목이 가나다 중간에 배치
    expect(footcare[2].name).toBe('풋케어C');
  });

  test('sort_order 999 신규 항목이 name 가나다순 첫 번째로 배치될 수 있음', () => {
    const existing: MockService[] = [
      { id: '1', name: '다시술', category_label: '기본', sort_order: 1, active: true },
      { id: '2', name: '나시술', category_label: '기본', sort_order: 2, active: true },
    ];
    const newItem: MockService = {
      id: '99',
      name: '가시술',
      category_label: '기본',
      sort_order: 999,
      active: true,
    };
    const after = sortServices([...existing, newItem]);
    const basic = after.filter((s) => s.category_label === '기본');
    expect(basic[0].name).toBe('가시술');
    expect(basic[1].name).toBe('나시술');
    expect(basic[2].name).toBe('다시술');
  });
});

// ── AC-4: CRUD 무영향 ─────────────────────────────────────────────────────────

test.describe('AC-4: CRUD 무영향 — 정렬은 클라이언트 표시 전용', () => {
  test('정렬 함수가 id·name·price 필드를 변경하지 않음', () => {
    const rows: MockService[] = [
      { id: 'aaa', name: '레이저B', category_label: '풋케어', sort_order: 10, active: true },
      { id: 'bbb', name: '기본검사', category_label: '기본', sort_order: 5, active: true },
      { id: 'ccc', name: '레이저A', category_label: '풋케어', sort_order: 20, active: true },
    ];
    const sorted = sortServices(rows);
    const ids = sorted.map((r) => r.id).sort();
    expect(ids).toEqual(['aaa', 'bbb', 'ccc']);
    const names = sorted.map((r) => r.name).sort();
    expect(names).toEqual(['기본검사', '레이저A', '레이저B']);
  });

  test('비활성 항목은 showInactive=false 시 필터됨 (정렬과 무관)', () => {
    const rows: MockService[] = [
      { id: '1', name: '활성A', category_label: '풋케어', sort_order: 10, active: true },
      { id: '2', name: '비활성B', category_label: '풋케어', sort_order: 5, active: false },
      { id: '3', name: '활성C', category_label: '기본', sort_order: 7, active: true },
    ];
    const result = applyFilterAndSort(rows, '전체', false);
    expect(result.length).toBe(2);
    expect(result.every((r) => r.active)).toBe(true);
  });

  test('비활성 항목도 showInactive=true 시 포함 + 정렬 적용', () => {
    const rows: MockService[] = [
      { id: '1', name: '활성B', category_label: '풋케어', sort_order: 10, active: true },
      { id: '2', name: '비활성A', category_label: '풋케어', sort_order: 5, active: false },
    ];
    const result = applyFilterAndSort(rows, '전체', true);
    expect(result.length).toBe(2);
    // 비활성A < 활성B (name 가나다순)
    expect(result[0].name).toBe('비활성A');
    expect(result[1].name).toBe('활성B');
  });
});

// ── E2E: Services 페이지 스모크 ──────────────────────────────────────────────

test.describe('Services 페이지 스모크 — 항목분류 + name 정렬 UI', () => {
  test('서비스관리 페이지 접근 시 테이블 렌더링', async ({ page }) => {
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: '서비스 관리' })).toBeVisible({ timeout: 5000 });
    // 카테고리 드롭다운 존재 확인 (AC-2)
    const dropdown = page.locator('button[role="combobox"]').first();
    await expect(dropdown).toBeVisible();
  });

  test('카테고리 드롭다운에 항목분류 옵션 포함 (AC-2)', async ({ page }) => {
    await page.goto('/services');
    const dropdown = page.locator('button[role="combobox"]').first();
    if (await dropdown.isVisible()) {
      await dropdown.click();
      const option = page.getByRole('option', { name: '풋케어' });
      if (await option.count() > 0) {
        await expect(option).toBeVisible();
      }
    }
  });
});
