/**
 * E2E spec — T-20260609-foot-DRUGFOLDER-COUNT-EMPTY
 *
 * 현장(문지은 대표원장, MSG-20260609-012359-am3w 항목2):
 *   "폴더에 넣엇는데 숫자는 뜨는데 눌러보면 약이안뜸"
 *   = 약품폴더 카운트 배지(숫자)는 정상이나, 폴더를 눌러도 담긴 약 목록이 안 뜸.
 *
 * ── STEP1 read-only 그라운딩 결론 (증거 기반) ─────────────────────────────────────
 *   1. 데이터/쿼리 무결: 인증 세션 재현 결과 prescription_code_folders ⋈ prescription_codes
 *      embed 가 객체로 정상 반환(orphan 0, joinable=1). 카운트≠목록 "소스 발산" 가설은
 *      **구조적으로 불가** — 배지·목록 모두 동일 useFolderDrugs(drugsByFolder) 소스를 공유.
 *   2. 회귀원 아님: drugFolders.ts 는 RX-SET-REDESIGN 이후 무변경. PROCMENU-RX-UNIFY 는
 *      SQL backfill 만 staged(FE 무변경), RXSET-MGMT-DRUG-SEARCH 는 별도 surface.
 *   3. 진짜 근인 = 어드민 DrugFoldersTab 인터랙션 함정:
 *      펼침 화살표(chevron)는 "폴더 열기" 어포던스인데 토글만 하고 폴더를 **선택하지 않아**
 *      우측 "약 목록" 패널이 안 떴다. 약 배정은 어드민에서만 가능 → 현장이 본 화면 = 어드민.
 *   FIX(db_change=false): chevron 클릭이 토글 + setSelectedFolderId 를 함께 수행.
 *
 * 본 spec 은 (a) 카운트·목록 동일소스 불변식, (b) chevron 선택 동반, (c) 차트 트리 기본 펼침
 *   회귀를 정본 소스 정적 단언으로 가드(데이터·로그인 비의존, 레포 컨벤션 일치).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const TREE = 'src/components/doctor/DrugFolderTree.tsx';
const LIB = 'src/lib/drugFolders.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC1+AC2(FIX): 어드민 펼침 화살표 클릭 = 토글 + 폴더 선택 → 우측 약 목록이 뜬다
// ─────────────────────────────────────────────────────────────────────────────
test('FIX: 어드민 chevron 클릭이 toggleFolder 와 setSelectedFolderId 를 함께 수행', () => {
  const src = read(TAB);
  // chevron 핸들러 안에서 토글과 선택이 같이 호출되어야 함(어느 버튼을 눌러도 약 목록 노출).
  expect(src).toMatch(
    /onClick=\{\(\) => \{\s*toggleFolder\(node\.id\);\s*setSelectedFolderId\(node\.id\);\s*\}\}/,
  );
  // 폴더명 버튼은 종전대로 선택(회귀 가드).
  expect(src).toContain('onClick={() => setSelectedFolderId(node.id)}');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1: 카운트 배지와 약 목록은 동일 소스(drugsByFolder/useFolderDrugs) — 발산 불가
// ─────────────────────────────────────────────────────────────────────────────
test('AC1: 어드민 카운트 배지·우측 약 목록이 동일 drugsByFolder 소스에서 파생', () => {
  const src = read(TAB);
  // 배지: drugsByFolder.get(node.id).length
  expect(src).toContain('const folderDrugs = drugsByFolder.get(node.id) ?? []');
  expect(src).toContain('<Badge variant="secondary" className="text-[10px] h-4 px-1.5">{folderDrugs.length}</Badge>');
  // 우측 목록: 동일 drugsByFolder 에서 선택 폴더 id 로 조회
  expect(src).toContain('drugsByFolder.get(selectedFolder.id)');
  // 두 경로 모두 useFolderDrugs(drugs) 한 소스로 빌드
  expect(src).toContain('const { data: drugs = [], isLoading: drugsLoading } = useFolderDrugs()');
  expect(src).toMatch(/const drugsByFolder = new Map[\s\S]{0,160}for \(const d of drugs\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: 진료차트 DrugFolderTree 도 배지·목록이 동일소스 + 기본 펼침(약 즉시 노출)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2: 차트 트리 — 배지·목록 동일소스 + collapsed 기본 빈셋(펼침)으로 약 노출', () => {
  const tree = read(TREE);
  // 배지(folderDrugs.length)와 목록(folderDrugs.map) 모두 drugsByFolder.get(node.id) 파생
  expect(tree).toContain('const folderDrugs = drugsByFolder.get(node.id) ?? []');
  expect(tree).toContain('{folderDrugs.length}');
  expect(tree).toContain('folderDrugs.map((d)');
  // 기본 펼침: collapsed 초기값이 빈 Set → 마운트 시 약이 바로 보임(현장 "눌러보면 안뜸" 방지)
  expect(tree).toContain('useState<Set<string>>(new Set())');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: 빈 폴더 일관 표시 — 카운트 0 + "약 없음" 빈 상태(무한로딩·에러 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('AC3: 빈 폴더는 카운트 0 + 빈상태 문구로 일관 표시', () => {
  const tab = read(TAB);
  expect(tab).toContain('이 폴더에 분류된 약품이 없습니다.');
  const tree = read(TREE);
  expect(tree).toContain('빈 폴더');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4(회귀): 목록 read 쿼리 무변경 — embed 조인 + null 가드만(소스/키 불일치 없음)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4: useFolderDrugs 는 매핑 ⋈ prescription_codes embed 단일 소스 유지', () => {
  const lib = read(LIB);
  expect(lib).toContain("from('prescription_code_folders')");
  expect(lib).toContain('prescription_codes(name_ko,claim_code,classification,code_source)');
  // null 조인만 필터(미배정/소실 가드) — code_source 등 추가 필터로 약을 떨구지 않음
  expect(lib).toContain('.filter((r) => !!r.prescription_codes)');
});
