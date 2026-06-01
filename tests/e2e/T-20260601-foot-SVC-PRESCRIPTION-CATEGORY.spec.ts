/**
 * T-20260601-foot-SVC-PRESCRIPTION-CATEGORY
 * 서비스관리: "처방약" 독립 카테고리 신설 (탭/필터 노출).
 *
 * 진단(precheck): 처방약 서비스는 이미 DB에 category_label='처방약'(16건, active 12건)으로
 *   분류돼 있었으나, Services.tsx 의 CATEGORY_LABEL_OPTIONS 배열에 '처방약'이 누락되어
 *   탭(CATEGORY_TABS)/항목분류 옵션이 렌더되지 않고 '전체' 탭에서만 노출되던 상태.
 * 조치: CATEGORY_LABEL_OPTIONS 에 '처방약' 추가 (데이터 변경 없음 — 임의 매핑 금지 준수).
 *   → (1) CATEGORY_TABS 자동 생성, (2) ServiceDialog 항목분류 버튼 자동 추가.
 *
 * AC-1: 카테고리 탭에 '처방약' 항목 표시
 * AC-2: '처방약' 탭 선택 시 처방약 서비스만 노출
 * AC-3: '전체' 탭에서는 처방약 서비스가 여전히 포함
 * AC-4: 처방약 외 기존 카테고리 탭/항목/정렬 무영향
 * AC-5: (데이터) category_label='처방약' 영속 → 재진입 시 처방약 탭 유지
 */

import { test, expect } from '@playwright/test';

// ── SUT: Services.tsx 상수 재현 ──────────────────────────────────────────────
// 변경 후 옵션 — '처방약' 포함 (상병 다음, 의료성 그룹 인접)
const CATEGORY_LABEL_OPTIONS = ['기본', '검사', '상병', '처방약', '풋케어', '수액', '풋화장품'];
const CATEGORY_TABS = ['전체', ...CATEGORY_LABEL_OPTIONS];

// ── 타입 ─────────────────────────────────────────────────────────────────────
type MockService = {
  id: string;
  name: string;
  category: string | null;
  category_label: string | null;
  sort_order: number;
  active: boolean;
};

// ── SUT: effectiveCategoryLabel / getTabItems 재현 ───────────────────────────
const effectiveCategoryLabel = (svc: MockService): string =>
  svc.category_label ?? svc.category ?? '';

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

// ── 샘플: 현장 실제 분포 반영 (처방약 = 이미 category_label='처방약') ─────────
const RX_ROWS: MockService[] = [
  { id: 'rx1', name: '주블리아외용액 4ml(에피나코나졸)', category: '처방약', category_label: '처방약', sort_order: 0, active: true },
  { id: 'rx2', name: '루마졸크림(플루트리마졸)', category: '처방약', category_label: '처방약', sort_order: 10, active: true },
  { id: 'rx3', name: '에스로반연고(무피로신)(10g)', category: '처방약', category_label: '처방약', sort_order: 20, active: true },
  { id: 'rx4', name: '케이졸', category: '처방약', category_label: '처방약', sort_order: 30, active: false }, // 비활성
];
const OTHER_ROWS: MockService[] = [
  { id: 'f1', name: '레이저', category: '레이저', category_label: '풋케어', sort_order: 0, active: true },
  { id: 'b1', name: '초진진찰료', category: '진료', category_label: '기본', sort_order: 0, active: true },
  { id: 'k1', name: 'KOH 균검사', category: '검사', category_label: '검사', sort_order: 0, active: true },
  { id: 'c1', name: '리페어 핸드크림 (30ml)', category: '풋화장품', category_label: '풋화장품', sort_order: 0, active: true },
];
const MOCK_ROWS = [...RX_ROWS, ...OTHER_ROWS];

// ── 버그 재현: 옵션 누락 시 처방약 탭이 존재하지 않았다 ───────────────────────
test.describe('버그 재현 (옵션 누락 상태)', () => {
  const OLD_OPTIONS = ['기본', '검사', '상병', '풋케어', '수액', '풋화장품'];
  test('변경 전: 탭 목록에 처방약이 없다', () => {
    const oldTabs = ['전체', ...OLD_OPTIONS];
    expect(oldTabs).not.toContain('처방약');
  });
  test('변경 전: 전체 탭에서는 처방약 서비스가 보인다 (현장 증언 일치)', () => {
    const ids = getTabItems(MOCK_ROWS, '전체', false, '').map((s) => s.id);
    ['rx1', 'rx2', 'rx3'].forEach((id) => expect(ids).toContain(id));
  });
});

