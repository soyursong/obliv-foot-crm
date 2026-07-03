/**
 * E2E spec — T-20260703-foot-JONGNO-RESV-DND-TOUCH-DNDKIT  (P0, 종로 오픈 리스크#5)
 *
 * 배경: 예약 캘린더 드래그가 HTML5 네이티브 DnD(draggable/dataTransfer/onDrop) 였다.
 *   → 갤럭시탭(터치) 환경에서 드래그 死(HTML5 draggable 은 터치 미지원).
 *   FIX: 롱레(happy-flow-queue)에 이미 이식된 @dnd-kit + TouchSensor 패턴 재사용(기존 라이브러리, 신규 npm 아님).
 *
 * 검증 방식: Reservations.tsx 소스 정적 불변식 가드
 *   (터치 long-press 드래그의 Playwright 브라우저 시뮬은 flaky — foot DnD spec 표준 = 소스 인스펙션.
 *    실기 터치 스모크는 supervisor QA 게이트에서 갤럭시탭 현장 confirm.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SRC = 'src/pages/Reservations.tsx';

// ── AC1: HTML5 네이티브 DnD 제거 → @dnd-kit 이식 ──
test('AC1: HTML5 네이티브 DnD(draggable/dataTransfer) 제거', () => {
  const src = read(SRC);
  // 카드에 HTML5 draggable 속성 없음 (터치死 원인)
  expect(src).not.toContain('draggable={r.status');
  expect(src).not.toContain('draggable={');
  // HTML5 dataTransfer / 네이티브 drop 핸들러 배선 없음
  expect(src).not.toMatch(/e\.dataTransfer/);
  expect(src).not.toMatch(/onDrop=\{/);
  expect(src).not.toMatch(/onDragLeave=\{/);
});

test('AC1: @dnd-kit(DndContext + useDraggable/useDroppable) 이식', () => {
  const src = read(SRC);
  expect(src).toContain("from '@dnd-kit/core'");
  expect(src).toContain('DndContext');
  expect(src).toContain('useDraggable');
  expect(src).toContain('useDroppable');
  // 신규 DnD 라이브러리 미도입 (기존 @dnd-kit 재사용)
  expect(src).not.toContain('react-beautiful-dnd');
  expect(src).not.toContain('react-sortablejs');
  expect(src).not.toContain('@hello-pangea/dnd');
});

// ── AC2: 갤럭시탭(터치) 드래그 = TouchSensor ──
test('AC2: TouchSensor 등록 — 갤럭시탭 터치 드래그 활성', () => {
  const src = read(SRC);
  expect(src).toContain('TouchSensor');
  expect(src).toContain('useSensors');
  expect(src).toContain('useSensor');
});

// ── AC3: 마우스(데스크톱) 드래그 회귀 0 = MouseSensor ──
test('AC3: MouseSensor 등록 — 데스크톱 마우스 드래그 회귀 보전', () => {
  const src = read(SRC);
  expect(src).toContain('MouseSensor');
  // 데스크톱은 5px 이동 즉시 활성(activation distance)
  expect(src).toMatch(/MouseSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*5/);
});

// ── AC4: 짧은 탭 오발동 방지 = TouchSensor activation constraint(delay) ──
test('AC4: 짧은 탭 오발동 방지 — TouchSensor delay activation constraint', () => {
  const src = read(SRC);
  // long-press(500ms) 후에만 드래그 활성 → 짧은 탭은 카드 onClick(상세/선택) 통과
  expect(src).toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*500/);
  expect(src).toContain('tolerance');
});

// ── [reopen RC 회귀가드] 지터-abort config 재유입 차단 ──
// RC(grounded): delay:1000/tolerance:5 → 갤탭S10 1초 롱프레스 중 자연 손가락 지터가 5px 초과
//   → @dnd-kit activation abort → 드래그 미발동(field-soak FAIL). 롱레 칸반 검증 config로 교체.
test('RC가드: TouchSensor 지터-abort config(delay:1000/tolerance:5) 재유입 금지', () => {
  const src = read(SRC);
  // 지터-abort 조합이 다시 들어오면 즉시 RED
  expect(src).not.toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*1000/);
  // 검증된 터치 config: delay 500ms + tolerance 10px (롱레 AdminDashboard 칸반 상시운용값)
  expect(src).toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*500,\s*tolerance:\s*10/);
});

// ── 불변식: confirmed 예약만 드래그(기존 정책 보존) ──
test('불변식: confirmed 예약만 드래그(비확정은 disabled)', () => {
  const src = read(SRC);
  // DraggableResv disabled=r.status!=='confirmed'
  expect(src).toContain("disabled={r.status !== 'confirmed'}");
});

// ── 불변식: 드롭 종료 → 기존 reschedule write 경로 재사용 ──
test('불변식: 드롭 종료 → 기존 reschedule write 경로 재사용', () => {
  const src = read(SRC);
  expect(src).toContain('handleDndEnd');
  expect(src).toMatch(/reschedule\(resId,\s*drop\.dateStr,\s*drop\.time\)/);
});

// ── 불변식: over 하이라이트 = 기존 dropTarget/isDragOver 재사용 ──
test('불변식: over 하이라이트 dropTarget(isDragOver) 로직 재사용', () => {
  const src = read(SRC);
  expect(src).toContain('handleDndOver');
  expect(src).toContain('setDropTarget');
  expect(src).toContain('isDragOver');
});

// ── 불변식: 주간 불가 슬롯 드롭 차단 = droppable disabled(allowed 가드) ──
test('불변식: 주간 불가 슬롯 droppable 비활성(allowed 가드 등가)', () => {
  const src = read(SRC);
  expect(src).toContain('DroppableSlotCell');
  // allowed=false → useDroppable disabled
  expect(src).toContain('disabled: !allowed');
});
