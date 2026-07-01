/**
 * E2E spec — T-20260607-foot-DX-MGMT-DND-SORT  (SUPERSEDED by DXRX-MGMT-2PANEL)
 *
 * 원 의도: 상병명 관리에서 폴더 내 항목 순서를 grab handle DnD 로 reorder(admin 전용).
 *
 * ⚠️ 대체됨 — T-20260607-foot-DXRX-MGMT-2PANEL(2패널 개편)이 DiagnosisNamesTab 의
 *   상호작용을 재정의했다. 항목 드래그는 이제 "폴더 내 순서 변경"이 아니라 "왼쪽 폴더로 배치(이동)"
 *   (services.diagnosis_folder_id FK 갱신)다. 폴더 = TEXT 문자열이 아니라 diagnosis_folders 엔티티이며,
 *   폴더 순서는 ▲▼ 버튼(형제 sort_order 교체)으로 조정한다.
 *   → 본 spec 은 "DnD 기반 + 신규 라이브러리 미도입 + 관리권한 게이트" 라는 보존 가능한 불변식만
 *     새 설계 기준으로 가드한다. 항목 reorder 단언은 폐기(2PANEL spec 이 정본).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── 보존 불변식: 신규 DnD 라이브러리 미도입, 기존 @dnd-kit 재사용 ──
test('PKG: 신규 DnD 라이브러리 없이 기존 @dnd-kit 재사용', () => {
  const src = read(TAB);
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).toContain('DndContext');
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('react-sortablejs');
  expect(src).not.toContain('@hello-pangea/dnd');
});

// ── 보존 불변식: 항목 grab handle = 본문과 분리된 드래그 트리거 ──
test('항목 grab handle(GripVertical) — 드래그 트리거 분리', () => {
  const src = read(TAB);
  expect(src).toContain('GripVertical');
  expect(src).toContain('dx-item-handle');
  expect(src).toContain('cursor-grab');
  expect(src).toContain('touch-none');
  expect(src).toContain('{...attributes}');
  expect(src).toContain('{...listeners}');
});

// ── 재정의: 항목 드래그 = 폴더로 배치(이동), reorder 아님 ──
test('항목 드래그 = 좌측 폴더 배치(useAssignDiagnosisToFolder)', () => {
  const src = read(TAB);
  expect(src).toContain('handleDragEnd');
  expect(src).toContain('useAssignDiagnosisToFolder');
  expect(src).toContain('useDraggable');
  expect(src).toContain('useDroppable');
});

// ── 보존: 드래그 중 시각 피드백 ──
test('드래그 중 시각 피드백(isDragging → opacity, DragOverlay)', () => {
  const src = read(TAB);
  expect(src).toContain('isDragging');
  expect(src).toContain('DragOverlay');
});

// ── 재정의: 폴더 순서 = 드래그(형제 sort_order 재번호) ──
//   T-20260701-foot-REORDER-ARROW-TO-DRAG: ▲▼ 버튼 → GripVertical 잡아끌기로 교체(형제 레벨만).
test('폴더 순서 조정 = 드래그 핸들(형제 sort_order 재번호)', () => {
  const src = read(TAB);
  expect(src).toContain('handleFolderReorder');
  expect(src).toContain('dx-folder-drag-handle');
  expect(src).not.toContain('dx-folder-move-up');
  expect(src).not.toContain('dx-folder-move-down');
});

// ── 보존: 관리권한 게이트 ──
test('배치·폴더관리는 관리권한 전용(canManage)', () => {
  const src = read(TAB);
  expect(src).toContain('canManage');
  expect(src).toContain('disabled: !canManage');
  expect(src).toContain('if (!over || !canManage) return');
});

// ── 보존: 폼에 정렬 숫자 입력 없음 ──
test('폼에 "정렬 순서" 숫자 입력 없음 — 신규는 말미 자동 배치', () => {
  const src = read(TAB);
  expect(src).not.toContain('정렬 순서');
  expect(src).not.toContain('type="number"');
  expect(src).toContain('nextSortOrder');
});

// ── 회귀: 상병 정본 SSOT 유지 ──
test('REGRESSION: 상병 정본 = services category_label=상병 SSOT', () => {
  const src = read(TAB);
  expect(src).toContain('category_label');
  expect(src).toContain("'상병'");
  expect(src).toContain('미분류');
  expect(src).not.toContain('diagnosis_categories');
  expect(src).not.toContain('clinic_diagnoses');
});
