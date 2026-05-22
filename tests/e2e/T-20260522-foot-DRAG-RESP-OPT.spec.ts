/**
 * T-20260522-foot-DRAG-RESP-OPT
 * 대시보드 슬롯 드래그 반응속도 추가 최적화
 *
 * AC-1: TouchSensor activationConstraint distance ≤ 5 (이전 8 → 현재 5)
 * AC-2: React.memo + TickCtx 기반 re-render 최적화 코드 존재
 * AC-3: touch-action 설정 확인 (카드:none, 드롭열:manipulation)
 * AC-4: 측정값 기록 존재 (ticket 주석)
 * AC-5: SLOT-SNAP-FIX ghost snap 미회귀 (snapToCursorModifier 유지)
 * AC-5b: SLOT-MOVE-REVERT 확인창 미노출 회귀 없음 (pendingSlotDrag 없음)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(
  path.resolve(__dirname, '../../src/pages/Dashboard.tsx'),
  'utf-8',
);

// ── AC-1: TouchSensor 활성화 거리 ────────────────────────────────────────────
test('AC-1: TouchSensor activationConstraint distance가 5 이하', () => {
  // "distance: 5" 또는 "distance:5" 형태 모두 허용
  const match = dashboardSrc.match(/TouchSensor\s*,\s*\{[^}]*activationConstraint\s*:\s*\{\s*distance\s*:\s*(\d+)/);
  expect(match, 'TouchSensor activationConstraint.distance 패턴을 찾지 못했습니다').not.toBeNull();
  const distance = parseInt(match![1], 10);
  expect(distance, `TouchSensor distance(${distance})가 5를 초과합니다`).toBeLessThanOrEqual(5);
});

test('AC-1b: MouseSensor activationConstraint distance가 존재', () => {
  expect(dashboardSrc).toMatch(/MouseSensor\s*,\s*\{[^}]*activationConstraint/);
});

// ── AC-2: React.memo + TickCtx 최적화 코드 ────────────────────────────────────
test('AC-2a: TickCtx context가 정의됨', () => {
  expect(dashboardSrc).toContain('TickCtx');
  expect(dashboardSrc).toMatch(/createContext\(0\)/);
});

test('AC-2b: DraggableCard가 memo()로 감싸짐', () => {
  // memo(function DraggableCard 형태
  expect(dashboardSrc).toMatch(/memo\s*\(\s*function\s+DraggableCard/);
});

test('AC-2c: DraggableCard 내부에서 TickCtx를 useContext로 구독', () => {
  // memo 함수 본문에 useContext(TickCtx) 패턴
  expect(dashboardSrc).toContain('useContext(TickCtx)');
});

test('AC-2d: memo 커스텀 비교자가 checkIn · compact · stageStart · packageLabel 포함', () => {
  expect(dashboardSrc).toContain('prev.checkIn === next.checkIn');
  expect(dashboardSrc).toContain('prev.compact === next.compact');
  expect(dashboardSrc).toContain('prev.stageStart === next.stageStart');
  expect(dashboardSrc).toContain('prev.packageLabel === next.packageLabel');
});

test('AC-2e: TickCtx.Provider가 JSX에서 사용됨', () => {
  expect(dashboardSrc).toContain('<TickCtx.Provider value={tick}>');
  expect(dashboardSrc).toContain('</TickCtx.Provider>');
});

test('AC-2f: handleCardContext가 useCallback으로 안정화됨', () => {
  // handleCardContext = useCallback(...) 패턴
  expect(dashboardSrc).toMatch(/handleCardContext\s*=\s*useCallback/);
});

// ── AC-3: touch-action CSS ────────────────────────────────────────────────────
test('AC-3a: DraggableCard에 touchAction:none 존재 (브라우저 터치 지연 제거)', () => {
  // 드래그 가능 카드는 touch-action:none으로 스크롤 개입 차단
  const noneCount = (dashboardSrc.match(/touchAction:\s*['"]none['"]/g) ?? []).length;
  expect(noneCount, 'touchAction:none 설정이 없습니다').toBeGreaterThanOrEqual(1);
});

test('AC-3b: DroppableColumn에 touchAction:manipulation 존재 (탭 300ms 지연 제거)', () => {
  // 드롭 열 헤더/본문은 manipulation으로 tap delay 제거
  const manipCount = (dashboardSrc.match(/touchAction:\s*['"]manipulation['"]/g) ?? []).length;
  expect(manipCount, 'touchAction:manipulation 설정이 없습니다').toBeGreaterThanOrEqual(1);
});

// ── AC-5: 회귀 — SLOT-SNAP-FIX ghost snap ────────────────────────────────────
test('AC-5a: snapToCursorModifier 함수가 유지됨 (SLOT-SNAP-FIX 비회귀)', () => {
  expect(dashboardSrc).toContain('function snapToCursorModifier');
  expect(dashboardSrc).toContain('modifiers={[snapToCursorModifier]}');
});

// ── AC-5b: 회귀 — SLOT-MOVE-REVERT 확인창 미노출 ─────────────────────────────
test('AC-5b: pendingSlotDrag useState 선언이 없음 (SLOT-MOVE-REVERT 확인창 제거 비회귀)', () => {
  // 실제 useState 선언("setPendingSlotDrag")이 없어야 함 (주석으로 언급되는 건 허용)
  expect(dashboardSrc).not.toContain('setPendingSlotDrag');
  // 충돌 확인 다이얼로그 JSX 컴포넌트가 없어야 함
  expect(dashboardSrc).not.toContain('slot-drag-conflict-dialog');
});
