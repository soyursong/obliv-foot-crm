/**
 * T-20260522-foot-SLOT-SNAP-FIX
 * 대시보드 슬롯 드래그 ghost ↔ 실제 터치 포인트 정렬 보정
 *
 * AC-1: snapToCursorModifier 코드가 Dashboard.tsx에 존재
 * AC-2: DragOverlay에 modifiers prop이 연결됨
 * AC-3: getEventCoordinates 가 @dnd-kit/utilities 에서 import됨
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

// AC-1: snapToCursorModifier 구현 존재
test('AC-1: snapToCursorModifier 함수가 Dashboard.tsx에 정의됨', () => {
  expect(dashboardSrc).toContain('function snapToCursorModifier');
  expect(dashboardSrc).toContain('draggingNodeRect.width / 2');
  expect(dashboardSrc).toContain('draggingNodeRect.height / 2');
});

// AC-2: DragOverlay에 modifiers prop 연결
test('AC-2: DragOverlay에 snapToCursorModifier modifiers 적용됨', () => {
  expect(dashboardSrc).toContain('modifiers={[snapToCursorModifier]}');
});

// AC-3: getEventCoordinates import
test('AC-3: getEventCoordinates가 @dnd-kit/utilities에서 import됨', () => {
  expect(dashboardSrc).toContain('getEventCoordinates');
  expect(dashboardSrc).toMatch(/from '@dnd-kit\/utilities'/);
});

// AC-4: transform.x / transform.y 보정 로직 존재
test('AC-4: transform x/y 보정 로직이 포함됨', () => {
  expect(dashboardSrc).toContain('transform.x + coords.x');
  expect(dashboardSrc).toContain('transform.y + coords.y');
});
