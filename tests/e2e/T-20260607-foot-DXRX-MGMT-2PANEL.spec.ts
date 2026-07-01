/**
 * E2E spec — T-20260607-foot-DXRX-MGMT-2PANEL (갈래① 상병명 관리 2패널)
 *
 * 문지은 대표원장(6/7~6/8, C0ATE5P6JTH): "상병명관리를 좌:폴더관리 / 우:폴더에 상병명 배치
 *   2분할로. 등록 폼에서 폴더 입력 빼고, 오른쪽 항목을 왼쪽 폴더로 드래그앤드롭으로 집어넣게."
 *
 * 데이터모델(20260607200000_diagnosis_folders_fk, D3 supervisor 게이트 GO 후 적용):
 *   상병 정본 = services(category_label='상병') SSOT / 폴더 = diagnosis_folders(자기참조 트리) /
 *   배치 = services.diagnosis_folder_id uuid NULL FK(NULL=미분류). 훅 = @/lib/diagnosisFolders.
 *
 * 본 spec 은 2패널+크로스패널 DnD 배치 구조 불변식을 정본 소스에 정적 단언으로 인코딩해
 *   회귀를 가드한다(데이터/로그인 비의존). 현장 클릭 시나리오 3종(티켓 본문)을 구조 단언으로 변환.
 *
 * ※ 본 티켓은 선행 DX-MGMT-DND-SORT(폴더 내 항목 reorder)·DXMGMT-LEFT-FOLDER-FIX(TEXT 폴더 2패널)·
 *   FOLDER-RENAME-INLINE(TEXT rename) 의 UX 를 대체한다. 항목 드래그 = "폴더로 배치"(reorder 아님),
 *   폴더 = TEXT 문자열이 아니라 diagnosis_folders 엔티티, rename = useUpdateDiagnosisFolder.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';
const LIB = 'src/lib/diagnosisFolders.ts';

// ── AC-1: 좌(폴더)·우(항목) 2패널 레이아웃 ──
test('AC-1: 2패널 grid(좌 폴더관리 / 우 상병항목) 렌더', () => {
  const src = read(TAB);
  expect(src).toContain('dx-folder-tree'); // 좌측 폴더 패널
  expect(src).toContain('dx-list'); // 우측 항목 패널
  expect(src).toContain('md:grid-cols-[280px_minmax(0,1fr)]'); // 좌 고정폭 + 우 가변 (NEST-BUNDLE-FOLDER AC-1: 240→280px)
  expect(src).toContain('dx-folder-node');
  expect(src).toContain('dx-folder-items');
});

// ── AC-2: 등록 폼에서 폴더 필드 제거 + 항목→폴더 드래그앤드롭 배치 ──
// T-20260701-foot-STALEGUARD forward-update: 자유타이핑 상병명/코드 입력(dx-name-input/dx-code-input)은
//   T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN 으로 KCD 공식목록 검색+클릭 단일 입력(dx-kcd-search)에 이관됨.
//   원 AC-2 의도(등록 폼에 폴더 입력 필드 없음 = 배치는 DnD 전담)는 그대로 유지하며 현행 입력수단으로 갱신.
test('AC-2: 항목 등록 폼에 폴더 입력 필드 없음 (KCD 검색클릭 단일 입력)', () => {
  const src = read(TAB);
  // 등록 폼 필드 = KCD검색(명칭+코드 확정) + 활성화. 폴더 입력/선택 필드·datalist 없음.
  expect(src).toContain('dx-kcd-search'); // KCD 검색 입력(명칭+코드 확정)
  expect(src).toContain('dx-kcd-selected'); // 선택된 KCD(코드+명칭) 확정 표기
  expect(src).not.toContain('dx-name-input'); // 구 자유타이핑 상병명 입력 제거(KCD-LOCKDOWN)
  expect(src).not.toContain('dx-code-input'); // 구 자유타이핑 코드 입력 제거(KCD-LOCKDOWN)
  expect(src).not.toContain('dx-folder-input'); // 폴더 입력 필드 없음(AC-2 원의도)
  expect(src).not.toContain('dx-folder-suggestions'); // 폴더 자동완성 datalist 없음
});

test('AC-2: 우측 항목 = useDraggable / 좌측 폴더·미분류 = useDroppable (크로스패널 DnD)', () => {
  const src = read(TAB);
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).toContain('DndContext');
  expect(src).toContain('useDraggable'); // 우측 항목 드래그 소스
  expect(src).toContain('useDroppable'); // 좌측 폴더 드롭 타겟
  expect(src).toContain('DragOverlay'); // 드래그 시각 피드백
  expect(src).toContain('dx-item-handle'); // 항목 grab 핸들
  expect(src).toContain('cursor-grab');
  expect(src).toContain('touch-none'); // 태블릿 탭 오인식 방지
  // 신규 경쟁 DnD 라이브러리 도입 금지
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('@hello-pangea/dnd');
});

test('AC-2: 드롭 → services.diagnosis_folder_id FK 갱신(useAssignDiagnosisToFolder, 이동 시맨틱)', () => {
  const src = read(TAB);
  expect(src).toContain('useAssignDiagnosisToFolder');
  expect(src).toContain('handleDragEnd');
  // 드롭 타겟 키 → folder_id (UNASSIGNED 이면 null = 미분류 환원)
  expect(src).toContain('targetFolderId');
  expect(src).toContain('assign.mutate');
  // lib: junction 없이 services.diagnosis_folder_id 직접 UPDATE
  const lib = read(LIB);
  expect(lib).toContain('diagnosis_folder_id');
  expect(lib).toContain("from('services')");
  expect(lib).toContain('.update({ diagnosis_folder_id: input.folder_id })');
});

// ── AC-3: 좌측 폴더 CRUD + 위계(하위폴더) + 순서(▲▼) + 인라인 rename ──
test('AC-3: 폴더 생성(루트/하위)·수정·삭제 CRUD 엔티티 훅', () => {
  const src = read(TAB);
  expect(src).toContain('useCreateDiagnosisFolder');
  expect(src).toContain('useUpdateDiagnosisFolder');
  expect(src).toContain('useDeleteDiagnosisFolder');
  // 루트 폴더 생성 + 하위 폴더(위계 parent_id) 생성
  expect(src).toContain('handleCreateRoot');
  expect(src).toContain('handleAddChild');
  expect(src).toContain('dx-folder-new-root-input');
  expect(src).toContain('dx-folder-add-child');
  expect(src).toContain('dx-folder-delete-btn');
  // 폴더 순서 조정 — T-20260701-foot-REORDER-ARROW-TO-DRAG: ▲▼ → 드래그 핸들(형제 sort_order 재번호)
  expect(src).toContain('handleFolderReorder');
  expect(src).toContain('dx-folder-drag-handle');
  expect(src).not.toContain('dx-folder-move-up');
  expect(src).not.toContain('dx-folder-move-down');
});

test('AC-3: 폴더 인라인 rename — 빈이름·형제중복 차단, 소속 항목 FK 유지(name만 UPDATE)', () => {
  const src = read(TAB);
  expect(src).toContain('submitRename');
  expect(src).toContain('dx-folder-rename-input');
  expect(src).toContain('dx-folder-rename-save');
  expect(src).toContain('dx-folder-rename-cancel');
  // 진입점: 더블클릭/우클릭/연필버튼/F2
  expect(src).toContain('onDoubleClick');
  expect(src).toContain('onContextMenu');
  expect(src).toContain('dx-folder-rename-btn');
  // 검증: 빈이름 + 형제 중복
  expect(src).toContain('폴더 이름을 입력해주세요.');
  expect(src).toContain('같은 위치에 같은 이름의 폴더가 이미 있어요.');
  // rename = diagnosis_folders.name UPDATE (소속 services FK 불변)
  expect(src).toContain('updateFolder.mutateAsync({ id: node.id, name: next })');
  const lib = read(LIB);
  expect(lib).toContain("from('diagnosis_folders')");
});

// ── AC-4: 전체목록 노드(구 미분류 버킷, NEST-BUNDLE-FOLDER AC-3 격상) ──
test('AC-4: "전체목록" 노드 — 항상 표시 + drop 가능(폴더 배정 해제)', () => {
  const src = read(TAB);
  expect(src).toContain('AllItemsBucket');
  expect(src).toContain("ALL_KEY = '__all__'");
  expect(src).toContain("ALL_LABEL = '전체목록'");
  // drop 시 분류 해제(folder_id null) 시맨틱 보존
  expect(src).toContain('폴더 분류 해제');
});

// ── AC-5: 좌측 폴더 선택 → 우측 필터링 ──
test('AC-5: 선택 폴더 → 우측이 해당 폴더 소속 항목으로 필터', () => {
  const src = read(TAB);
  expect(src).toContain('selectedKey');
  expect(src).toContain('visibleItems');
  // 미분류 선택 = folder_id null / 폴더 선택 = folder_id === selectedKey
  expect(src).toContain('d.diagnosis_folder_id === selectedKey');
});

// ── AC-6: 관리권한 외 read-only ──
// T-20260701-foot-STALEGUARD forward-update: 로컬 DX_MANAGE_ROLES 리터럴은
//   T-20260619-foot-ROLE-MATRIX-3TIER-RBAC 로 공통 헬퍼 canEditClinicMgmt(profile)(@/lib/permissions)에 이관됨.
//   원 AC-6 의도(관리권한 외 role 은 폴더 관리·배치 조작 불가)는 유지하되, 판정 소스를 현행 헬퍼로 갱신.
//   역할집합은 헬퍼가 SSOT(진료관리 write 권한: admin/director/has_ops_authority) — 헬퍼 사용 경로를 정적 단언.
test('AC-6: 관리권한(canEditClinicMgmt) 외 role 은 폴더 관리·배치 조작 불가', () => {
  const src = read(TAB);
  expect(src).toContain('canEditClinicMgmt'); // 공통 권한 헬퍼 사용(로컬 역할 리터럴 대체)
  expect(src).toContain('const canManage = canEditClinicMgmt(profile)'); // 관리권한 = 헬퍼 판정
  expect(src).not.toContain('DX_MANAGE_ROLES'); // 로컬 역할 리터럴 제거(헬퍼로 이관)
  // 비관리 role → 드래그 소스 비활성(useDraggable disabled) + 폴더 조작 버튼 비노출
  expect(src).toContain('disabled: !canManage');
  // DnD 배치도 관리권한 가드
  expect(src).toContain('if (!over || !canManage) return');
});

// ── AC-7: 무손실 — folder_id NULL 분은 미분류로 정상 노출 ──
test('AC-7: 폴더 컬럼 미적용/배정 NULL 분 무손실 — deploy-tolerant read 폴백', () => {
  const src = read(TAB);
  // diagnosis_folder_id 컬럼 미적용 환경(42703)에서도 목록 로드(폴백 → folder_id null)
  expect(src).toContain('withFolder.error');
  expect(src).toContain('diagnosis_folder_id: null');
  const lib = read(LIB);
  // 폴더 테이블 미적용 환경(42P01/PGRST205)에서도 빈 목록 폴백(화면 무중단)
  expect(lib).toContain('isMissingFoldersTable');
});

// ── 상병 정본 SSOT 회귀 가드 ──
test('REGRESSION: 상병 정본 = services category_label=상병 단일 SSOT (폴더는 분류일 뿐)', () => {
  const src = read(TAB);
  expect(src).toContain('category_label');
  expect(src).toContain("'상병'");
  // 두번째 상병 마스터 테이블 신설 금지
  expect(src).not.toContain('diagnosis_categories');
  expect(src).not.toContain('clinic_diagnoses');
});

// ── 시나리오 1: 폴더 생성 → 항목 등록(폴더필드 없음) → 드래그 배치 → 필터 ──
test('시나리오1: 폴더 생성·항목 미분류 등록·드래그 배치·선택 필터 경로 존재', () => {
  const src = read(TAB);
  // 폴더 생성
  expect(src).toContain('handleCreateRoot');
  // 신규 항목은 폴더 미지정(미분류)로 생성 — upsert payload 에 folder 없음
  expect(src).not.toContain('diagnosis_folder:'); // 폴더값 write 경로 제거(배치는 assign 전담)
  // 드래그 배치 → 선택 폴더 필터
  expect(src).toContain('handleDragEnd');
  expect(src).toContain('visibleItems');
});

// ── 시나리오 3: 엣지 — 전체목록 노드 + 권한 ──
test('시나리오3: 전체목록 노드 노출 + 비관리 role read-only', () => {
  const src = read(TAB);
  expect(src).toContain('AllItemsBucket'); // NEST-BUNDLE-FOLDER AC-3: 미분류→전체목록 격상
  // 읽기 전용 안내
  expect(src).toContain('읽기 전용');
});
