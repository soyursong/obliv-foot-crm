/**
 * E2E spec — T-20260701-foot-ASSIGNORDER-ARROW-TO-DRAG
 *
 * /admin/assignments "배정 순번 설정" 다이얼로그(RotationOrderDialog)의 순서변경 방식을
 *   ▲▼ 화살표 → @dnd-kit 드래그앤드롭으로 교체.
 *
 * ── 핵심 제약(불변) ──
 *   - 저장경로(assign_sort_order 1-based 일괄 UPDATE) + 배정 엔진 tie-break 일절 변경 금지 → DDL 0.
 *   - 참조 패턴 = QuickRxButtonsTab SortableQuickRxRow(@dnd-kit).
 *   - activationConstraint { distance: 8 } 필수(태블릿 탭 간섭 방지, CHART-TAP-DELAY 교훈).
 *   - 상담↔치료 그룹 간 교차 이동 금지(그룹별 독립 DndContext) — 각 그룹 내 재정렬만.
 *   - 권한가드(canEditRotation admin/manager/director) + RLS 유지. GripVertical 핸들, ▲▼ 제거, 드래그 시각강조.
 *
 * 본 spec = 소스 구조 정적 단언(정렬방식 교체가 저장경로/권한/그룹격리를 깨지 않음).
 *   실렌더(갤탭 실브라우저 드래그→저장→재배정 반영)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// A — @dnd-kit 도입 (화살표 → 드래그) · 신규 패키지 금지(이미 설치)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A — @dnd-kit 드래그 교체', () => {
  test('@dnd-kit core/sortable/utilities import (신규 패키지 금지, 기설치 재사용)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/from '@dnd-kit\/core'/);
    expect(src).toMatch(/from '@dnd-kit\/sortable'/);
    expect(src).toMatch(/from '@dnd-kit\/utilities'/);
    expect(src).toMatch(/DndContext/);
    expect(src).toMatch(/SortableContext/);
    expect(src).toMatch(/useSortable/);
    expect(src).toMatch(/arrayMove/);
    expect(src).toMatch(/verticalListSortingStrategy/);
  });

  test('▲▼ 화살표 완전 제거 — ArrowUp/ArrowDown import·사용 없음', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/ArrowUp/);
    expect(src).not.toMatch(/ArrowDown/);
    expect(src).not.toMatch(/rotation-up-/);
    expect(src).not.toMatch(/rotation-down-/);
    // 기존 move(list,setList,idx,dir) 스왑 헬퍼도 제거
    expect(src).not.toMatch(/idx \+ dir/);
  });

  test('각 행에 GripVertical 드래그 핸들(rotation-handle testid)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/GripVertical/);
    expect(src).toMatch(/rotation-handle-\$\{testid\}/);
    expect(src).toMatch(/cursor-grab/);
    expect(src).toMatch(/touch-none/); // 태블릿 탭 오인식 방지
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — activationConstraint distance 8 (탭↔드래그 구분, CHART-TAP-DELAY 교훈)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B — activationConstraint distance 8', () => {
  test('PointerSensor activationConstraint { distance: 8 }', () => {
    const src = read(PAGE);
    expect(src).toMatch(/PointerSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*8\s*\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — 그룹 격리 (상담↔치료 교차 이동 금지) · 그룹별 독립 DndContext
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C — 그룹 내 재정렬만(교차 이동 금지)', () => {
  test('renderList 안에서 그룹 목록만 DndContext/SortableContext 로 감쌈 → 그룹별 독립', () => {
    const src = read(PAGE);
    // renderList(공용 렌더러)가 DndContext 를 포함 → 상담·치료 각각 별도 DndContext 인스턴스로 렌더
    const rl = src.slice(src.indexOf('const renderList'));
    const body = rl.slice(0, rl.indexOf('\n  );') + 5);
    expect(body).toMatch(/<DndContext/);
    expect(body).toMatch(/<SortableContext[\s\S]*items=\{list\.map\(\(s\) => s\.id\)\}/);
    // 그룹 인자(list/setList)만 다루는 재정렬 → 다른 그룹 배열은 건드리지 않음
    expect(body).toMatch(/handleDragEnd\(list, setList\)/);
  });

  test('handleDragEnd = 전달받은 list 내부에서만 arrayMove(교차 배열 접근 없음)', () => {
    const src = read(PAGE);
    const fn = src.slice(src.indexOf('const handleDragEnd'));
    const body = fn.slice(0, fn.indexOf('\n  };') + 4);
    expect(body).toMatch(/setList\(arrayMove\(list, oldIdx, newIdx\)\)/);
    // over/active 를 같은 list 에서 findIndex → 다른 그룹 id 는 -1 로 걸러짐(교차 이동 무효)
    expect(body).toMatch(/list\.findIndex/);
    expect(body).toMatch(/if \(oldIdx === -1 \|\| newIdx === -1\) return;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — 저장경로 불변 (assign_sort_order 1-based 일괄 UPDATE) · DDL 0
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D — 저장경로/엔진 불변', () => {
  test('저장 = staff.assign_sort_order 위치(1-based) 일괄 UPDATE — 변경 없음', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.from\('staff'\)\.update\(\{ assign_sort_order: o\.ord \}\)\.eq\('id', o\.id\)/);
    expect(src).toMatch(/ord: i \+ 1/); // 위치 → 1-based 순번(consult/therapy 파트별)
    // 드래그는 로컬 순서만 변경 → 실제 DB 반영은 여전히 [순번 저장] 버튼
    expect(src).toContain('data-testid="rotation-save-btn"');
  });

  test('DB 스키마 마이그 신규 추가 없음(UI 조작 방식만 교체 → DDL 0)', () => {
    const src = read(PAGE);
    // 신규 컬럼/테이블/RPC 참조 없이 기존 assign_sort_order 재사용만
    expect(src).not.toMatch(/ALTER TABLE/);
    expect(src).not.toMatch(/CREATE TABLE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — 권한가드 + 실패 롤백/토스트 유지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('E — 권한가드 · 실패 토스트', () => {
  test('canEditRotation = admin/manager/director + save 내부 재가드 유지', () => {
    const src = read(PAGE);
    expect(src).toMatch(/const canEditRotation =\s*[\s\S]*?role === 'admin'[\s\S]*?'manager'[\s\S]*?'director'/);
    expect(src).toMatch(/if \(!canEdit\) return;/);
  });

  test('드래그 핸들은 canEdit(편집권한)일 때만 노출 + 저장 중 비활성', () => {
    const src = read(PAGE);
    // SortableRotationRow 핸들은 canEdit 조건부 렌더
    const start = src.indexOf('function SortableRotationRow');
    const body = src.slice(start, src.indexOf('function RotationOrderDialog', start));
    expect(body).toMatch(/canEdit &&/);
    // renderList 에서 canEdit={canEdit && !saving} 로 저장 중 드래그 잠금
    expect(src).toMatch(/canEdit=\{canEdit && !saving\}/);
  });

  test('드래그 중 시각 강조 + 저장 실패 시 토스트(기존 save 경로 유지)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/isDragging \? 0\.4 : 1/); // 드래그 중 강조
    expect(src).toMatch(/ring-2 ring-primary/);    // 드래그 중 링 강조
    expect(src).toMatch(/toast\.error\(`순번 저장 실패/);
    expect(src).toMatch(/toast\.success\('배정 순번을 저장했습니다/);
  });
});
