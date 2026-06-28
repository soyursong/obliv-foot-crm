/**
 * E2E spec — T-20260617-foot-RXSET-VIEWALL-TABLE-MIGCLEAR (Part A + Part B)
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH):
 *   "처방세트 오른쪽에 선택한 폴더 약이 보이잖아. 그 전에 전체보기 가능하게 (폴더 선택 위에).
 *    전체보기는 약별로 테이블뷰로 체크박스로 여러개 삭제 가능하게."
 *   스펙확정(krhg, MSG-20260617-122627 / INFO MSG-20260617-123347-hpfq):
 *     - 서브탭 방식 [폴더 선택]/[전체보기] 별도 분리(인라인 토글 X).
 *     - 전체보기 컬럼(§0.5 reporter 직접 정정 MSG-xi5h 14:09): 체크박스 / 약 이름(용량)=name_ko / 소속 폴더 (3컬럼).
 *       ※ '약 이름(용량)'=name_ko 단일 데이터(예 '어쩌구 10mg'), 용량 별도 컬럼 X. '기타 처방정보' 컬럼 reporter 미언급 → 제거.
 *     - 일괄 삭제 = 기존 단건 삭제 로직(useUnassignDrug=분류 해제) + 확인 팝업 재사용(신규 삭제 경로 X).
 *     - 검증(verify): MIGCLEAR 는 '검증 버튼 UI surface'(이관약 행에만 이관 태그 + 검증 버튼 노출)까지만.
 *       검증 action 의 의미·DML(code_type 승격 UPDATE)은 MIGCLEAR 범위 아님 — CORRECTION 으로
 *       T-20260617-foot-RX-VALID-TAG-REMOVE 정본 경로 단일 구현으로 이관(MIGCLEAR 에서 code_type UPDATE 금지).
 *
 * Surface 확정(§0.4 코드그라운딩): src/components/admin/DrugFoldersTab.tsx + src/lib/drugFolders.ts
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존) — 형제 RXSET spec 동형.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const LIB = 'src/lib/drugFolders.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 / AC: Part A — [폴더 선택]/[전체보기] 별도 서브탭(인라인 토글 X), 기본 폴더
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 패널 상단 서브탭 2개([폴더 선택]/[전체보기]) 신설, 기본값 folder', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-subtabs');
  expect(src).toContain('drug-folder-subtab-folder');
  expect(src).toContain('drug-folder-subtab-all');
  expect(src).toContain('폴더 선택');
  expect(src).toContain('전체보기');
  // 서브탭 상태 + 기본값 folder
  //   T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY: '묶음처방' 서브탭 적층으로 union 이 additive 확장됨
  //   ('folder' | 'all' → 'folder' | 'all' | 'bundle'). 기본값 'folder'(기존 동작 보존)·기존 멤버는 불변.
  expect(src).toMatch(/useState<'folder' \| 'all'( \| 'bundle')?>\('folder'\)/);
});

test('AC-1-2: 기존 폴더 그리드는 folder 서브탭에서만 렌더(회귀 0 — 화면 분리)', () => {
  const src = read(TAB);
  expect(src).toContain("{subTab === 'folder' && (");
  // 기존 폴더 트리/약품 목록 testid 보존
  expect(src).toContain('drug-folder-admin-tree');
  expect(src).toContain('drug-folder-assigned-table');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 / AC: Part B — 전체보기 테이블 + 컬럼 + 다중선택
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 전체보기 = 약별 테이블뷰(전 폴더 약), all 서브탭에서만 렌더', () => {
  const src = read(TAB);
  expect(src).toContain("{subTab === 'all' && (");
  expect(src).toContain('drug-folder-viewall-table');
  // 전 폴더 약 통합 + 가나다 정렬
  expect(src).toContain('const allDrugs = [...drugs].sort(');
});

test('AC-2-2: 컬럼 = 체크박스 / 약 이름(용량) / 소속 폴더 (§0.5 reporter 정정 — 3컬럼)', () => {
  const src = read(TAB);
  expect(src).toContain('약 이름(용량)');
  expect(src).toContain('소속 폴더');
  // §0.5 reporter authority: '기타 처방정보' 컬럼 제거(reporter 3컬럼만 명시)
  expect(src).not.toContain('>기타 처방정보<');
  // 소속 폴더명 lookup
  expect(src).toContain('folderNameById');
  // 행/전체선택 체크박스
  expect(src).toContain('drug-folder-viewall-select-all');
  expect(src).toContain('drug-folder-viewall-row-check');
});

test('AC-2-3: 헤더 전체선택 토글 + 선택건수 표시', () => {
  const src = read(TAB);
  expect(src).toContain('function toggleSelectAllDrugs');
  expect(src).toContain('function toggleDrugSelect');
  expect(src).toContain('const allSelected =');
  expect(src).toContain('선택 {selectedDrugIds.size}건');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2(삭제) / AC: 일괄 삭제 = 기존 로직 재사용 + 확인 팝업, 0건 비활성
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: [선택 N건 삭제] — 0건이면 비활성', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-viewall-bulk-delete');
  expect(src).toContain('disabled={selectedDrugIds.size === 0 || bulkDeleting}');
});

test('AC-3-2: 일괄 삭제 = 기존 단건 삭제 로직(useUnassignDrug) 재사용 — 신규 삭제 경로 없음', () => {
  const src = read(TAB);
  expect(src).toContain('function handleBulkDelete');
  // 기존 단건 mutation 을 그대로 반복 호출(신규 bulk delete RPC/in() 경로 안 만듦)
  expect(src).toContain('ids.map((id) => unassignDrug.mutateAsync(id))');
  // 확인 팝업(window.confirm) 재사용
  expect(src).toContain('window.confirm(');
  // 삭제=분류 해제(약 마스터 보존) 문구
  expect(src).toContain('약품 자체는 보존');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4 / AC: 엣지 — 빈 상태
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 전체보기 약 0개 시 빈 상태 메시지', () => {
  const src = read(TAB);
  expect(src).toContain('폴더에 분류된 약품이 없습니다.');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5 / AC: 검증(verify) 버튼 UI surface — MIGCLEAR 범위 = 표면만(DML 없음).
//   검증 semantics/DML 은 T-20260617-foot-RX-VALID-TAG-REMOVE 정본 경로 단일 구현(CORRECTION).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 이관약(code_type=이관약) 행에만 이관 태그 + 검증 버튼 UI surface 노출(신규 약 미노출)', () => {
  const src = read(TAB);
  // 노출 게이트가 code_type === MIGRATED_CODE_TYPE 동시조건이어야 신규 약엔 안 뜸
  expect(src).toContain('MIGRATED_CODE_TYPE');
  expect(src).toContain("d.code_type === MIGRATED_CODE_TYPE");
  expect(src).toContain('drug-folder-viewall-migrated-tag');
  expect(src).toContain('drug-folder-viewall-verify-btn');
  // 버튼 surface 는 편집권한(canEdit) 행에만 — 읽기전용 사용자엔 미노출
  expect(src).toContain('handleVerify');
});

test('AC-5-2: code_type 은 read-only(배지/버튼 게이트용)로만 — MIGCLEAR 에 검증 DML 없음', () => {
  const lib = read(LIB);
  // 전체보기 이관 배지 게이트용으로 code_type 을 읽어와야 함(read-only)
  expect(lib).toContain('code_type');
  expect(lib).toContain("MIGRATED_CODE_TYPE = '이관약'");
  // CORRECTION: 검증 DML(code_type 승격 UPDATE)은 MIGCLEAR 범위 아님 — RX-VALID-TAG-REMOVE 로 이관.
  //   → useVerifyMigratedDrug / VERIFIED_CODE_TYPE / code_type UPDATE 가 본 티켓 코드에 있으면 안 됨.
  expect(lib).not.toContain('useVerifyMigratedDrug');
  expect(lib).not.toContain('VERIFIED_CODE_TYPE');
  expect(lib).not.toContain('.update({ code_type');
});

test('GUARD: MIGCLEAR 는 prescription_codes 에 어떤 write(UPDATE/INSERT/DELETE) DML 도 추가하지 않음', () => {
  const lib = read(LIB);
  const tab = read(TAB);
  // prescription_codes 직접 write 금지(검증·기타 어떤 경로로도 code_type 임의 UPDATE 금지)
  expect(lib).not.toMatch(/from\(['"]prescription_codes['"]\)[\s\S]{0,80}\.update\(/);
  expect(tab).not.toMatch(/from\(['"]prescription_codes['"]\)[\s\S]{0,80}\.update\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: additive FE — 스키마 변경/신규 npm 패키지 없음(§0.3-5)
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE) 없음 — 순수 additive FE', () => {
  expect(read(TAB)).not.toMatch(/alter\s+table/i);
  expect(read(LIB)).not.toMatch(/alter\s+table/i);
});
