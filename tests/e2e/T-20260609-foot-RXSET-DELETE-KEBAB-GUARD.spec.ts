/**
 * E2E spec — T-20260609-foot-RXSET-DELETE-KEBAB-GUARD
 *
 * 현장(문지은 대표원장): "삭제가 너무 쉽게 노출 → 점세개(⋮)를 오른쪽 위에 띄워서 삭제를 한 번 더 컨펌받게."
 *
 * ★ 스펙 변경(MSG-…-dj5p, 문지은 대표원장 ts1780938350): 케밥 메뉴엔 "삭제"만. "수정" 제거.
 *   현장 사유: "수정은 무의미하지 폴더는 드래그로 바꾸지 않아?" → 세트 편집 진입점 제거.
 *   폴더 이동(DnD)은 별건 T-20260609-foot-RXSET-FOLDER-DND.
 *
 * 변경 요지(FE only, 스키마 변경 없음):
 *   - rx-set-item 카드 헤더 우측의 Pencil/Trash2 직접노출 제거 → 우측상단 ⋮(MoreVertical) 케밥.
 *   - 케밥 → "삭제" 단일 옵션(destructive 톤, 바깥클릭/ESC 닫힘) — 경량 인라인 popover.
 *   - 네이티브 confirm() 제거 → 확인 다이얼로그(dialog.tsx 재사용). [삭제] 누를 때만 del 실행.
 *   - 신규 npm 패키지(@radix-ui/*) 추가 없음. 기존 의존성·UX 회귀 없음.
 *
 * 본 spec 은 RXSET-MGMT-DRUG-SEARCH 와 동일하게 정본 소스에 정적 단언으로 불변식을 인코딩해
 *   회귀를 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RX = 'src/components/admin/PrescriptionSetsTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 🗑️ 직접노출 제거 + 우측상단 ⋮ 아이콘(canEdit 가드 유지)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1-1: rx-set-item 카드 헤더에 Trash2 직접노출(handleDelete 직결) 제거 → 케밥 진입점', () => {
  const src = read(RX);
  // 케밥 컴포넌트 + 진입 버튼 존재
  expect(src).toContain('function RxSetKebabMenu');
  expect(src).toContain('rx-set-kebab-btn');
  expect(src).toContain('MoreVertical');
  // 카드 헤더에서 RxSetKebabMenu 를 canEdit 가드 안에서 렌더
  expect(src).toContain('<RxSetKebabMenu');
  expect(src).toContain('canEdit && (');
});

test('AC-1-2: 네이티브 confirm() 기반 handleDelete(직접삭제) 제거', () => {
  const src = read(RX);
  // 더 이상 confirm() 으로 즉시 삭제하지 않음
  expect(src).not.toMatch(/if\s*\(!confirm\(/);
  expect(src).not.toContain('function handleDelete');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: ⋮ 클릭 → "삭제" 단일 옵션(삭제 destructive 톤, 바깥/ESC 닫힘). "수정" 없음.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2-1: 드롭다운에 삭제 단일 옵션 — destructive 톤, "수정" 옵션 없음(스펙변경 dj5p)', () => {
  const src = read(RX);
  expect(src).toContain('rx-set-kebab-menu');
  expect(src).toContain('rx-set-action-delete');
  // 삭제 항목 destructive 톤
  expect(src).toContain('text-destructive');
  // "수정" 메뉴 항목·편집 진입점 제거
  expect(src).not.toContain('rx-set-action-edit');
  expect(src).not.toContain('function openEdit');
  expect(src).not.toContain('onEdit');
});

test('AC-2-2: 바깥클릭/ESC 로 드롭다운 닫힘(경량 인라인 popover)', () => {
  const src = read(RX);
  // 바깥클릭(mousedown/touchstart) + ESC(Escape) 닫힘 리스너
  expect(src).toContain("addEventListener('mousedown'");
  expect(src).toContain("addEventListener('keydown'");
  expect(src).toContain("e.key === 'Escape'");
  expect(src).toContain('!ref.current.contains(e.target as Node)');
});

test('AC-2-3: 신규 npm 패키지(@radix-ui dropdown/popover) 추가 없음', () => {
  const src = read(RX);
  expect(src).not.toMatch(/@radix-ui\/react-dropdown-menu/);
  expect(src).not.toMatch(/@radix-ui\/react-popover/);
  // package.json 에도 미추가
  const pkg = read('package.json');
  expect(pkg).not.toMatch(/@radix-ui\/react-dropdown-menu/);
  expect(pkg).not.toMatch(/@radix-ui\/react-popover/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: "삭제" → 확인 다이얼로그 → [삭제] 누를 때만 del 실행
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3-1: 케밥 "삭제" → setDeleteTarget(확인 다이얼로그 오픈), 즉시 삭제 아님', () => {
  const src = read(RX);
  expect(src).toContain('const [deleteTarget, setDeleteTarget]');
  expect(src).toContain('onDelete={() => setDeleteTarget(s)}');
  // 확인 다이얼로그(dialog.tsx 재사용) — open 은 deleteTarget 존재 여부
  expect(src).toContain('rx-set-delete-dialog');
  expect(src).toContain('open={!!deleteTarget}');
});

test('AC-3-2: 다이얼로그 문구·버튼 — 세트명·되돌릴 수 없음·[취소][삭제]', () => {
  const src = read(RX);
  expect(src).toContain('{deleteTarget?.name}');
  expect(src).toContain('이 작업은 되돌릴 수 없어요.');
  expect(src).toContain('rx-set-delete-confirm-btn');
  // 삭제 확정 버튼 destructive
  expect(src).toContain('variant="destructive"');
});

test('AC-3-3: 실제 del.mutate 는 confirmDelete(다이얼로그 [삭제])에서만 실행', () => {
  const src = read(RX);
  expect(src).toContain('function confirmDelete');
  expect(src).toContain('del.mutate(deleteTarget.id');
  expect(src).toContain('onClick={confirmDelete}');
  // 삭제 후 다이얼로그 닫힘
  expect(src).toContain('setDeleteTarget(null)');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 회귀 없음 — 토스트·invalidate·권한가드·RXSET-DRUG-SEARCH 무영향
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4-1: 세트 추가(openAdd)·저장(handleSave) 동선 보존 — 편집 인프라(editing/upsert {id}) 잔존', () => {
  const src = read(RX);
  // 편집 진입점(openEdit)은 제거됐지만, 추가 동선과 upsert 분기 인프라는 회귀 없이 유지.
  expect(src).toContain('function openAdd');
  expect(src).toContain('function handleSave');
  expect(src).toContain('id: editing?.id');
});

test('AC-4-2: RXSET-DRUG-SEARCH(드롭다운 검색) 불변식 무영향', () => {
  const src = read(RX);
  expect(src).toContain('async function searchRxMaster');
  expect(src).toContain('rx-set-drug-search-dropdown');
  expect(src).toContain('function handleSelectDrug');
});

test('GUARD: 스키마 변경(ALTER TABLE) 없음 — 순수 FE', () => {
  expect(read(RX)).not.toMatch(/alter\s+table/i);
});
