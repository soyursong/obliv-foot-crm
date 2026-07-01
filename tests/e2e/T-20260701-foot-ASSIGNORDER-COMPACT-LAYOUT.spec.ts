/**
 * E2E spec — T-20260701-foot-ASSIGNORDER-COMPACT-LAYOUT
 *
 * /admin/assignments "배정 순번 설정" 다이얼로그(RotationOrderDialog)의 컨테이너 여백을
 *   컴팩트 밀도로 축소(상담/치료 두 목록 영역). 순수 FE 레이아웃 — DDL 0, 비즈로직 0.
 *
 * ── 스코프(밀도만) ──
 *   - 축소 대상(컨테이너 레벨): 파트 제목 하단여백 mb-2→mb-1.5 · 행 간격 space-y-1.5→space-y-1 ·
 *     상담↔치료 섹션 간격 gap-6→gap-3 · 로딩 스피너 py-8→py-6 · 빈 목록 px-2 py-3→py-2.
 *   - 톤 일관: NEWSECTION-COMPACT-DEFAULT(gap-3/p-3) · DOCROSTER-COLWIDTH-COMPACT 선례 스케일.
 *
 * ── 불변(AC-2 회귀 0, 침범 금지) ──
 *   - assign_sort_order 1-based 일괄 UPDATE 저장경로 불변 · round-robin/tie-break 불변 · DDL 0.
 *   - ASSIGNORDER-ARROW-TO-DRAG 드래그 핸들·정렬 조작 UX 불변(밀도만) · activationConstraint distance 8.
 *   - 권한가드(admin/manager/director) + 저장 중 드래그 잠금 유지 · 입력 컨트롤 삭제 없음.
 *
 * 본 spec = 소스 구조 정적 단언(여백 축소가 저장경로/드래그/권한을 깨지 않음).
 *   실렌더(갤탭 실브라우저 밀도 육안 + bundle_hash 실측)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// RotationOrderDialog 본문만 슬라이스(다른 다이얼로그 오염 방지)
function rotationDialogBody(src: string): string {
  const start = src.indexOf('function RotationOrderDialog');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start);
}

// ─────────────────────────────────────────────────────────────────────────────
// A — 컨테이너 여백 컴팩트(AC-1) : 상담/치료 목록 영역 상하 여백·행 간격 축소
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A — 컨테이너 여백 컴팩트(AC-1)', () => {
  test('파트 제목 하단여백 축소 mb-2 → mb-1.5', () => {
    const body = rotationDialogBody(read(PAGE));
    // 파트 제목 줄(직원 수 표기 포함)이 컴팩트 하단여백
    expect(body).toMatch(/className="mb-1\.5 text-sm font-semibold"/);
    // 이전 값(mb-2) 잔존 없음(제목 줄에 한해)
    expect(body).not.toMatch(/className="mb-2 text-sm font-semibold"/);
  });

  test('행 간격 축소 space-y-1.5 → space-y-1 (드래그 목록 세로 간격)', () => {
    const body = rotationDialogBody(read(PAGE));
    expect(body).toMatch(/<div className="space-y-1">/);
    expect(body).not.toMatch(/<div className="space-y-1\.5">/);
  });

  test('상담↔치료 섹션 간격 축소 gap-6 → gap-3 (NEWSECTION 톤 일관)', () => {
    const body = rotationDialogBody(read(PAGE));
    expect(body).toMatch(/className="flex flex-col gap-3 md:flex-row"/);
    expect(body).not.toMatch(/className="flex flex-col gap-6 md:flex-row"/);
  });

  test('로딩/빈 목록 여백 축소 (py-8 → py-6, 빈목록 py-3 → py-2)', () => {
    const body = rotationDialogBody(read(PAGE));
    expect(body).toMatch(/className="flex justify-center py-6"/);
    expect(body).not.toMatch(/className="flex justify-center py-8"/);
    expect(body).toMatch(/className="px-2 py-2 text-xs text-muted-foreground"/);
    expect(body).not.toMatch(/className="px-2 py-3 text-xs text-muted-foreground"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — 드래그 정렬 UX 불변(AC-2) : 밀도만 조정, 조작 UX·핸들 무변경
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B — 드래그 정렬 UX 불변(AC-2)', () => {
  test('드래그 핸들(GripVertical/cursor-grab/touch-none/rotation-handle) 유지', () => {
    const src = read(PAGE);
    expect(src).toMatch(/GripVertical/);
    expect(src).toMatch(/rotation-handle-\$\{testid\}/);
    expect(src).toMatch(/cursor-grab/);
    expect(src).toMatch(/touch-none/);
  });

  test('@dnd-kit 정렬 스택 + activationConstraint distance 8 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/DndContext/);
    expect(src).toMatch(/SortableContext/);
    expect(src).toMatch(/useSortable/);
    expect(src).toMatch(/arrayMove/);
    expect(src).toMatch(/verticalListSortingStrategy/);
    expect(src).toMatch(/PointerSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*8\s*\}/);
  });

  test('▲▼ 화살표 미부활(드래그 방식 유지)', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/rotation-up-/);
    expect(src).not.toMatch(/rotation-down-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — 저장경로/권한 불변(AC-2) : assign_sort_order 1-based 일괄 UPDATE · DDL 0
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C — 저장경로/권한 불변(AC-2)', () => {
  test('저장 = staff.assign_sort_order 1-based 일괄 UPDATE + 저장버튼 유지', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.from\('staff'\)\.update\(\{ assign_sort_order: o\.ord \}\)\.eq\('id', o\.id\)/);
    expect(src).toMatch(/ord: i \+ 1/);
    expect(src).toContain('data-testid="rotation-save-btn"');
  });

  test('권한가드(admin/manager/director) + 저장 중 드래그 잠금 유지', () => {
    const src = read(PAGE);
    expect(src).toMatch(/const canEditRotation =\s*[\s\S]*?role === 'admin'[\s\S]*?'manager'[\s\S]*?'director'/);
    expect(src).toMatch(/if \(!canEdit\) return;/);
    expect(src).toMatch(/canEdit=\{canEdit && !saving\}/);
  });

  test('DDL 0 — 신규 컬럼/테이블 참조 없이 기존 assign_sort_order 재사용', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/ALTER TABLE/);
    expect(src).not.toMatch(/CREATE TABLE/);
  });
});
