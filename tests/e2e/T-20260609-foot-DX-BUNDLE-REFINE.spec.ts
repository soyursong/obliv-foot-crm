/**
 * E2E spec — T-20260609-foot-DX-BUNDLE-REFINE (묶음상병 UX 재정의)
 *
 * 현장(문지은 대표원장 C0ATE5P6JTH): DX-BUNDLE-SET(commit e72c976) 실사용 후 단순화 요청.
 *   AC-1 폴더제거    : optgroup/폴더 그룹핑 폐지 → 플랫 목록. diagnosis_folder 컬럼 DB 보존·UI 비노출.
 *   AC-2 이름순 자동 : sort_order 숫자입력 UI 제거. 목록 기본 = name ASC. sort_order = DnD 전용.
 *   AC-3 세트 즐찾   : diagnosis_sets.is_favorite(★) — 즐찾 최상단(그 안 name ASC). 진료차트 섹션도 우선.
 *                      ⚠️ 세트(diagnosis_sets) 단위 컬럼 — doctor_diagnosis_favorites(상병코드 원장별)와 別엔티티.
 *   AC-4 :: DnD     : GripVertical 좌측 핸들. 드롭 순서 → sort_order 저장(QuickRxButtonsTab 패턴).
 *
 * 현장 클릭 시나리오 4건(티켓 본문):
 *   1) 묶음상병 탭 진입 → 폴더 그룹 헤더 없이 세트가 한 줄로(플랫) 보인다.
 *   2) 세트 추가 다이얼로그에 '폴더'·'정렬 순서' 입력칸이 없다(이름·상병·활성만).
 *   3) ★ 토글 → 해당 세트가 목록 최상단으로, 진료차트 묶음상병 섹션에서도 위로 온다.
 *   4) :: 핸들을 끌어 순서를 바꾸면 자동 저장된다. 기존 일괄적용·단건입력 동선은 무변경.
 *
 * 본 spec 은 묶음상병 UX 불변식을 정본 소스/마이그에 정적 단언으로 인코딩(데이터·로그인 비의존)해 회귀를 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260609120000_diagnosis_sets_is_favorite.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260609120000_diagnosis_sets_is_favorite.rollback.sql';
const TAB = 'src/components/admin/DiagnosisSetsTab.tsx';
const PICKER = 'src/components/medical/DiagnosisFolderPicker.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 마이그: is_favorite 컬럼 1개 additive + 롤백 + 폴더 컬럼 삭제 금지
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: is_favorite ADDITIVE 마이그(컬럼 1개) + 롤백 존재', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  expect(existsSync(join(ROOT, MIG_ROLLBACK))).toBe(true);
  const sql = read(MIG);
  // 컬럼 1개 additive (ADD COLUMN IF NOT EXISTS, NOT NULL DEFAULT false)
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false/);
  // ⚠️ 폴더 컬럼(diagnosis_folder)·sort_order 삭제/변경 금지(보존)
  expect(sql).not.toMatch(/DROP COLUMN/);
  expect(sql).not.toMatch(/DROP COLUMN[\s\S]*diagnosis_folder/i);
  expect(sql).not.toMatch(/(ALTER COLUMN|DROP COLUMN)[\s\S]*sort_order/i);
  // 別엔티티 명시(원장별 즐찾과 혼동 금지)
  expect(sql).toContain('doctor_diagnosis_favorites');
  // 롤백 = 컬럼/인덱스 제거
  const rb = read(MIG_ROLLBACK);
  expect(rb).toContain('DROP COLUMN IF EXISTS is_favorite');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 폴더 제거 — 시나리오 1: 플랫 목록(폴더 그룹 헤더 없음) / 시나리오 2: 다이얼로그 폴더칸 없음
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1 (시나리오1): 목록이 플랫 — 폴더 그룹핑/optgroup 제거', () => {
  const src = read(TAB);
  // 폴더 그룹 컨테이너·optgroup 제거
  expect(src).not.toContain('data-testid="dx-set-folder-group"');
  expect(src).not.toContain('<optgroup');
  expect(src).not.toContain('masterGrouped');
  // 폴더 입력/그룹핑 로직 제거(상태 미사용)
  expect(src).not.toContain('data-testid="dx-set-folder-input"');
  expect(src).not.toContain('dx-set-folder-suggestions');
  // 플랫 목록은 유지
  expect(src).toContain('data-testid="dx-set-list"');
  expect(src).toContain('data-testid="dx-set-item"');
});

test('AC-1 (시나리오2): 추가 다이얼로그 — 폴더/정렬순서 입력칸 없음(이름만)', () => {
  const src = read(TAB);
  // 이름 입력은 유지
  expect(src).toContain('data-testid="dx-set-name-input"');
  // 폴더 입력칸 없음 + 정렬순서 숫자 input 없음(라벨 자체 제거)
  expect(src).not.toContain('폴더 (분류)');
  expect(src).not.toContain('정렬 순서');
  // SetForm 에서 폴더/정렬 입력 필드 제거
  expect(src).not.toMatch(/diagnosis_folder:\s*string/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 폴더 보존 — diagnosis_folder 를 FE 가 덮어쓰지 않음(UI 비노출, DB 보존)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: diagnosis_folder 컬럼은 upsert payload 에서 제외(DB 보존·미터치)', () => {
  const src = read(TAB);
  // upsert payload 에 diagnosis_folder 미포함(기존값 보존)
  expect(src).not.toMatch(/diagnosis_folder:\s*form\./);
  // 폴더 미터치 의도 주석
  expect(src).toMatch(/diagnosis_folder.*보존|보존.*diagnosis_folder/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 이름순 자동정렬 — sort_order 숫자입력 제거 + 기본 name ASC
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: sort_order 숫자입력 UI 제거 + 정렬 우선순위(즐찾→sort_order→name)', () => {
  const src = read(TAB);
  // 숫자 입력 제거
  expect(src).not.toContain('type="number"');
  // 정렬 comparator: is_favorite → sort_order → name(localeCompare ko)
  expect(src).toContain('function compareSets');
  expect(src).toContain("a.name.localeCompare(b.name, 'ko')");
  // 마스터(상병) 선택 목록도 name ASC 로 조회
  expect(src).toMatch(/\.order\('name', \{ ascending: true \}\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 세트 즐겨찾기 — ★ 토글 + 최상단 우선(목록 & 진료차트 섹션)
// 시나리오 3
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3 (시나리오3): 세트 ★ 토글 + diagnosis_sets.is_favorite 업데이트', () => {
  const src = read(TAB);
  // 토글 진입점 + 즐찾 단건 update
  expect(src).toContain('data-testid="dx-set-fav-toggle"');
  expect(src).toContain('async function toggleFav');
  expect(src).toMatch(/update\(\{ is_favorite/);
  // 즐찾 우선 정렬(comparator 1순위)
  expect(src).toContain('a.is_favorite ? -1 : 1');
  // 별엔티티: doctor_diagnosis_favorites 테이블 쿼리 금지(상병코드 원장별 즐찾과 통합 X)
  expect(src).not.toContain(".from('doctor_diagnosis_favorites')");
});

test('AC-3 (시나리오3): 진료차트 묶음상병 섹션도 즐찾 우선(deploy-tolerant)', () => {
  const src = read(PICKER);
  // is_favorite 조회 + 즐찾 우선 정렬
  expect(src).toContain('is_favorite');
  expect(src).toContain('a.is_favorite ? -1 : 1');
  // deploy-tolerant: is_favorite 미적용 시 폴백(별도 select)
  expect(src).toMatch(/withFav\.error/);
  // 즐찾 시각 마커
  expect(src).toContain('data-testid="dx-picker-set-fav"');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 :: DnD — GripVertical 핸들 + 드롭 순서 sort_order 저장(QuickRxButtonsTab 패턴)
// 시나리오 4(순서 변경)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4 (시나리오4): :: 드래그 핸들 + 드롭 순서 sort_order 저장', () => {
  const src = read(TAB);
  // @dnd-kit 기사용 패턴(PROCMENU-RX-UNIFY / QuickRxButtonsTab 동일)
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).toContain("from '@dnd-kit/sortable'");
  expect(src).toContain('useSortable');
  expect(src).toContain('arrayMove');
  // GripVertical 좌측 핸들
  expect(src).toContain('GripVertical');
  expect(src).toContain('data-testid="dx-set-handle"');
  // 드롭 시 sort_order 일괄 저장 + 변경분만 update + 실패 롤백
  expect(src).toContain('function handleDragEnd');
  expect(src).toMatch(/update\(\{ sort_order \}\)/);
  expect(src).toContain('setItems(snapshot)'); // 실패 롤백
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀(시나리오4 후단): 기존 일괄적용·단건입력 동선 무변경
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: 진료차트 일괄적용/단건입력 동선 무변경(DX-BUNDLE-SET 보존)', () => {
  const src = read(PICKER);
  // 일괄 적용 = 기존 단건 누적기 재사용(무변경)
  expect(src).toContain('function applySet(');
  expect(src).toContain('addDxEntry(next, fmtDx(row))');
  // 단건 입력경로 보존
  expect(src).toContain('function select(row: DxRow)');
  expect(src).toContain('export function addDxEntry');
  // 묶음상병 섹션 진입점 보존
  expect(src).toContain('data-testid="dx-picker-sets"');
  expect(src).toContain('data-testid="dx-picker-set-item"');
});

test('회귀: 관리 권한 = director/manager/admin 보존 + items replace 저장 보존', () => {
  const src = read(TAB);
  expect(src).toContain("['director', 'manager', 'admin']");
  expect(src).toContain("from('diagnosis_set_items')");
  // T-...-NEST-BUNDLE-FOLDER AC-6: 수동 주/부 토글 → 순서기반 자동 배지(읽기전용)로 교체.
  expect(src).toContain('data-testid="dx-set-item-type-badge"');
});
