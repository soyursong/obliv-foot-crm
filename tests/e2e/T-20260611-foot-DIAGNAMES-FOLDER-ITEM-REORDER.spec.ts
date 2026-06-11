/**
 * E2E spec — T-20260611-foot-DIAGNAMES-FOLDER-ITEM-REORDER
 * 상병명관리 폴더 내 항목 드래그 순서변경 (reporter 문지은 대표원장).
 *
 * 본 spec 은 foot presentation 컨벤션(DOCDASH-DIAGMGMT-6FIX 등)을 따라
 * **정본 소스 배선(testid·dnd wiring·sort_order 영속 로직)** 을 직접 검증한다.
 * 드래그 그 자체(포인터 시뮬)는 dnd-kit 내부 동작이라, 여기서는 reorder 가
 * 정확한 정본 앵커(useSortable/SortableContext/arrayMove·재번호·옵티미스틱 PATCH)에
 * 배선됐는지를 회귀로 잡는다(데이터 픽스처 불요·안정).
 *
 * AC-1 폴더 내 드래그 위/아래 이동 — useSortable + SortableContext(verticalListSortingStrategy).
 * AC-2 sort_order PATCH 영속 — 기존 services.sort_order 컬럼 재사용(신규 컬럼 없음). DB 무변경.
 * AC-3 폴더별 독립 — 현재 폴더 가시항목만 0,10,20… 재번호(타 폴더 sort_order 불변).
 * AC-4 6FIX 전체목록 정렬옵션과 공존(별 트랙) — 전체목록/가나다/내림차순은 reorder 비활성, 폴더 배치 드래그만.
 * AC-5 기존행 NULL fallback — (sort_order ?? 0) 정렬 + 재번호로 NULL/중복 정규화.
 * AC-6 회귀가드 — 폴더 배치 드래그(useAssignDiagnosisToFolder) 동선 보존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

const DXTAB = () => SRC('components/admin/DiagnosisNamesTab.tsx');
const DXFOLDERS = () => SRC('lib/diagnosisFolders.ts');

/** 전체-라인 주석(//...) 제거 — 주석 멘션이 검사를 오염시키지 않게. */
const stripComments = (s: string): string =>
  s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 폴더 내 드래그 순서변경(useSortable + SortableContext)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 폴더 내 드래그 순서변경', () => {
  test('@dnd-kit/sortable 재사용 — SortableContext/useSortable/verticalListSortingStrategy/arrayMove import', () => {
    const src = DXTAB();
    expect(src).toContain("from '@dnd-kit/sortable'");
    expect(src).toContain('SortableContext');
    expect(src).toContain('useSortable');
    expect(src).toContain('verticalListSortingStrategy');
    expect(src).toContain('arrayMove');
  });

  test('순서변경 활성 시 SortableContext + SortableDxItem 으로 우측 리스트 렌더', () => {
    const src = stripComments(DXTAB());
    expect(src).toContain('<SortableContext');
    expect(src).toMatch(/items=\{visibleItems\.map\(\(d\) => d\.id\)\}/);
    expect(src).toContain('strategy={verticalListSortingStrategy}');
    expect(src).toContain('<SortableDxItem');
    expect(src).toContain('data-reorderable="true"');
  });

  test('SortableDxItem 이 useSortable 의 transform/transition 을 적용(드래그 미리보기)', () => {
    const src = DXTAB();
    expect(src).toMatch(/function SortableDxItem/);
    expect(src).toMatch(/useSortable\(\{[\s\S]{0,80}id: d\.id/);
    expect(src).toContain('CSS.Transform.toString(transform)');
  });

  test('순서변경 안내 문구 노출(손잡이로 위/아래)', () => {
    const src = DXTAB();
    expect(src).toContain('data-testid="dx-reorder-hint"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — sort_order PATCH 영속(기존 컬럼 재사용, DB 무변경)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 sort_order PATCH 영속', () => {
  test('useReorderDiagnoses 가 services.sort_order 를 직접 UPDATE(기존 컬럼 재사용)', () => {
    const src = DXFOLDERS();
    expect(src).toContain('export function useReorderDiagnoses');
    expect(src).toMatch(/\.from\('services'\)\s*\.update\(\{ sort_order: u\.sort_order \}\)/);
    expect(src).toContain(".eq('id', u.id)");
  });

  test('행마다 값이 달라 Promise.all 행별 PATCH + 첫 에러 throw', () => {
    const src = DXFOLDERS();
    expect(src).toContain('Promise.all');
    expect(src).toMatch(/results\.find\(\(r\) => r\.error\)/);
    expect(src).toMatch(/if \(failed\?\.error\) throw failed\.error/);
  });

  test('옵티미스틱 업데이트 — onMutate 캐시 즉시 갱신 + onError 롤백 + onSettled invalidate', () => {
    const src = DXFOLDERS();
    expect(src).toMatch(/onMutate: async \(updates\)/);
    expect(src).toContain("qc.cancelQueries({ queryKey: key })");
    expect(src).toMatch(/qc\.setQueryData<DxRow\[\]>/);
    expect(src).toMatch(/onError: \([\s\S]{0,40}ctx\) =>/);
    expect(src).toMatch(/if \(ctx\?\.prev\) qc\.setQueryData/);
    expect(src).toMatch(/onSettled: \(\) => qc\.invalidateQueries\(\{ queryKey: \['diagnosis_master'\] \}\)/);
  });

  test('컴포넌트가 변경된 항목만 PATCH(미변경 필터)', () => {
    const src = stripComments(DXTAB());
    expect(src).toContain('function handleReorder');
    expect(src).toMatch(/arrayMove\(visibleItems, from, to\)/);
    expect(src).toMatch(/sort_order: idx \* 10/);
    expect(src).toMatch(/\.filter\(\(u\) => u\.prev !== u\.sort_order\)/); // 미변경 제외
    expect(src).toMatch(/if \(updates\.length === 0\) return/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 폴더별 독립(현재 폴더 항목만 재번호)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 폴더별 독립', () => {
  test('재번호 대상 = visibleItems(선택 폴더 가시항목)뿐 → 타 폴더 sort_order 불변', () => {
    const src = stripComments(DXTAB());
    // handleReorder 가 items 전체가 아닌 visibleItems(폴더 스코프)만 정렬·재번호
    const idx = src.indexOf('function handleReorder');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 600);
    expect(block).toContain('visibleItems.map((d) => d.id)');
    expect(block).toContain('arrayMove(visibleItems, from, to)');
    // 전체 items 를 재번호하지 않음(폴더 독립 보장)
    expect(block).not.toMatch(/arrayMove\(items,/);
  });

  test('순서변경은 특정 폴더 선택 시에만 활성(reorderActive 조건)', () => {
    const src = DXTAB();
    expect(src).toMatch(/const reorderActive =[\s\S]{0,160}selectedKey !== ALL_KEY/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — 6FIX 전체목록 정렬옵션과 공존(별 트랙)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 6FIX 정렬옵션과 공존', () => {
  test('reorder 는 추가순 오름차순(=정본 순서)에서만 활성 — 가나다/내림차순/전체목록 비활성', () => {
    const src = DXTAB();
    expect(src).toMatch(
      /reorderActive =[\s\S]{0,200}dxSortBy === 'added' && dxSortDir === 'asc'/,
    );
  });

  test('비활성 분기는 기존 DraggableDxItem(폴더 배치 전용) 유지 + data-reorderable="false"', () => {
    const src = stripComments(DXTAB());
    expect(src).toContain('<DraggableDxItem');
    expect(src).toContain('data-reorderable="false"');
    // 비활성 안내(추가순으로 두라는 힌트)
    expect(src).toContain('data-testid="dx-reorder-hint-disabled"');
  });

  test('6FIX 정렬 컨트롤(dx-sort-controls)은 그대로 유지(회귀 없음)', () => {
    const src = DXTAB();
    expect(src).toContain('data-testid="dx-sort-controls"');
    expect(src).toContain('data-testid="dx-sort-by"');
    expect(src).toContain('data-testid="dx-sort-dir"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — 기존행 NULL fallback
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-5 NULL fallback', () => {
  test('정렬·재번호가 (sort_order ?? 0) 로 NULL 안전', () => {
    const src = stripComments(DXTAB());
    // visibleItems 정렬 프록시
    expect(src).toMatch(/a\.sort_order \?\? 0\) - \(b\.sort_order \?\? 0\)/);
    // handleReorder 의 prev 비교도 ?? null 로 NULL 안전
    expect(src).toMatch(/prev: d\.sort_order \?\? null/);
  });

  test('useReorderDiagnoses DxRow 타입이 sort_order: number | null 허용', () => {
    const src = DXFOLDERS();
    expect(src).toMatch(/sort_order: number \| null/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6 — 회귀가드: 폴더 배치 드래그 동선 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-6 폴더 배치 드래그 회귀가드', () => {
  test('handleDragEnd 가 드롭 대상(항목 vs 폴더/전체목록)을 분기 처리', () => {
    const src = stripComments(DXTAB());
    const idx = src.indexOf('function handleDragEnd');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1200);
    // 항목 대상 → reorder
    expect(block).toMatch(/items\.some\(\(d\) => d\.id === overKey\)/);
    expect(block).toContain('if (reorderActive) handleReorder');
    // 폴더/전체목록 대상 → 기존 배치(assign)
    expect(block).toContain('assign.mutate');
    expect(block).toMatch(/targetFolderId = overKey === ALL_KEY \? null : overKey/);
  });

  test('폴더 배치 훅(useAssignDiagnosisToFolder)·전체목록 드롭 분류해제 동선 그대로', () => {
    const src = DXTAB();
    expect(src).toContain('useAssignDiagnosisToFolder');
    expect(src).toContain('폴더 분류 해제'); // 전체목록 드롭 = 미분류 환원 메시지 보존
  });

  test('DragOverlay 시각 피드백 유지(activeDx)', () => {
    const src = DXTAB();
    expect(src).toContain('<DragOverlay>');
    expect(src).toContain('activeDx');
  });
});
