/**
 * E2E spec — T-20260609-foot-DXMGMT-NEST-BUNDLE-FOLDER
 *   상병명관리 폴더 UX 개편(폴더명 표시폭·괄호 건수·전체목록·중첩) + 묶음상병 폴더 접근·다중선택·주부자동.
 *   문지은 대표원장(C0ATE5P6JTH) field 재피드백.
 *
 * 데이터 모델 결정(AC-0): 폴더 중첩은 기존 diagnosis_folders(parent_id 재귀 트리) 모델로 이미 충족 →
 *   신규 마이그레이션 없이 FE 개편. AC-5(multi-folder membership=1상병 N폴더)만 junction 필요 →
 *   현장 (i)/(ii) field_confirm 후 별도 처리(본 배포 범위 제외).
 *
 * 정적 소스 가드(레포 컨벤션) — 식별자/시맨틱 회귀를 차단.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const NAMES = 'src/components/admin/DiagnosisNamesTab.tsx';
const SETS = 'src/components/admin/DiagnosisSetsTab.tsx';
const PICKER = 'src/components/admin/DxFolderMultiSelect.tsx';

// ── AC-1: 폴더명 표시폭 확대(잘림 해소) ──
test('AC-1: 좌측 폴더 패널 240→280px + 폴더명 폰트 확대(text-[13px])', () => {
  const src = read(NAMES);
  expect(src).toContain('md:grid-cols-[280px_minmax(0,1fr)]');
  // 폴더명 표시 — truncate 유지하되 폰트/폭 확대
  expect(src).toContain('text-[13px] font-semibold truncate flex-1');
});

// ── AC-2: 건수 버튼형 배지 제거 → 괄호 인라인 텍스트 ──
test('AC-2: 건수 = 괄호 인라인 텍스트(버튼형 Badge 제거)', () => {
  const src = read(NAMES);
  // 괄호형 건수 + 식별자
  expect(src).toContain('dx-folder-count');
  expect(src).toContain('({count})');
  // 폴더 노드의 건수가 더 이상 Badge 컴포넌트가 아님(인라인 span)
  expect(src).not.toContain('<Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{count}</Badge>');
});

// ── AC-3: 폴더 중첩(기존 재귀 모델) + "미분류" → "전체목록" 전환 ──
test('AC-3: 전체목록 노드(ALL_KEY/ALL_LABEL) + 전체 상병 노출 + 재귀 중첩', () => {
  const src = read(NAMES);
  expect(src).toContain("ALL_LABEL = '전체목록'");
  expect(src).toContain("ALL_KEY = '__all__'");
  // 전체목록 선택 = 폴더 소속 무관 전체 노출
  //   T-20260610-foot-DOCDASH-DIAGMGMT-6FIX(5e55c13) AC-4가 정렬 적용하며 early-return →
  //   `const base = selectedKey === ALL_KEY ? items : items.filter(...)` 삼항으로 리팩터. 전체노출 시맨틱 불변.
  expect(src).toContain('selectedKey === ALL_KEY ? items : items.filter((d) => d.diagnosis_folder_id === selectedKey)');
  // 중첩 = 재귀 FolderNode + 트리 빌더(기존 모델 재사용, 신규 마이그 없음)
  expect(src).toContain('buildDiagnosisFolderTree');
  expect(src).toContain('node.children.map');
});

test('AC-3: 전체목록(null)으로 드롭 = 폴더 분류 해제 시맨틱 보존', () => {
  const src = read(NAMES);
  expect(src).toContain('useAssignDiagnosisToFolder');
  expect(src).toContain('폴더 분류 해제');
  expect(src).toContain('overKey === ALL_KEY ? null : overKey');
});

// ── AC-4: 묶음상병 추가 = 폴더트리 picker + 다중선택 일괄추가 ──
test('AC-4: 묶음상병 상병추가 = 폴더트리 다중선택 picker(select 교체)', () => {
  const src = read(SETS);
  // 구 flat select 제거 → picker 토글 버튼
  expect(src).not.toContain('data-testid="dx-set-add-item-select"');
  expect(src).toContain('data-testid="dx-set-open-picker"');
  expect(src).toContain('DxFolderMultiSelect');
  expect(src).toContain('folders={folders}');
  expect(src).toContain('useDiagnosisFolders');
  // picker = 상병명관리 동일 폴더트리(중첩) + 체크박스 다중선택 + 일괄 추가
  const pk = read(PICKER);
  expect(pk).toContain('buildDiagnosisFolderTree');
  expect(pk).toContain('data-testid="dx-pick-row"');
  expect(pk).toContain('data-testid="dx-pick-confirm"');
  expect(pk).toContain('onConfirm');
});

test('AC-4: picker 선택 순서 보존 + 중복(이미 담긴 상병) 차단', () => {
  const pk = read(PICKER);
  // 선택 순서 = 배열 push 순서(AC-6 근거)
  expect(pk).toContain('const [selected, setSelected] = useState<string[]>');
  expect(pk).toContain('addedIds.has(id)');
  // 호출부 일괄 추가 — 중복 제외
  const src = read(SETS);
  expect(src).toContain('function addItems(orderedIds: string[])');
  expect(src).toContain('existing.has(id)');
});

// ── AC-6: 다중선택 시 첫 선택=주상병 자동, 나머지=부상병(별도 지정 UI 없음) ──
test('AC-6: 순서 기반 주/부 자동 지정 — index0=primary, 수동토글 제거', () => {
  const src = read(SETS);
  expect(src).toContain('function withAutoTypes');
  expect(src).toContain("diagnosis_type: i === 0 ? 'primary' : 'secondary'");
  // 저장 직전 재정규화(순서 SSOT)
  expect(src).toContain('items: withAutoTypes(form.items)');
  // 수동 주/부 토글 버튼 제거 → 읽기전용 배지
  expect(src).not.toContain('data-testid="dx-set-item-type-primary"');
  expect(src).toContain('data-testid="dx-set-item-type-badge"');
  expect(src).toContain('const primary = idx === 0');
});

// ── 회귀: 묶음상병 핵심 동작(DnD 정렬·즐겨찾기·정규화 저장) 보존 ──
test('회귀: DX-BUNDLE-SET/REFINE — DnD 정렬·즐겨찾기·items replace 저장 보존', () => {
  const src = read(SETS);
  expect(src).toContain('handleDragEnd');
  expect(src).toContain('dx-set-handle');
  expect(src).toContain('dx-set-fav-toggle');
  expect(src).toContain("from('diagnosis_set_items')");
  expect(src).toContain("['director', 'manager', 'admin']");
});

// ── 회귀: DX-INPUT-LAYOUT-STABLE — 상병 입력 레이아웃(폴더 패널 2패널 grid) 보존 ──
test('회귀: 상병명관리 2패널 grid·도달 식별자 보존', () => {
  const src = read(NAMES);
  expect(src).toContain('dx-folder-tree');
  expect(src).toContain('dx-list');
  expect(src).toContain('dx-folder-items');
});

// ── 시나리오 3: 묶음상병 폴더 picker — 추가됨 표시 + 다중선택 추가 ──
test('시나리오3: picker 이미 담긴 상병 "추가됨" 비활성 + 검색', () => {
  const pk = read(PICKER);
  expect(pk).toContain('추가됨');
  expect(pk).toContain('data-testid="dx-pick-search"');
  expect(pk).toContain('첫 선택 = 주상병');
});
