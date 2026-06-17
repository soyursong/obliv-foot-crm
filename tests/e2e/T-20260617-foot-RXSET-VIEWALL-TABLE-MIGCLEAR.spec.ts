/**
 * E2E spec — T-20260617-foot-RXSET-VIEWALL-TABLE-MIGCLEAR (Part A + Part B)
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH):
 *   "처방세트 오른쪽에 선택한 폴더 약이 보이잖아. 그 전에 전체보기 가능하게 (폴더 선택 위에).
 *    전체보기는 약별로 테이블뷰로 체크박스로 여러개 삭제 가능하게."
 *   스펙확정(krhg, MSG-20260617-122627 / INFO MSG-20260617-123347-hpfq):
 *     - 서브탭 방식 [폴더 선택]/[전체보기] 별도 분리(인라인 토글 X).
 *     - 전체보기 컬럼: 체크박스 / 약명 / 소속 폴더 / 기타 처방정보.
 *       ※ '용량(dosage)'은 약 마스터(prescription_codes) 데이터에 소스 없음 → FOLLOWUP 확인 보류(이번 슬라이스 제외).
 *     - 일괄 삭제 = 기존 단건 삭제 로직(useUnassignDrug=분류 해제) + 확인 팝업 재사용(신규 삭제 경로 X).
 *     - 검증(verify) 버튼: krhg 미언급 → 삭제 우선 구현(이번 슬라이스 제외, §5-1 결정포인트 유지).
 *
 * Surface 확정(§0.4 코드그라운딩): src/components/admin/DrugFoldersTab.tsx
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존) — 형제 RXSET spec 동형.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';

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
  expect(src).toContain("useState<'folder' | 'all'>('folder')");
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

test('AC-2-2: 컬럼 = 체크박스 / 약명 / 소속 폴더 / 기타 처방정보', () => {
  const src = read(TAB);
  expect(src).toContain('약명');
  expect(src).toContain('소속 폴더');
  expect(src).toContain('기타 처방정보');
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
// GUARD: additive FE — 스키마 변경/신규 npm 패키지 없음(§0.3-5)
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE) 없음 — 순수 additive FE', () => {
  expect(read(TAB)).not.toMatch(/alter\s+table/i);
});
