/**
 * E2E spec — T-20260609-foot-RXSET-FOLDER-DND
 *
 * 현장(문지은 대표원장): "폴더는 드래그로 바로 바꿀수있지 않아?"
 *   → 처방세트(묶음처방) 카드를 다른 폴더로 드래그&드롭해 귀속 폴더를 변경.
 *   (KEBAB-GUARD에서 '수정' 진입점 제거의 전제 기능 — 폴더 변경은 이제 DnD가 유일 경로)
 *
 * 변경 요지(FE only, 스키마 변경 없음):
 *   - 데이터: prescription_sets.folder(string|null) 단일 컬럼. 별도 분류테이블 없음.
 *   - 이동 = 대상 세트 row 1건의 folder 값을 대상 폴더명으로 UPDATE(.eq('id', setId)). db_change=false.
 *   - 미분류 드롭 = folder null. 같은 폴더 재드롭 = no-op.
 *   - HTML5 native draggable(onDragStart/onDragOver/onDrop) 무패키지 구현(DnD 라이브러리 미추가).
 *   - canEdit 권한 가드 유지(권한 없으면 draggable=false).
 *
 * KEBAB-GUARD 와 동일하게 정본 소스에 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RX = 'src/components/admin/PrescriptionSetsTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 이동 mutation — folder 단일 컬럼 UPDATE(.eq('id', setId)), useRenameSetFolder 동형
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1-1: useMoveSetFolder — prescription_sets.folder 를 setId 기준 단건 UPDATE', () => {
  const src = read(RX);
  expect(src).toContain('function useMoveSetFolder');
  expect(src).toContain("from('prescription_sets')");
  // setId/folder 페이로드 + id 기준 단건 갱신
  expect(src).toContain('setId: number; folder: string | null');
  expect(src).toContain('.eq(\'id\', setId)');
  // 기존 컬럼 UPDATE only — insert/delete/별도 테이블 없음
  expect(src).toContain('.update({ folder');
});

test('AC-1-2: invalidate + 성공/실패 토스트(useRenameSetFolder 동형)', () => {
  const src = read(RX);
  expect(src).toContain("queryKey: ['prescription_sets']");
  expect(src).toContain('폴더를 옮겼어요.');
  expect(src).toContain('폴더 이동 실패');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 카드 draggable + canEdit 권한 가드
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2-1: 세트 카드 draggable={canEdit} — 권한 없으면 드래그 비활성', () => {
  const src = read(RX);
  expect(src).toContain('draggable={canEdit}');
  // 드래그 시작 시 canEdit 가드 + setId 전달
  expect(src).toContain('function handleSetDragStart');
  expect(src).toContain('if (!canEdit) return;');
  expect(src).toContain("e.dataTransfer.setData('text/plain', String(s.id))");
});

test('AC-2-2: 드래그 중 시각 피드백 — 카드 opacity + grab 커서', () => {
  const src = read(RX);
  expect(src).toContain('draggingSetId === s.id ? \'opacity-50\' : \'\'');
  expect(src).toContain('cursor-grab active:cursor-grabbing');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 폴더 그룹 = 드롭존. 미분류 드롭=null, 같은 폴더 재드롭=no-op
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3-1: 폴더 그룹에 onDragOver(preventDefault)·onDrop 부착 + 하이라이트', () => {
  const src = read(RX);
  expect(src).toContain('onDragOver={(e) => {');
  expect(src).toContain('e.preventDefault(); // 드롭 허용');
  expect(src).toContain('handleDropToFolder(g.folder)');
  // 드래그 오버 ring 하이라이트
  expect(src).toContain('ring-2 ring-teal-400');
});

test('AC-3-2: handleDropToFolder — 미분류(NO_FOLDER) 드롭=null, 같은 폴더 재드롭=no-op', () => {
  const src = read(RX);
  expect(src).toContain('function handleDropToFolder');
  // 현재 폴더키 == 대상 폴더키 → no-op
  expect(src).toContain('if (currentKey === targetFolderKey) return;');
  // NO_FOLDER → folder null, 그 외 폴더명 그대로
  expect(src).toContain("folder: targetFolderKey === NO_FOLDER ? null : targetFolderKey");
  // canEdit 가드
  expect(src).toContain('if (!canEdit || setId == null) return;');
});

test('AC-3-3: 미분류 그룹 부재 시 드래그 중 폴더해제(null) 드롭존 보장', () => {
  const src = read(RX);
  expect(src).toContain('rx-set-unfiled-dropzone');
  // 드래그 중 + 미분류 그룹이 없을 때만 노출
  expect(src).toContain('draggingSetId != null && !grouped.some((g) => g.folder === NO_FOLDER)');
  expect(src).toContain('handleDropToFolder(NO_FOLDER)');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 회귀 없음 — 폴더명 변경(RENAME-INLINE)·삭제(KEBAB-GUARD)·DnD 라이브러리 미추가
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4-1: 폴더명 인라인 변경(useRenameSetFolder) 동선 보존', () => {
  const src = read(RX);
  expect(src).toContain('function useRenameSetFolder');
  expect(src).toContain('function submitRenameFolder');
});

test('AC-4-2: 케밥 삭제 가드(KEBAB-GUARD) 무영향', () => {
  const src = read(RX);
  expect(src).toContain('function RxSetKebabMenu');
  expect(src).toContain('rx-set-delete-dialog');
});

test('AC-4-3: 이 화면은 DnD 라이브러리 미사용 — HTML5 native draggable only', () => {
  // 주: @dnd-kit/* 는 앱 다른 화면용으로 package.json 에 이미 존재. 본 기능은 그것을 import 하지 않음.
  const src = read(RX);
  expect(src).not.toMatch(/@dnd-kit/);
  expect(src).not.toMatch(/react-dnd/);
  // 네이티브 DnD 핸들러로 구현됐음을 확정
  expect(src).toContain('onDragStart');
  expect(src).toContain('e.dataTransfer');
});

test('GUARD: 스키마 변경(ALTER TABLE) 없음 — 순수 FE', () => {
  expect(read(RX)).not.toMatch(/alter\s+table/i);
});
