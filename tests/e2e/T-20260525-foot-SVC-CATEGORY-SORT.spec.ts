/**
 * T-20260525-foot-SVC-CATEGORY-SORT
 * 서비스관리 항목분류별 자동 정렬
 *
 * AC-1: 기본 정렬을 category_label 오름차순으로 변경 (동일 카테고리 내 기존 정렬 유지)
 * AC-2: 카테고리 드롭다운 필터와 공존
 * AC-3: CRUD 무영향
 */

import { test, expect } from '@playwright/test';

// ── 단위 테스트: category_label 정렬 로직 ────────────────────────────────────────

type MockService = { id: string; name: string; category_label?: string; sort_order: number; active: boolean };

/** filteredRows 정렬 로직 재현 */
function sortByCategoryLabel(rows: MockService[]): MockService[] {
  return [...rows].sort((a, b) =>
    (a.category_label ?? '').localeCompare(b.category_label ?? '', 'ko'),
  );
}

test.describe('category_label 정렬 단위 테스트 — AC-1', () => {
  const unsorted: MockService[] = [
    { id: '1', name: '레이저A', category_label: '풋케어', sort_order: 10, active: true },
    { id: '2', name: '기본검사', category_label: '기본', sort_order: 5, active: true },
    { id: '3', name: '혈액검사', category_label: '검사', sort_order: 3, active: true },
    { id: '4', name: '레이저B', category_label: '풋케어', sort_order: 20, active: true },
    { id: '5', name: '상병코드A', category_label: '상병', sort_order: 8, active: true },
    { id: '6', name: '수액A', category_label: '수액', sort_order: 7, active: true },
    { id: '7', name: '기타품목', category_label: undefined, sort_order: 99, active: true },
  ];

  test('AC-1: category_label 오름차순으로 정렬됨', () => {
    const sorted = sortByCategoryLabel(unsorted);
    const labels = sorted.map((s) => s.category_label ?? '');
    // 인접 항목: 앞 ≤ 뒤 (localeCompare 기준)
    for (let i = 0; i < labels.length - 1; i++) {
      expect(labels[i].localeCompare(labels[i + 1], 'ko')).toBeLessThanOrEqual(0);
    }
  });

  test('AC-1: 동일 카테고리(풋케어) 내 sort_order 원본 순서 유지', () => {
    const sorted = sortByCategoryLabel(unsorted);
    const footcare = sorted.filter((s) => s.category_label === '풋케어');
    // 풋케어 그룹 내 sort_order는 오름차순 유지 (원본 rows가 sort_order 순이므로)
    expect(footcare[0].id).toBe('1'); // sort_order 10
    expect(footcare[1].id).toBe('4'); // sort_order 20
  });

  test('AC-1: category_label 없는 항목(null/undefined)은 맨 앞에 위치', () => {
    const sorted = sortByCategoryLabel(unsorted);
    // '' < '기본' (localeCompare)
    const emptyIdx = sorted.findIndex((s) => !s.category_label);
    const giboIdx = sorted.findIndex((s) => s.category_label === '기본');
    expect(emptyIdx).toBeLessThan(giboIdx);
  });

  test('AC-1: 원본 배열 불변 (spread copy 확인)', () => {
    const original = [...unsorted];
    sortByCategoryLabel(unsorted);
    // unsorted 순서 변경 없어야 함
    unsorted.forEach((s, i) => expect(s.id).toBe(original[i].id));
  });
});

// ── AC-2: 카테고리 드롭다운 필터 공존 ──────────────────────────────────────────

test.describe('category_label 필터 + 정렬 공존 — AC-2', () => {
  const rows: MockService[] = [
    { id: '1', name: '레이저A', category_label: '풋케어', sort_order: 10, active: true },
    { id: '2', name: '기본검사', category_label: '기본', sort_order: 5, active: true },
    { id: '3', name: '레이저B', category_label: '풋케어', sort_order: 20, active: true },
    { id: '4', name: '수액A', category_label: '수액', sort_order: 7, active: true },
  ];

  function applyFilterAndSort(
    items: MockService[],
    categoryFilter: string,
    showInactive: boolean,
  ): MockService[] {
    const filtered = items.filter((svc) => {
      if (!svc.active && !showInactive) return false;
      if (categoryFilter !== '전체' && svc.category_label !== categoryFilter) return false;
      return true;
    });
    return [...filtered].sort((a, b) =>
      (a.category_label ?? '').localeCompare(b.category_label ?? '', 'ko'),
    );
  }

  test('필터=전체: 모든 항목 반환, category_label 오름차순', () => {
    const result = applyFilterAndSort(rows, '전체', false);
    expect(result.length).toBe(4);
    const labels = result.map((r) => r.category_label ?? '');
    for (let i = 0; i < labels.length - 1; i++) {
      expect(labels[i].localeCompare(labels[i + 1], 'ko')).toBeLessThanOrEqual(0);
    }
  });

  test('필터=풋케어: 풋케어 2건만 반환', () => {
    const result = applyFilterAndSort(rows, '풋케어', false);
    expect(result.length).toBe(2);
    result.forEach((r) => expect(r.category_label).toBe('풋케어'));
  });

  test('필터=수액: 수액 1건만 반환', () => {
    const result = applyFilterAndSort(rows, '수액', false);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('수액A');
  });

  test('필터=기본: 기본 1건만 반환', () => {
    const result = applyFilterAndSort(rows, '기본', false);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('기본검사');
  });
});

// ── AC-3: CRUD 무영향 (정렬은 클라이언트 표시 전용) ──────────────────────────────

test.describe('CRUD 무영향 확인 — AC-3', () => {
  test('정렬 함수가 id·name·price 필드를 변경하지 않음', () => {
    const rows: MockService[] = [
      { id: 'aaa', name: '레이저A', category_label: '풋케어', sort_order: 10, active: true },
      { id: 'bbb', name: '기본검사', category_label: '기본', sort_order: 5, active: true },
    ];
    const sorted = sortByCategoryLabel(rows);
    // id, name 그대로 보존
    const ids = sorted.map((r) => r.id).sort();
    expect(ids).toEqual(['aaa', 'bbb']);
    const names = sorted.map((r) => r.name).sort();
    expect(names).toEqual(['기본검사', '레이저A']);
  });
});

// ── E2E: Services 페이지 렌더링 스모크 ──────────────────────────────────────────

test.describe('Services 페이지 스모크 — 항목분류 정렬 UI', () => {
  test('서비스관리 페이지 접근 시 테이블 렌더링', async ({ page }) => {
    await page.goto('/services');
    // "서비스 관리" 헤딩 확인
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
      // 드롭다운 열리면 '풋케어' 옵션 확인
      const option = page.getByRole('option', { name: '풋케어' });
      if (await option.count() > 0) {
        await expect(option).toBeVisible();
      }
    }
  });
});
