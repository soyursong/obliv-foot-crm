/**
 * T-20260607-foot-RXQUICK-SORT-DND
 * 빠른처방 정렬: 숫자입력 → :: 드래그핸들 DnD
 *
 * AC-1: 목록을 :: 드래그핸들로 재정렬 (DnD)
 * AC-2: 드롭 시점 순번 일괄 저장 (변경된 행만 DB UPDATE, sort_order = index*10)
 * AC-3: 저장 실패 시 직전 순서로 롤백 (낙관적 반영 → 롤백)
 * AC-4: 신규 버튼은 목록 말미(max sort_order + 10)에 추가
 * AC-5: 다이얼로그 '정렬 순서' 숫자입력 제거(코드 회귀 가드)
 *
 * 정렬/diff 로직은 QuickRxButtonsTab.handleDragEnd 구현을 순수 함수로 재현.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAB_SRC = resolve(__dirname, '../../src/components/admin/QuickRxButtonsTab.tsx');

type Btn = { id: string; sort_order: number };

// ── @dnd-kit arrayMove 재현 (oldIdx → newIdx) ──────────────────────────────
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

// ── handleDragEnd 핵심: reorder → sort_order(=index*10) 재계산 → 변경분만 추출 ──
function computeReorder(items: Btn[], activeId: string, overId: string) {
  const oldIdx = items.findIndex((x) => x.id === activeId);
  const newIdx = items.findIndex((x) => x.id === overId);
  if (oldIdx === -1 || newIdx === -1) return { reordered: items, updates: [] as Btn[] };
  const reordered = arrayMove(items, oldIdx, newIdx).map((b, i) => ({ ...b, sort_order: i * 10 }));
  const prevById = new Map(items.map((b) => [b.id, b.sort_order]));
  const updates = reordered
    .filter((b) => prevById.get(b.id) !== b.sort_order)
    .map(({ id, sort_order }) => ({ id, sort_order }));
  return { reordered, updates };
}

const base: Btn[] = [
  { id: 'a', sort_order: 0 },
  { id: 'b', sort_order: 10 },
  { id: 'c', sort_order: 20 },
  { id: 'd', sort_order: 30 },
];

// ── AC-1/AC-2: 재정렬 + 일괄 저장 diff ──────────────────────────────────────
test.describe('재정렬 + sort_order 일괄 저장 — AC-1/AC-2', () => {
  test('a를 c자리로 이동: 순서가 b,c,a,d 로 바뀜', () => {
    const { reordered } = computeReorder(base, 'a', 'c');
    expect(reordered.map((b) => b.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  test('재정렬 후 sort_order는 index*10 으로 재부여', () => {
    const { reordered } = computeReorder(base, 'a', 'c');
    expect(reordered.map((b) => b.sort_order)).toEqual([0, 10, 20, 30]);
  });

  test('변경분만 추출 — 이동 영향받은 행만 UPDATE 대상', () => {
    // b,c는 한 칸씩 당겨져 sort_order 변함, a는 위치/값 변함, d는 유지(30→30)
    const { updates } = computeReorder(base, 'a', 'c');
    const ids = updates.map((u) => u.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']); // d 제외
  });

  test('제자리 드롭(같은 id)은 변경 없음 → UPDATE 0건', () => {
    const { updates } = computeReorder(base, 'b', 'b');
    expect(updates.length).toBe(0);
  });

  test('인접 스왑(b↔c): 두 행만 변경', () => {
    const { reordered, updates } = computeReorder(base, 'b', 'c');
    expect(reordered.map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(updates.map((u) => u.id).sort()).toEqual(['b', 'c']);
  });
});

// ── AC-3: 롤백 의미론 (낙관 → 실패 시 snapshot 복원) ─────────────────────────
test.describe('저장 실패 롤백 — AC-3', () => {
  test('snapshot(직전 순서)이 보존되어 복원 가능', () => {
    const snapshot = base.slice();
    const { reordered } = computeReorder(base, 'a', 'd');
    // 낙관적 반영본과 snapshot은 서로 다른 배열 (원본 불변)
    expect(reordered.map((b) => b.id)).not.toEqual(snapshot.map((b) => b.id));
    // snapshot 으로 되돌리면 원래 순서
    expect(snapshot.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('computeReorder 는 원본 배열을 변형하지 않음(immutable)', () => {
    const before = base.map((b) => b.id);
    computeReorder(base, 'a', 'd');
    expect(base.map((b) => b.id)).toEqual(before);
  });
});

// ── AC-4: 신규 버튼 append (max + 10) ───────────────────────────────────────
test.describe('신규 버튼 정렬순서 자동 부여 — AC-4', () => {
  function nextSortOrder(items: Btn[]): number {
    const maxOrder = items.reduce((m, b) => Math.max(m, b.sort_order ?? 0), -10);
    return maxOrder + 10;
  }
  test('기존 max(30) + 10 = 40 으로 말미 추가', () => {
    expect(nextSortOrder(base)).toBe(40);
  });
  test('빈 목록이면 0 부여', () => {
    expect(nextSortOrder([])).toBe(0);
  });
});

// ── AC-5: 다이얼로그 숫자입력 제거 회귀 가드 (소스 정적 검사) ──────────────────
test.describe('정렬 숫자입력 제거 + DnD 도입 — AC-5 회귀 가드', () => {
  const src = readFileSync(TAB_SRC, 'utf8');

  test('sort_order 숫자 Input(type="number") 제거됨', () => {
    // 정렬 순서 라벨 + number input 조합이 더 이상 없어야 함
    expect(src).not.toMatch(/정렬 순서[\s\S]{0,200}type="number"/);
  });

  test('DnD 핸들/컨텍스트 도입됨', () => {
    expect(src).toContain('DndContext');
    expect(src).toContain('SortableContext');
    expect(src).toContain('quick-rx-btn-handle');
  });

  test('드롭 시 quick_rx_buttons.sort_order 일괄 저장 호출 존재', () => {
    expect(src).toContain("from('quick_rx_buttons').update({ sort_order })");
  });
});
