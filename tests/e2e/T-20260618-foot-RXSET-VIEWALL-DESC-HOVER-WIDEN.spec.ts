/**
 * E2E spec — T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH, MSG-20260618-122437-u11p):
 *   "전체보기에서 우측 칸 남으니 너비 늘려(B) / 소속폴더 옆 '설명' 칸 만들어 텍스트 입력(C, 더블클릭) /
 *    진료차트 처방약 선택에서 약 hover 하면 약정보 라운드박스 툴팁(D) / 처방리스트 약 hover 도(E)."
 *   ※ A(싫은 아이콘)는 첨부 image.png 식별 불가 → AC-5 '추정 제거 금지' 적용, reporter 확인 대기(본 spec 비범위).
 *
 * Part C 설명 = D/E 툴팁의 SSOT(prescription_codes.description, ADDITIVE nullable text).
 *
 * Surface 확정:
 *   - src/components/admin/DrugFoldersTab.tsx        (Part B 너비 / Part C 설명 컬럼·인라인 에디터)
 *   - src/components/doctor/DrugInfoTooltip.tsx      (Part D/E 공용 라운드박스 hover 툴팁 — 신규)
 *   - src/components/doctor/DrugFolderTree.tsx       (Part D 처방약 선택 패널 hover)
 *   - src/components/MedicalChartPanel.tsx           (Part E 처방내역 약 hover)
 *   - src/lib/drugFolders.ts                         (description 노출 + useUpdateDrugDescription + useDrugDescriptions)
 *   - supabase/migrations/20260618130000_prescription_codes_description.sql (ADDITIVE 컬럼)
 *
 * 형제 RXSET-VIEWALL / INSURANCE-INLINE spec 동형 — 정본 소스 정적 단언(데이터/로그인 비의존)으로 불변식 인코딩.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const TOOLTIP = 'src/components/doctor/DrugInfoTooltip.tsx';
const TREE = 'src/components/doctor/DrugFolderTree.tsx';
const CHART = 'src/components/MedicalChartPanel.tsx';
const LIB = 'src/lib/drugFolders.ts';
const MIG = 'supabase/migrations/20260618130000_prescription_codes_description.sql';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: Part B — 전체보기 테이블 우측 여백 활용(컬럼 너비 확대)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1(Part B): 전체보기 테이블이 table-fixed + colgroup 으로 가용 폭을 채움', () => {
  const src = read(TAB);
  // 우측 빈 여백 최소화 — table-fixed + colgroup 폭 배분(약이름/설명이 가용 폭 흡수)
  expect(src).toContain('drug-folder-viewall-table');
  expect(src).toMatch(/table-fixed/);
  expect(src).toContain('<colgroup>');
  // 급여여부/소속폴더는 고정 narrow, 약이름·설명은 flex(가용 폭). 헤더 컬럼 5종 유지(회귀 0).
  expect(src).toContain('drug-folder-viewall-select-all');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: Part C — 소속 폴더 옆 '설명' 컬럼 + 더블클릭 인라인 에디터
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2(Part C): 소속 폴더 옆 "설명" 컬럼(헤더 + 셀) 신설', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-viewall-desc-head');
  expect(src).toContain('drug-folder-viewall-desc-cell');
  expect(src).toContain('설명');
});

test('AC-2(Part C): 설명 셀 더블클릭 → 인라인 입력 에디터(Enter 저장 / Esc 취소)', () => {
  const src = read(TAB);
  // 더블클릭 트리거 + 인라인 입력 컴포넌트 + 저장/취소
  expect(src).toContain('drug-folder-viewall-desc-trigger');
  expect(src).toContain('onDoubleClick');
  expect(src).toContain('drug-folder-viewall-desc-input');
  expect(src).toContain('drug-folder-viewall-desc-save');
  expect(src).toContain('drug-folder-viewall-desc-cancel');
  // Enter 저장 / Escape 취소 키 핸들링
  expect(src).toMatch(/e\.key === 'Enter'/);
  expect(src).toMatch(/e\.key === 'Escape'/);
  // 저장 위임 = useUpdateDrugDescription (자체 분기 0)
  expect(src).toContain('useUpdateDrugDescription');
  expect(src).toContain('updateDesc.mutateAsync');
});

test('AC-2(Part C): 편집은 canEdit(admin/manager) 게이트 — 권한 없으면 읽기 표시만', () => {
  const src = read(TAB);
  // 편집 트리거는 canEdit 분기 안. 비권한자는 텍스트(또는 '—') 표시.
  expect(src).toContain('startEditDesc');
  expect(src).toMatch(/if \(!canEdit\) return;/);
});

test('lib: useUpdateDrugDescription — description UPDATE + 캐시 무효화', () => {
  const lib = read(LIB);
  expect(lib).toContain('useUpdateDrugDescription');
  expect(lib).toMatch(/\.from\('prescription_codes'\)/);
  expect(lib).toMatch(/\.update\(\{ description:/);
  // 저장 후 전체보기/툴팁 소스 캐시 무효화
  expect(lib).toContain("invalidateQueries({ queryKey: ['prescription_code_folders'] })");
  // 빈 문자열 → NULL 정규화(빈 설명 허용)
  expect(lib).toMatch(/trim\(\) === ''/);
});

test('lib: useFolderDrugs 가 description 노출(전체보기 셀 + 툴팁 SSOT)', () => {
  const lib = read(LIB);
  // select 절 + FolderDrug 타입에 description 포함
  expect(lib).toMatch(/prescription_codes\([^)]*description[^)]*\)/);
  expect(lib).toContain('description: string | null');
  // deploy-tolerant: 컬럼 미적용 DB 대비 ?? null 폴백
  expect(lib).toContain('description ?? null');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: Part D/E — 약 hover 라운드박스 툴팁(공용 컴포넌트)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3/AC-4(공용): DrugInfoTooltip — 라운드박스 + 클릭 비방해(pointer-events:none) + 포털', () => {
  expect(existsSync(join(ROOT, TOOLTIP))).toBe(true);
  const tip = read(TOOLTIP);
  // 라운드 사각 박스 + 그림자(미니멀하되 잘 보이게)
  expect(tip).toMatch(/rounded-lg/);
  expect(tip).toContain('shadow-lg');
  // 클릭/선택 동선 방해 X
  expect(tip).toContain('pointer-events-none');
  // 표/스크롤 컨테이너 클리핑 회피 — createPortal + position:fixed
  expect(tip).toContain('createPortal');
  expect(tip).toMatch(/position: 'fixed'/);
  // hover 진입/이탈 → 표시/소멸
  expect(tip).toContain('onMouseEnter');
  expect(tip).toContain('onMouseLeave');
  // 약 정보 = 약 이름(헤더) + 설명. 설명 없어도 깨지지 않음(AC-5 엣지: 빈 설명 안내).
  expect(tip).toContain('description');
  expect(tip).toContain('등록된 설명 없음');
});

test('AC-3(Part D): 진료차트 처방약 선택 패널(DrugFolderTree) 약 hover 시 툴팁', () => {
  const tree = read(TREE);
  expect(tree).toContain("import DrugInfoTooltip from '@/components/doctor/DrugInfoTooltip'");
  expect(tree).toContain('<DrugInfoTooltip');
  // 설명 SSOT = FolderDrug.description (Part C 입력값)
  expect(tree).toMatch(/description=\{d\.description\}/);
  // 클릭(즉시삽입) 동선 보존 — addOne 트리거 유지
  expect(tree).toContain('drug-folder-item-add');
  expect(tree).toContain('addOne(d)');
});

test('AC-4(Part E): 진료차트 처방내역(MedicalChartPanel) 약 hover 시 동일 툴팁', () => {
  const chart = read(CHART);
  expect(chart).toContain("import DrugInfoTooltip from '@/components/doctor/DrugInfoTooltip'");
  expect(chart).toContain('<DrugInfoTooltip');
  // 처방내역 약은 code_id 만 보유 → useDrugDescriptions 로 설명 lookup
  expect(chart).toContain('useDrugDescriptions');
  expect(chart).toMatch(/rxDescMap\?\.get\(item\.prescription_code_id\)/);
  // 약 이름 표시(회귀 0) — rx-name 데이터 식별자 보존
  expect(chart).toMatch(/data-testid=\{`rx-name-\$\{idx\}`\}/);
});

test('lib: useDrugDescriptions — code_id→description 맵(읽기전용) + 컬럼부재 폴백', () => {
  const lib = read(LIB);
  expect(lib).toContain('useDrugDescriptions');
  expect(lib).toMatch(/\.select\('id,description'\)/);
  expect(lib).toMatch(/\.in\('id', ids\)/);
  // deploy-tolerant: select 에러(컬럼 부재) → 빈 맵 폴백(툴팁 약정보만, 깨짐 없음)
  expect(lib).toContain('return new Map()');
});

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 계약: Part C 설명 컬럼 = ADDITIVE nullable text (회귀 0 / 롤백 SQL 동반)
// ─────────────────────────────────────────────────────────────────────────────
test('DB: prescription_codes.description ADDITIVE nullable text 마이그(IF NOT EXISTS)', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  const mig = read(MIG);
  expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS description TEXT/);
  // 롤백 SQL 동반
  expect(existsSync(join(ROOT, 'supabase/migrations/20260618130000_prescription_codes_description.rollback.sql'))).toBe(true);
});
