/**
 * E2E spec — T-20260607-foot-DXRX-FOLDER-RENAME
 *
 * 현장(문지은 대표원장): "상병명·묶음처방(처방세트) 폴더 관리가 안됨 — 이름 바꿀 수 있게."
 *   핵심 gap = 폴더 생성 후 rename 불가.
 *
 * 본 티켓 범위(planner 가이드):
 *   - 선행(즉시): 약품폴더 prescription_folders(DrugFoldersTab) 인라인 rename.
 *     · 직전 FOLDER-RENAME-INLINE 은 상병명(services.diagnosis_folder)·묶음처방
 *       (prescription_sets.folder) TEXT 모델만 처리 → 약품폴더(prescription_folders 엔티티)는
 *       window.prompt 방식이라 형제 탭과 UX 불일치. 인라인 편집으로 통일.
 *   - 상병명 diagnosis_folders 엔티티 rename → 2PANEL 3-A 마이그 통과 후(2PANEL AC3 흡수).
 *   - 처방세트 TEXT rename → DXTOOL Stage C 이관 후 약품폴더 rename 으로 흡수(별도 구현 금지).
 *
 * AC: 폴더 인라인/연필 "이름 변경" · 빈이름 차단 · 같은위치 중복 차단 ·
 *     소속 약품 FK 유지(name UPDATE only, 이동·소실 없음) · admin 전용.
 *
 * 폴더 = prescription_folders 엔티티(별도 테이블). rename = name 컬럼만 UPDATE(db_change=false).
 *   소속 약품은 prescription_code_folders 매핑이 folder_id 로 묶여 있어 불변.
 * 본 spec 은 rename UX 불변식을 정본 소스에 정적 단언으로 인코딩해 회귀를 가드(데이터·로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const LIB = 'src/lib/drugFolders.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC1: 인라인 rename 진입점 — 더블클릭 + 연필버튼
// ─────────────────────────────────────────────────────────────────────────────
test('AC1: 폴더 노드 진입점(더블클릭·연필버튼)과 인라인 입력/저장/취소 렌더', () => {
  const src = read(TAB);
  expect(src).toContain('onDoubleClick={() => startRename(node)}');
  expect(src).toContain('data-testid="drug-folder-rename-start"');
  expect(src).toContain('data-testid="drug-folder-rename-input"');
  expect(src).toContain('data-testid="drug-folder-rename-save"');
  expect(src).toContain('data-testid="drug-folder-rename-cancel"');
  expect(src).toContain('data-testid="drug-folder-admin-node-editing"');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: 키보드 UX — Enter 저장 / Esc 취소 (형제 탭과 동일)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2: Enter 저장 / Escape 취소 키 핸들링', () => {
  const src = read(TAB);
  expect(src).toContain("if (e.key === 'Enter')");
  expect(src).toContain('void submitRename(node)');
  expect(src).toContain("else if (e.key === 'Escape')");
  expect(src).toContain('cancelRename()');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: 빈이름 차단 + 같은 위치 동일이름(중복) 차단
// ─────────────────────────────────────────────────────────────────────────────
test('AC3: 빈이름 차단 · 형제 중복이름 차단', () => {
  const src = read(TAB);
  // 빈값 가드
  expect(src).toMatch(/if \(!next\) return toast\.error/);
  // 같은 부모(parent_id) 아래 동일 trim 이름 차단
  expect(src).toContain('f.parent_id === node.parent_id');
  expect(src).toContain('f.name.trim() === next');
  expect(src).toMatch(/if \(dup\) return toast\.error/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: 소속 약품 FK 유지 — name 컬럼만 UPDATE (이동·소실 없음, db_change=false)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4: rename 은 prescription_folders.name 만 UPDATE — 매핑 테이블 미변경', () => {
  const tab = read(TAB);
  const lib = read(LIB);
  // 호출부: updateFolder({ id, name }) 만 사용(parent_id/sort_order 변경 없음)
  expect(tab).toContain('await updateFolder.mutateAsync({ id: node.id, name: next })');
  // useUpdateFolder 는 prescription_folders 만 건드림. 매핑(prescription_code_folders)은 무관.
  expect(lib).toContain(".from('prescription_folders').update(patch)");
  expect(lib).not.toMatch(/update\([^)]*\)[\s\S]{0,80}prescription_code_folders/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5: admin 전용 — canEdit 가드 (director/manager/admin)
// ─────────────────────────────────────────────────────────────────────────────
test('AC5: rename 진입은 canEdit 권한 가드 하위', () => {
  const src = read(TAB);
  // startRename 자체가 canEdit 가드
  expect(src).toMatch(/function startRename[\s\S]{0,60}if \(!canEdit\) return/);
  // 연필버튼/액션 블록은 canEdit 조건 렌더
  expect(src).toContain("const FOLDER_MANAGE_ROLES = ['director', 'manager', 'admin']");
  expect(src).toContain('{canEdit && (');
});
