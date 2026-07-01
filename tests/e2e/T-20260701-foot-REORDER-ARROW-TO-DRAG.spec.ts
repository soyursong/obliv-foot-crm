/**
 * T-20260701-foot-REORDER-ARROW-TO-DRAG
 * 순서변경 UI: 위아래 화살표(ChevronUp/Down) → 잡아끌기(@dnd-kit 드래그) 통일
 *
 * 대상 2곳:
 *   (A) 상용구 문구템플릿  — src/components/admin/PhrasesTab.tsx (handleMove → handleDragEnd)
 *   (B) 상병명 폴더트리     — src/components/admin/DiagnosisNamesTab.tsx (handleMoveFolder → handleFolderReorder, 형제 폴더만)
 *
 * AC-1 화살표 버튼 제거 + 드래그 핸들 노출 (소스 회귀 가드)
 * AC-2 상병 폴더: 형제 레벨 내에서만 재정렬(계층/부모 이동 없음)
 * AC-3 드롭 후 sort_order 저장(10 간격 재번호, 변경분만 UPDATE)
 * AC-4 저장 실패 시 이전 순서로 롤백(스냅샷 불변)
 * AC-6 상용구: 카테고리 필터가 걸려 있어도 유형 전역 순서 일관성(필터 제외분 제자리)
 *
 * 정렬/diff 로직은 각 컴포넌트의 handleDragEnd/handleFolderReorder 구현을 순수 함수로 재현.
 * DDL 0 — sort_order 컬럼/저장경로(useReorderPhrases · updateFolder) 불변, 이동 UI만 교체.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PHRASES_SRC = resolve(__dirname, '../../src/components/admin/PhrasesTab.tsx');
const DIAG_SRC = resolve(__dirname, '../../src/components/admin/DiagnosisNamesTab.tsx');

// ── @dnd-kit arrayMove 재현 ─────────────────────────────────────────────────
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

// ═══════════════════════════════════════════════════════════════════════════
// (A) PhrasesTab.handleDragEnd 재현
//     displayed(화면·카테고리 필터 반영) 재배치 → typeFiltered(유형 전역) 슬롯에 주입 →
//     10 간격 재번호 → 변경분만 추출.
// ═══════════════════════════════════════════════════════════════════════════
type Phrase = { id: number; phrase_type: string; category: string; sort_order: number };

function computePhraseReorder(
  all: Phrase[],
  effectiveType: string,
  filterCat: string,
  activeId: number,
  overId: number,
) {
  const typeFiltered = all.filter(
    (p) => effectiveType === 'all' || (p.phrase_type ?? 'pen_chart') === effectiveType,
  );
  const displayed = typeFiltered.filter((p) => filterCat === 'all' || p.category === filterCat);
  const fromDisp = displayed.findIndex((p) => p.id === activeId);
  const toDisp = displayed.findIndex((p) => p.id === overId);
  if (fromDisp === -1 || toDisp === -1) return { typeOrder: typeFiltered, updates: [] as { id: number; sort_order: number }[] };

  const newDisplayed = arrayMove(displayed, fromDisp, toDisp);
  const dispIds = new Set(displayed.map((p) => p.id));
  const nextTypeOrder = [...typeFiltered];
  let k = 0;
  for (let i = 0; i < nextTypeOrder.length; i++) {
    if (dispIds.has(nextTypeOrder[i].id)) nextTypeOrder[i] = newDisplayed[k++];
  }
  const renumbered = nextTypeOrder.map((p, i) => ({ ...p, sort_order: (i + 1) * 10 }));
  const prevOrder = new Map(typeFiltered.map((p) => [p.id, p.sort_order]));
  const updates = renumbered
    .filter((p) => prevOrder.get(p.id) !== p.sort_order)
    .map((p) => ({ id: p.id, sort_order: p.sort_order }));
  return { typeOrder: renumbered, updates };
}

const phrases: Phrase[] = [
  { id: 1, phrase_type: 'pen_chart', category: 'charting', sort_order: 10 },
  { id: 2, phrase_type: 'pen_chart', category: 'document', sort_order: 20 },
  { id: 3, phrase_type: 'pen_chart', category: 'charting', sort_order: 30 },
  { id: 4, phrase_type: 'pen_chart', category: 'charting', sort_order: 40 },
  { id: 5, phrase_type: 'medical_chart', category: 'charting', sort_order: 10 }, // 타 유형 — 불변 보장
];

test.describe('상용구 드래그 재정렬 — AC-3/AC-6', () => {
  test('전체 카테고리(all): 1을 3자리로 이동 → 유형 순서 2,3,1,4', () => {
    const { typeOrder } = computePhraseReorder(phrases, 'pen_chart', 'all', 1, 3);
    expect(typeOrder.map((p) => p.id)).toEqual([2, 3, 1, 4]);
  });

  test('재정렬 후 sort_order 는 10 간격 재부여', () => {
    const { typeOrder } = computePhraseReorder(phrases, 'pen_chart', 'all', 1, 3);
    expect(typeOrder.map((p) => p.sort_order)).toEqual([10, 20, 30, 40]);
  });

  test('AC-6: 카테고리 필터(charting) 상태에서 1→4 이동해도 필터 제외분(2/document)은 제자리', () => {
    // displayed(charting) = [1,3,4]. 1을 4자리로 → [3,4,1]. 2(document)는 유형 전역에서 위치 고정.
    const { typeOrder } = computePhraseReorder(phrases, 'pen_chart', 'charting', 1, 4);
    // typeFiltered 슬롯: [charting,document,charting,charting] = [id?,2,id?,id?]
    // 화면 제외분 2는 원래 2번째 슬롯 유지, charting 슬롯들만 [3,4,1] 순으로 채워짐 → [3,2,4,1]
    expect(typeOrder.map((p) => p.id)).toEqual([3, 2, 4, 1]);
    // document(2) 위치가 그대로 = 필터 제외분 제자리
    expect(typeOrder.findIndex((p) => p.id === 2)).toBe(1);
  });

  test('타 유형(medical_chart id=5)은 pen_chart 재정렬 updates 에 포함되지 않음', () => {
    const { updates } = computePhraseReorder(phrases, 'pen_chart', 'all', 1, 3);
    expect(updates.some((u) => u.id === 5)).toBe(false);
  });

  test('제자리(같은 id) 드롭 → updates 0건', () => {
    const { updates } = computePhraseReorder(phrases, 'pen_chart', 'all', 2, 2);
    expect(updates.length).toBe(0);
  });

  test('AC-4: 원본 배열 불변(롤백용 snapshot 보존 가능)', () => {
    const before = phrases.map((p) => `${p.id}:${p.sort_order}`);
    computePhraseReorder(phrases, 'pen_chart', 'all', 1, 4);
    expect(phrases.map((p) => `${p.id}:${p.sort_order}`)).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (B) DiagnosisNamesTab.handleFolderReorder 재현 — 형제 폴더만 재정렬
// ═══════════════════════════════════════════════════════════════════════════
type Folder = { id: string; parent_id: string | null; sort_order: number; name: string };

function siblingsAt(folders: Folder[], parentId: string | null): Folder[] {
  return folders
    .filter((f) => (f.parent_id ?? null) === parentId)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'));
}

function computeFolderReorder(folders: Folder[], activeId: string, overId: string) {
  const node = folders.find((f) => f.id === activeId);
  const over = folders.find((f) => f.id === overId);
  // handleDragEnd 가드: 폴더가 아니거나 다른 부모면 no-op(형제 레벨만)
  if (!node || !over) return { updates: [] as { id: string; sort_order: number }[], blocked: true };
  if ((node.parent_id ?? null) !== (over.parent_id ?? null)) return { updates: [], blocked: true };

  const sibs = siblingsAt(folders, node.parent_id ?? null);
  const from = sibs.findIndex((s) => s.id === activeId);
  const to = sibs.findIndex((s) => s.id === overId);
  if (from === -1 || to === -1 || from === to) return { updates: [], blocked: false };
  const reordered = arrayMove(sibs, from, to);
  const updates = reordered
    .map((f, idx) => ({ id: f.id, sort_order: idx * 10, prev: f.sort_order }))
    .filter((u) => u.prev !== u.sort_order)
    .map(({ id, sort_order }) => ({ id, sort_order }));
  return { order: reordered.map((f) => f.id), updates, blocked: false };
}

const folders: Folder[] = [
  { id: 'r1', parent_id: null, sort_order: 0, name: '족부' },
  { id: 'r2', parent_id: null, sort_order: 10, name: '수부' },
  { id: 'r3', parent_id: null, sort_order: 20, name: '척추' },
  { id: 'c1', parent_id: 'r1', sort_order: 0, name: '전족' },
  { id: 'c2', parent_id: 'r1', sort_order: 10, name: '후족' },
];

test.describe('상병 폴더 드래그 재정렬 — AC-2/AC-3', () => {
  test('루트 형제: r1을 r3자리로 이동 → r2,r3,r1', () => {
    const { order } = computeFolderReorder(folders, 'r1', 'r3');
    expect(order).toEqual(['r2', 'r3', 'r1']);
  });

  test('재정렬 후 sort_order 0,10,20 재부여(변경분만)', () => {
    const { updates } = computeFolderReorder(folders, 'r1', 'r3');
    // r1: 0→20, r2: 10→0, r3: 20→10 (모두 변경)
    expect(updates.map((u) => u.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  test('AC-2: 다른 부모(루트 r2 위에 자식 c1 드롭) → 차단(형제 아님, no-op)', () => {
    const res = computeFolderReorder(folders, 'c1', 'r2');
    expect(res.blocked).toBe(true);
    expect(res.updates.length).toBe(0);
  });

  test('자식 형제(c1↔c2) 재정렬은 정상 동작', () => {
    const { order } = computeFolderReorder(folders, 'c1', 'c2');
    expect(order).toEqual(['c2', 'c1']);
  });

  test('AC-4: 원본 folders 불변', () => {
    const before = folders.map((f) => `${f.id}:${f.sort_order}`);
    computeFolderReorder(folders, 'r1', 'r3');
    expect(folders.map((f) => `${f.id}:${f.sort_order}`)).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: 소스 회귀 가드 — 화살표 제거 + 드래그 핸들/컨텍스트 도입
// ═══════════════════════════════════════════════════════════════════════════
test.describe('화살표 제거 + 드래그 도입 — AC-1 회귀 가드', () => {
  const phraseSrc = readFileSync(PHRASES_SRC, 'utf8');
  const diagSrc = readFileSync(DIAG_SRC, 'utf8');

  test('PhrasesTab: ChevronUp/Down + ↑↓ 버튼 testid 제거', () => {
    expect(phraseSrc).not.toContain('ChevronUp');
    expect(phraseSrc).not.toContain('ChevronDown');
    expect(phraseSrc).not.toContain('phrase-move-up-btn');
    expect(phraseSrc).not.toContain('phrase-move-down-btn');
  });

  test('PhrasesTab: DnD 컨텍스트 + 드래그 핸들 도입', () => {
    expect(phraseSrc).toContain('DndContext');
    expect(phraseSrc).toContain('SortableContext');
    expect(phraseSrc).toContain('phrase-drag-handle');
    expect(phraseSrc).toContain('GripVertical');
  });

  test('PhrasesTab: sort_order 저장경로(useReorderPhrases) 유지 — DDL 0', () => {
    expect(phraseSrc).toContain('useReorderPhrases');
    expect(phraseSrc).toContain('reorder.mutate');
  });

  test('DiagnosisNamesTab: 폴더 ChevronUp/Down + ▲▼ testid 제거', () => {
    expect(diagSrc).not.toContain('ChevronUp');
    expect(diagSrc).not.toContain('ChevronDown');
    expect(diagSrc).not.toContain('dx-folder-move-up');
    expect(diagSrc).not.toContain('dx-folder-move-down');
  });

  test('DiagnosisNamesTab: 폴더 드래그 핸들 + useSortable 도입', () => {
    expect(diagSrc).toContain('dx-folder-drag-handle');
    expect(diagSrc).toContain('handleFolderReorder');
    // 형제 그룹 SortableContext (루트 + 하위)
    expect(diagSrc).toContain('SortableContext');
  });

  test('DiagnosisNamesTab: 폴더 sort_order 저장경로(updateFolder) 유지 — DDL 0', () => {
    expect(diagSrc).toContain('updateFolder.mutateAsync');
  });
});
