/**
 * E2E spec — T-20260612-foot-DIAGNAMES-REORDER-FOLDER-CAPTURE
 * 상병명관리 폴더 내 항목 순서변경 시 좌측 폴더 오인식 회귀 수정 (reporter 문지은 대표원장).
 *
 * 회귀 배경: parent T-20260611-foot-DIAGNAMES-FOLDER-ITEM-REORDER(commit 6455e77) 배포 후
 *   reorderActive 모드에서 우측 항목을 수직 드래그하면 DndContext 의 closestCenter 가
 *   좌측 280px 폴더 패널을 "가장 가까운 드롭 대상"으로 판정 → over.id=폴더ID →
 *   handleDragEnd 가 폴더 배치(assign) 경로로 빠져 항목 순서변경이 안 됨.
 *
 * 수정: reorderActive 시 좌측 폴더/전체목록 droppable 을 제외하는 custom collisionDetection
 *   (dxCollisionDetection)으로 교체. 비-reorder 모드는 closestCenter 원본 그대로(회귀가드).
 *
 * 본 spec 은 foot presentation 컨벤션(parent FOLDER-ITEM-REORDER 등)을 따라 정본 소스 배선을
 * 정적 검증한다(드래그 포인터 시뮬은 dnd-kit 내부 동작 → 데이터 픽스처 불요·안정).
 *
 * AC-1 reorderActive 시 좌측 폴더/전체목록 droppable 제외 → 우측 항목끼리만 충돌판정.
 * AC-2 저장경로(services.sort_order PATCH) 불변 — handleReorder/useReorderDiagnoses 그대로.
 * AC-3 회귀가드 — 비-reorder 모드는 closestCenter 원본 동작(폴더 배치 보존).
 * AC-4 인접 인터랙션(폴더 CRUD·항목 편집) 불변 — DndContext 배선만 교체.
 * AC-5 동일 Tab 타 진행 티켓(6FIX 정렬 등) 회귀 없음.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

const DXTAB = () => SRC('components/admin/DiagnosisNamesTab.tsx');

/** 전체-라인 주석(//...) 제거 — 주석 멘션이 검사를 오염시키지 않게. */
const stripComments = (s: string): string =>
  s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — reorderActive 시 좌측 폴더/전체목록 droppable 제외
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 reorderActive 충돌판정에서 좌측 폴더 제외', () => {
  test('folderIdSet 이 ALL_KEY + 모든 폴더 id 를 droppable 제외 후보로 보유', () => {
    const src = stripComments(DXTAB());
    expect(src).toMatch(/const folderIdSet = useMemo\(/);
    // ALL_KEY(전체목록 sentinel) + folders 의 모든 폴더 id
    expect(src).toMatch(/new Set<string>\(\[ALL_KEY, \.\.\.folders\.map\(\(f\) => f\.id\)\]\)/);
  });

  test('custom collisionDetection(dxCollisionDetection)이 reorderActive 시 폴더 droppable 필터링', () => {
    const src = stripComments(DXTAB());
    const idx = src.indexOf('const dxCollisionDetection');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 700);
    // reorderActive 분기에서만 droppableContainers 를 folderIdSet 제외로 필터
    expect(block).toContain('if (reorderActive)');
    expect(block).toMatch(/droppableContainers: args\.droppableContainers\.filter\(/);
    expect(block).toMatch(/!folderIdSet\.has\(String\(c\.id\)\)/);
    expect(block).toContain('return closestCenter(filtered)');
  });

  test('DndContext 가 closestCenter 직접 대신 dxCollisionDetection 사용', () => {
    const src = stripComments(DXTAB());
    expect(src).toContain('collisionDetection={dxCollisionDetection}');
    // 전역 closestCenter 직배선은 제거됨(custom detection 내부에서만 호출)
    expect(src).not.toContain('collisionDetection={closestCenter}');
  });

  test('useCallback import 로 dxCollisionDetection 메모이즈(reorderActive·folderIdSet 의존)', () => {
    const src = DXTAB();
    expect(src).toMatch(/import \{ useCallback,/);
    const stripped = stripComments(src);
    expect(stripped).toMatch(/\[reorderActive, folderIdSet\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — 저장경로(services.sort_order PATCH) 불변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 sort_order 저장경로 불변', () => {
  test('handleReorder 의 arrayMove → idx*10 재번호 → 변경분만 PATCH 로직 그대로', () => {
    const src = stripComments(DXTAB());
    const idx = src.indexOf('function handleReorder');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 600);
    expect(block).toContain('arrayMove(visibleItems, from, to)');
    expect(block).toMatch(/sort_order: idx \* 10/);
    expect(block).toMatch(/\.filter\(\(u\) => u\.prev !== u\.sort_order\)/);
    expect(block).toContain('reorder.mutate(updates');
  });

  test('드롭 분기(handleDragEnd) — 항목 대상은 여전히 reorder 경로', () => {
    const src = stripComments(DXTAB());
    const idx = src.indexOf('function handleDragEnd');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1200);
    expect(block).toMatch(/items\.some\(\(d\) => d\.id === overKey\)/);
    expect(block).toContain('if (reorderActive) handleReorder');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 회귀가드: 비-reorder 모드는 closestCenter 원본 동작
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 비-reorder 폴더 배치 회귀가드', () => {
  test('dxCollisionDetection 이 reorderActive 아닐 때 closestCenter(args) 원본 반환', () => {
    const src = stripComments(DXTAB());
    const idx = src.indexOf('const dxCollisionDetection');
    const block = src.slice(idx, idx + 700);
    // 분기 밖(폴더 배치 모드) 기본 경로 = 원본 closestCenter
    expect(block).toMatch(/return closestCenter\(args\);/);
  });

  test('폴더 배치(assign) 동선·전체목록 분류해제 보존', () => {
    const src = DXTAB();
    expect(src).toContain('useAssignDiagnosisToFolder');
    expect(src).toContain('assign.mutate');
    expect(src).toContain('폴더 분류 해제');
    expect(src).toContain('data-reorderable="false"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — 인접 인터랙션 불변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 인접 인터랙션 불변', () => {
  test('좌측 폴더 노드 droppable·전체목록 버킷 배선 유지(폴더 트리 회귀 없음)', () => {
    const src = DXTAB();
    expect(src).toContain('useDroppable({ id: node.id })');
    expect(src).toContain('useDroppable({ id: ALL_KEY })');
    expect(src).toContain('data-testid="dx-folder-node"');
  });

  test('reorderActive 조건(폴더선택 + 추가순 asc) 그대로 — 활성 트리거 불변', () => {
    const src = DXTAB();
    expect(src).toMatch(
      /reorderActive =[\s\S]{0,200}selectedKey !== ALL_KEY && dxSortBy === 'added' && dxSortDir === 'asc'/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — 동일 Tab 타 진행 티켓 회귀 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-5 동일 Tab 회귀 없음', () => {
  test('6FIX 정렬 컨트롤(dx-sort-controls) 유지', () => {
    const src = DXTAB();
    expect(src).toContain('data-testid="dx-sort-controls"');
    expect(src).toContain('data-testid="dx-sort-by"');
    expect(src).toContain('data-testid="dx-sort-dir"');
  });

  test('SortableContext/SortableDxItem reorder 렌더 트랙 유지(parent feature 보존)', () => {
    const src = stripComments(DXTAB());
    expect(src).toContain('<SortableContext');
    expect(src).toContain('<SortableDxItem');
    expect(src).toContain('data-reorderable="true"');
  });
});