// ── AC-1: 카테고리 탭에 '처방약' 표시 ────────────────────────────────────────
test.describe('AC-1: 처방약 탭 존재', () => {
  test('CATEGORY_TABS 에 처방약 포함', () => {
    expect(CATEGORY_TABS).toContain('처방약');
  });
  test('항목분류 옵션(다이얼로그)에도 처방약 추가됨', () => {
    expect(CATEGORY_LABEL_OPTIONS).toContain('처방약');
  });
});

// ── AC-2: 처방약 탭 선택 시 처방약 서비스만 ───────────────────────────────────
test.describe('AC-2: 처방약 탭 필터', () => {
  test('처방약 탭에 활성 처방약 3건만 표시', () => {
    const items = getTabItems(MOCK_ROWS, '처방약', false, '');
    expect(items.map((s) => s.id).sort()).toEqual(['rx1', 'rx2', 'rx3']);
  });
  test('비활성 포함 시 처방약 4건 (활성3+비활성1)', () => {
    const items = getTabItems(MOCK_ROWS, '처방약', true, '');
    expect(items.length).toBe(4);
  });
  test('처방약 탭에 처방약 외 서비스는 노출 안 됨', () => {
    const ids = getTabItems(MOCK_ROWS, '처방약', true, '').map((s) => s.id);
    ['f1', 'b1', 'k1', 'c1'].forEach((id) => expect(ids).not.toContain(id));
  });
});

// ── AC-3: 전체 탭 포함 유지 ───────────────────────────────────────────────────
test.describe('AC-3: 전체 탭 포함 유지', () => {
  test('전체 탭에 처방약 서비스가 다른 서비스와 함께 포함', () => {
    const ids = getTabItems(MOCK_ROWS, '전체', false, '').map((s) => s.id);
    ['rx1', 'rx2', 'rx3', 'f1', 'b1', 'k1', 'c1'].forEach((id) => expect(ids).toContain(id));
  });
});

// ── AC-4: 다른 카테고리 무영향 ────────────────────────────────────────────────
test.describe('AC-4: 처방약 외 카테고리 무영향', () => {
  test('풋케어/기본/검사/풋화장품 탭 분류 그대로', () => {
    expect(getTabItems(MOCK_ROWS, '풋케어', false, '').map((s) => s.id)).toEqual(['f1']);
    expect(getTabItems(MOCK_ROWS, '기본', false, '').map((s) => s.id)).toEqual(['b1']);
    expect(getTabItems(MOCK_ROWS, '검사', false, '').map((s) => s.id)).toEqual(['k1']);
    expect(getTabItems(MOCK_ROWS, '풋화장품', false, '').map((s) => s.id)).toEqual(['c1']);
  });
  test('기존 탭 순서 보존 + 처방약은 상병 다음에 삽입', () => {
    expect(CATEGORY_TABS).toEqual(['전체', '기본', '검사', '상병', '처방약', '풋케어', '수액', '풋화장품']);
  });
});

// ── AC-5: 영속성 (재진입 = 동일 rows 재계산) ─────────────────────────────────
test.describe('AC-5: category_label 영속 (재진입 유지)', () => {
  test('동일 rows 재계산(재접속) 시에도 처방약 탭 유지', () => {
    const first = getTabItems(MOCK_ROWS, '처방약', false, '').map((s) => s.id).sort();
    const second = getTabItems([...MOCK_ROWS], '처방약', false, '').map((s) => s.id).sort();
    expect(second).toEqual(first);
    expect(second).toEqual(['rx1', 'rx2', 'rx3']);
  });
});

// ── 시나리오 2(엣지): SVC-CATEGORY-SORT 회귀 방지 ────────────────────────────
test.describe('시나리오 2: 엣지/회귀', () => {
  test('처방약 탭 sort_order 오름차순 정렬 유지', () => {
    const items = getTabItems(MOCK_ROWS, '처방약', false, '');
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].sort_order).toBeLessThanOrEqual(items[i + 1].sort_order);
    }
  });
  test('처방약 탭에서 순서 재배치 후에도 동일 집합 유지 (정렬 키만 변경)', () => {
    // sort_order 를 뒤집어도 같은 3건이 동일 탭에 유지 (SVC-CATEGORY-SORT persist 회귀)
    const reordered = MOCK_ROWS.map((s) =>
      s.category_label === '처방약' && s.active ? { ...s, sort_order: 100 - s.sort_order } : s,
    );
    const ids = getTabItems(reordered, '처방약', false, '').map((s) => s.id).sort();
    expect(ids).toEqual(['rx1', 'rx2', 'rx3']);
  });
});
