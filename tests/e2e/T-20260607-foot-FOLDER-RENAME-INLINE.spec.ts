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

test('AC-A3: 빈값·중복·미분류 검증', () => {
  const src = read(DX);
  expect(src).toContain('폴더 이름을 입력해주세요.'); // 빈값
  expect(src).toContain('이미 있는 폴더 이름이에요.'); // 중복
  // 미분류(합성 폴더)는 변경 불가
  expect(src).toContain("folder === NO_FOLDER");
});

test('AC-A4: services.diagnosis_folder 같은 값 행 일괄 UPDATE (db_change=false)', () => {
  const src = read(DX);
  expect(src).toContain('useRenameDxFolder');
  expect(src).toContain("update({ diagnosis_folder: newName })");
  expect(src).toContain(".eq('diagnosis_folder', oldName)");
  expect(src).toContain(".eq('category_label', '상병')");
  // 신규 스키마/컬럼 추가가 아님 — 기존 컬럼 UPDATE only
  expect(src).not.toMatch(/alter\s+table/i);
});

test('AC-A5: 권한 가드(canEdit) + 변경 후 선택 폴더 유지', () => {
  const src = read(DX);
  expect(src).toContain('canRename={canEdit && folder !== NO_FOLDER}');
  expect(src).toContain('setSelectedFolder(next)');
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
