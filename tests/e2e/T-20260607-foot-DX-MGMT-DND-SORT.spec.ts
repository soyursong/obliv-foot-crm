/**
 * E2E spec — T-20260607-foot-DX-MGMT-DND-SORT
 *
 * 문지은 대표원장(6/7, C0ATE5P6JTH): 상병명 관리 순서 정렬을 "숫자 입력"에서
 *   grab handle 드래그앤드롭으로 전환. admin 전용. 기존 sort_order 컬럼 UPDATE only(신규 스키마 0).
 *
 * 부모: T-20260606-foot-DX-MGMT-OVERHAUL (deployed). 본 티켓은 정렬 입력 UX 교체.
 *
 * 본 spec 은 DnD 정렬의 구조 불변식(@dnd-kit 재사용·admin 게이트·sort_order UPDATE only·
 *   숫자입력 폐지)을 정본 그대로 인코딩해 회귀를 가드한다(데이터/로그인 비의존, 소스 정적 검증).
 *   현장 클릭 시나리오 3종(티켓 본문)을 구조 단언으로 변환.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── 리스크 #5 NO: 신규 DnD 라이브러리 도입 금지, 기존 @dnd-kit 재사용 ──
test('PKG: 신규 DnD 라이브러리 없이 기존 @dnd-kit 재사용 (Services.tsx 패턴)', () => {
  const src = read(TAB);
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).toContain("from '@dnd-kit/sortable'");
  expect(src).toContain("from '@dnd-kit/utilities'");
  expect(src).toContain('DndContext');
  expect(src).toContain('SortableContext');
  expect(src).toContain('useSortable');
  expect(src).toContain('arrayMove');
  // 신규 경쟁 라이브러리 도입 금지 가드
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('react-sortablejs');
  expect(src).not.toContain('@hello-pangea/dnd');
});

// ── AC-1: 항목/폴더 grab handle 표시 ──
test('AC-1: 항목·폴더 양쪽에 grab handle(GripVertical) — 본문 텍스트와 분리된 드래그 트리거', () => {
  const src = read(TAB);
  expect(src).toContain('GripVertical');
  expect(src).toContain('dx-item-handle');
  expect(src).toContain('dx-folder-handle');
  // grab 커서 + 태블릿 탭 오인식 방지(touch-none)
  expect(src).toContain('cursor-grab');
  expect(src).toContain('touch-none');
  // 핸들은 listeners/attributes 를 spread (드래그 트리거 한정)
  expect(src).toContain('{...attributes}');
  expect(src).toContain('{...listeners}');
});

// ── AC-2: 항목(폴더 내) + 폴더 자체 양쪽 reorder ──
test('AC-2a: 폴더 내 항목 순서 변경 핸들러', () => {
  const src = read(TAB);
  expect(src).toContain('handleItemDragEnd');
  // 항목 SortableContext 는 폴더 내부 항목 id 목록을 정렬 대상으로
  expect(src).toContain('SortableDxItem');
});

test('AC-2b: 폴더 자체 순서 변경 핸들러 + 폴더 sortable id', () => {
  const src = read(TAB);
  expect(src).toContain('handleFolderDragEnd');
  // T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX: 2패널 전환으로 SortableDxFolder → SortableFolderNode 리네임.
  //   폴더 sortable 컴포넌트는 좌측 폴더트리 노드로 보존(DnD 기능 동일).
  expect(src).toContain('SortableFolderNode');
  // 폴더 sortable id 네임스페이스 (항목 id 와 충돌 방지)
  expect(src).toContain('`folder:${folder}`');
});

test('AC-2: 드래그 중 시각 피드백(isDragging → opacity/shadow)', () => {
  const src = read(TAB);
  expect(src).toContain('isDragging');
  expect(src).toContain('shadow-md');
});

// ── AC-3: admin 전용 권한 게이트 (CRUD canEdit 보다 좁게) ──
test('AC-3: 순서 드래그는 admin 전용 — canReorder = role === admin', () => {
  const src = read(TAB);
  expect(src).toContain("DX_REORDER_ROLE = 'admin'");
  expect(src).toContain('profile?.role === DX_REORDER_ROLE');
  // non-admin → 핸들 미표시(canReorder 가드) + useSortable disabled
  expect(src).toContain('disabled: !canReorder');
  // SortableContext items 는 canReorder 일 때만 활성(비admin은 빈 배열 → 드래그 불가)
  expect(src).toMatch(/canReorder\s*\?\s*folderOrder/);
});

// ── AC-4: sort_order UPDATE only, 신규 스키마 없음, 실패 시 롤백 ──
test('AC-4: 기존 services.sort_order UPDATE only (신규 테이블/컬럼 0)', () => {
  const src = read(TAB);
  // services 테이블 sort_order 컬럼만 갱신
  expect(src).toContain(".update({ sort_order })");
  expect(src).toContain("from('services')");
  // 자동저장(드롭 즉시 applyReorder → DB update)
  expect(src).toContain('applyReorder');
  // 신규 정렬 전용 테이블 도입 금지
  expect(src).not.toContain('diagnosis_sort');
  expect(src).not.toContain('folder_order');
});

test('AC-4: 저장 실패 시 직전 순서로 롤백 + 에러 토스트', () => {
  const src = read(TAB);
  expect(src).toContain('snapshot'); // 롤백 스냅샷
  expect(src).toContain('setItems(snapshot)');
  expect(src).toContain('toast.error');
  // 변경분만 갱신(낙관적) — 미변경 행 불필요 write 방지
  expect(src).toContain('prevById.get(d.id) !== d.sort_order');
});

// ── AC-5: 기존 숫자 입력 정렬 UI 제거 ──
test('AC-5: 폼에서 "정렬 순서" 숫자 입력 제거', () => {
  const src = read(TAB);
  // 더 이상 정렬 순서 라벨/숫자 input 없음
  expect(src).not.toContain('정렬 순서');
  expect(src).not.toContain('type="number"');
  // 신규 항목은 말미로 자동 배치(숫자 입력 대체)
  expect(src).toContain('nextSortOrder');
});

// ── 보안/구조 불변식 회귀 가드 (부모 MASTER-MGMT 와 호환) ──
test('REGRESSION: 상병 정본 = services category_label=상병 SSOT 유지 (DnD 작업이 깨뜨리지 않음)', () => {
  const src = read(TAB);
  expect(src).toContain("category_label");
  expect(src).toContain("'상병'");
  expect(src).toContain('diagnosis_folder');
  expect(src).toContain('미분류');
  expect(src).not.toContain('diagnosis_categories');
  expect(src).not.toContain('clinic_diagnoses');
});
