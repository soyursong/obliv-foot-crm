/**
 * E2E spec — T-20260607-foot-FOLDER-RENAME-INLINE
 *
 * 선행: T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX(2c7808b deployed, 좌측 폴더트리 2패널)
 *   의 후속 현장 피드백 — 폴더(분류) 이름을 좌측 트리/폴더헤더에서 더블클릭·우클릭으로
 *   인라인 변경(rename)할 수 있어야 한다.
 *
 * 핵심 AC:
 *   A. 상병명 폴더트리(DiagnosisNamesTab): 더블클릭/우클릭/연필버튼 → 인라인 편집 →
 *      services.diagnosis_folder 같은 값 행 일괄 UPDATE. 빈값/중복/미분류 검증.
 *   B. 묶음처방(PrescriptionSetsTab): 동일 UX → prescription_sets.folder 일괄 UPDATE.
 *   공통: 관리 권한(canEdit) 가드 + db_change=false(기존 컬럼 UPDATE only).
 *
 * 폴더 = 별도 분류 테이블이 아니라 행에 비정규화된 문자열값 → rename = 같은 값 일괄 UPDATE.
 * 본 spec 은 rename UX 불변식(진입점·검증·일괄 UPDATE·권한·미분류 제외)을 정본 소스에
 *   정적 단언으로 인코딩해 회귀를 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DX = 'src/components/admin/DiagnosisNamesTab.tsx';
const RX = 'src/components/admin/PrescriptionSetsTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-A: 상병명 폴더트리 인라인 rename
// ─────────────────────────────────────────────────────────────────────────────
test('AC-A1: 폴더 노드 진입점 3종(더블클릭·우클릭·연필버튼)과 인라인 입력 렌더', () => {
  const src = read(DX);
  expect(src).toContain('onDoubleClick');
  expect(src).toContain('onContextMenu');
  expect(src).toContain('dx-folder-rename-btn');
  expect(src).toContain('dx-folder-rename-input');
  expect(src).toContain('dx-folder-rename-save');
  expect(src).toContain('dx-folder-rename-cancel');
});

test('AC-A2: Enter 저장 / Escape 취소 키보드 핸들', () => {
  const src = read(DX);
  expect(src).toContain("e.key === 'Enter'");
  expect(src).toContain("e.key === 'Escape'");
});

test('AC-A3: 빈값·형제중복 검증 (미분류 버킷은 rename 비대상)', () => {
  const src = read(DX);
  expect(src).toContain('폴더 이름을 입력해주세요.'); // 빈값
  expect(src).toContain('같은 위치에 같은 이름의 폴더가 이미 있어요.'); // 형제 중복
  // DXMGMT-LEFT-FOLDER-FIX: 합성 "미분류" 버킷이 "전체목록" 노드(AllItemsBucket, ALL_KEY)로 격상.
  //   여전히 실폴더 아닌 합성 노드 → rename 진입점 없음(의도 불변, 식별자만 현행화).
  expect(src).toContain('AllItemsBucket');
});

// ⚠️ DXRX-MGMT-2PANEL: 폴더 모델 TEXT → 엔티티(diagnosis_folders). rename =
//   useRenameDxFolder(같은 TEXT값 일괄 UPDATE) → useUpdateDiagnosisFolder(name 컬럼 UPDATE).
//   소속 항목 FK(services.diagnosis_folder_id)는 불변(폴더 id 그대로).
test('AC-A4: diagnosis_folders.name UPDATE (엔티티 rename, 소속 항목 FK 불변)', () => {
  const src = read(DX);
  expect(src).toContain('useUpdateDiagnosisFolder');
  expect(src).toContain('updateFolder.mutateAsync({ id: node.id, name: next })');
  // 신규 스키마/컬럼 추가가 아님 — 기존 엔티티 name UPDATE only
  expect(src).not.toMatch(/alter\s+table/i);
});

test('AC-A5: 권한 가드(canManage) + 진입점(더블클릭·우클릭·연필버튼)', () => {
  const src = read(DX);
  expect(src).toContain('canManage');
  expect(src).toContain('onDoubleClick');
  expect(src).toContain('onContextMenu');
  expect(src).toContain('dx-folder-rename-btn');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-B: 묶음처방(처방세트) 폴더 인라인 rename — AC-A와 동일 UX
// ─────────────────────────────────────────────────────────────────────────────
test('AC-B1: 폴더 헤더 진입점 3종 + 인라인 입력 렌더', () => {
  const src = read(RX);
  expect(src).toContain('onDoubleClick');
  expect(src).toContain('onContextMenu');
  expect(src).toContain('rx-set-folder-rename-btn');
  expect(src).toContain('rx-set-folder-rename-input');
  expect(src).toContain('rx-set-folder-rename-save');
  expect(src).toContain('rx-set-folder-rename-cancel');
});

test('AC-B2: Enter 저장 / Escape 취소 키보드 핸들', () => {
  const src = read(RX);
  expect(src).toContain("e.key === 'Enter'");
  expect(src).toContain("e.key === 'Escape'");
});

test('AC-B3: 빈값·중복·미분류 검증', () => {
  const src = read(RX);
  expect(src).toContain('폴더 이름을 입력해주세요.');
  expect(src).toContain('이미 있는 폴더 이름이에요.');
  expect(src).toContain("folder === NO_FOLDER");
});

test('AC-B4: prescription_sets.folder 같은 값 행 일괄 UPDATE (db_change=false)', () => {
  const src = read(RX);
  expect(src).toContain('useRenameSetFolder');
  expect(src).toContain("update({ folder: newName");
  expect(src).toContain(".eq('folder', oldName)");
  expect(src).not.toMatch(/alter\s+table/i);
});

test('AC-B5: 권한 가드(canEdit) + 미분류 제외', () => {
  const src = read(RX);
  expect(src).toContain("canEdit && g.folder !== NO_FOLDER");
});
