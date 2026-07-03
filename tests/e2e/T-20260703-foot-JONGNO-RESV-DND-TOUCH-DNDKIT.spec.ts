/**
 * E2E spec — T-20260703-foot-JONGNO-RESV-DND-TOUCH-DNDKIT  (P0, 종로 오픈 리스크#5)
 *
 * 배경: 예약 캘린더 드래그가 HTML5 네이티브 DnD(draggable/dataTransfer/onDrop) 였다.
 *   → 갤럭시탭(터치) 환경에서 드래그 死(HTML5 draggable 은 터치 미지원).
 *   FIX: 롱레(happy-flow-queue)에 이미 이식된 @dnd-kit + TouchSensor 패턴 재사용(기존 라이브러리, 신규 npm 아님).
 *
 * [reopen — RC 규명 + 강화]
 *   RC(grounded, @dnd-kit v6.3.1 core.esm.js L1043-1048 · L1550-1553 · L1460):
 *     TouchSensor delay 제약에서 handleMove 중 hasExceededDistance(delta, tolerance) 이면
 *     handleCancel() 로 activation 을 "영구" abort(재arming 없음). delay:1000/tolerance:5 는
 *     갤탭S10 정전식 패널에서 1000ms 롱프레스 대기 중 자연 손가락 지터가 5px 만 넘어도
 *     드래그가 죽는 config → field-soak FAIL.
 *   해소: delay 1000→400(지터 노출창 단축) · tolerance 5→16(지터 허용폭 확대) 동시 완화.
 *
 * ★ spec 강화(AC5): 종전 "delay 값 존재" 정적검증은 false-green 통로였다(터치 지터 생존을
 *   전혀 검증 못 함 — 값이 있어도 지터에 죽었음). → 아래는 core.esm.js 활성화 로직을 그대로
 *   포팅한 모델에 **소스에서 파싱한 실제 config** 를 주입해 "지터 하 드래그 생존"을 행위로 검증한다.
 *   (실기 갤탭S10 터치 스모크는 supervisor QA 게이트 소유 — 본 spec 은 로직 정합의 결정론적 하한.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SRC = 'src/pages/Reservations.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// grounded 모델: @dnd-kit v6.3.1 core.esm.js 활성화 로직 포팅
//   hasExceededDistance(delta, n)  = Math.sqrt(dx**2 + dy**2) > n   (L1043-1048)
//   handleMove(!activated, delay제약): 초과 시 handleCancel() = 영구 abort (L1550-1553)
//   handleStart 는 setTimeout(delay) 로 발화 → 그 전에 취소 안 되면 드래그 활성 (L1460)
// ─────────────────────────────────────────────────────────────────────────────
type TouchConstraint = { delay: number; tolerance: number };

/** 소스의 TouchSensor activationConstraint 를 파싱(하드코딩 금지 → false-green 차단). */
function parseTouchConstraint(src: string): TouchConstraint | null {
  const m = src.match(
    /TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*(\d+),\s*tolerance:\s*(\d+)/,
  );
  return m ? { delay: Number(m[1]), tolerance: Number(m[2]) } : null;
}

const hasExceededDistance = (dx: number, dy: number, n: number) =>
  Math.sqrt(Math.abs(dx) ** 2 + Math.abs(dy) ** 2) > n;

type Move = { t: number; x: number; y: number };
type Outcome = { activated: boolean; cancelled: boolean; cancelAt?: number };

/**
 * 손가락을 (initial) 에 대고 moves(touchmove 열)를 거쳐 releaseT(touchend 시각, 없으면 계속 누름)까지 홀드.
 * core 로직대로: delay 전 지터가 tolerance 초과 → 영구 abort. 그 전에 안 죽고 delay 도달 → 활성.
 */
function simulateDelayDrag(
  c: TouchConstraint,
  initial: { x: number; y: number },
  moves: Move[],
  releaseT: number | null,
): Outcome {
  for (const m of moves) {
    if (m.t >= c.delay) break; // setTimeout(delay) 이미 발화 → 활성됨
    if (releaseT != null && releaseT <= m.t) break; // 그 전에 손 뗌
    if (hasExceededDistance(initial.x - m.x, initial.y - m.y, c.tolerance)) {
      return { activated: false, cancelled: true, cancelAt: m.t };
    }
  }
  // delay 도달 전 손 떼면 짧은 탭(활성 X) → 카드 onClick 통과
  const activated = releaseT == null || releaseT >= c.delay;
  return { activated, cancelled: false };
}

// 갤탭S10 정전식 패널에서 1000ms 홀드 중 관측되는 수준의 "자연 손가락 지터" 프로파일.
// 초기점 대비 최대 드리프트 ~11.7px(√(10²+6²)) — 종전 tolerance 5px 는 초과(RC 재현),
// 확대된 tolerance 16px 는 생존해야 함.
const INITIAL = { x: 300, y: 300 };
const JITTER: Move[] = [
  { t: 80, x: 306, y: 303 }, // drift √(6²+3²)=6.7
  { t: 170, x: 309, y: 305 }, // drift √(9²+5²)=10.3
  { t: 260, x: 304, y: 308 }, // drift √(4²+8²)=8.9
  { t: 340, x: 310, y: 306 }, // drift √(10²+6²)=11.7 (최대)
];
const maxDrift = Math.max(
  ...JITTER.map((m) => Math.hypot(INITIAL.x - m.x, INITIAL.y - m.y)),
);

// ── AC1: HTML5 네이티브 DnD 제거 → @dnd-kit 이식 ──
test('AC1: HTML5 네이티브 DnD(draggable/dataTransfer) 제거', () => {
  const src = read(SRC);
  expect(src).not.toContain('draggable={r.status');
  expect(src).not.toContain('draggable={');
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
  expect(src).toMatch(/MouseSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*5/);
});

// ── 소스 파싱 sanity: TouchSensor delay 제약 config 존재 ──
test('소스에서 TouchSensor delay/tolerance config 파싱 가능', () => {
  const c = parseTouchConstraint(read(SRC));
  expect(c, 'TouchSensor activationConstraint {delay,tolerance} 파싱 실패').not.toBeNull();
});

// ════════════════════════════════════════════════════════════════════════════
// ★ AC5(강화·핵심): 지터 하 드래그 "생존" 행위 검증 — 정적 값검증(false-green) 대체
// ════════════════════════════════════════════════════════════════════════════
test('AC5: 갤탭S10 자연 손가락 지터 하 — 배포 config 로 드래그 生存(활성)', () => {
  const c = parseTouchConstraint(read(SRC))!;
  // 전제: 사용한 지터 프로파일이 "무의미하지 않음"(옛 tolerance 5px 초과) — 진짜 증인
  expect(maxDrift, `지터 최대 드리프트(${maxDrift.toFixed(1)}px)가 검증 의미가 있으려면 5px 초과여야 함`).toBeGreaterThan(5);
  // 손가락을 계속 누른 채(release=null) delay 창을 지터로 통과 → 반드시 활성(생존), 취소 없음
  const out = simulateDelayDrag(c, INITIAL, JITTER, null);
  expect(out.cancelled, `배포 config(delay:${c.delay},tol:${c.tolerance})에서 지터로 handleCancel abort 발생 — 드래그 死(field-soak FAIL 재현)`).toBe(false);
  expect(out.activated, '지터 통과 후 드래그가 활성되지 않음').toBe(true);
});

test('AC5-RC증인: 동일 지터가 종전 config{delay:1000,tol:5}에선 abort(RC 재현·모델 판별력 보증)', () => {
  // 모델이 실제로 config 를 구분하는지 — 옛 값에선 반드시 죽어야 한다(안 죽으면 테스트 무의미).
  const legacy: TouchConstraint = { delay: 1000, tolerance: 5 };
  const out = simulateDelayDrag(legacy, INITIAL, JITTER, null);
  expect(out.cancelled, '종전 config 에서 지터가 abort 되지 않음 → 모델/지터 프로파일이 RC 를 재현 못 함').toBe(true);
});

test('AC5-탭보존: 짧은 탭(delay 전 손 뗌) → 드래그 미활성 → 카드 onClick 통과', () => {
  const c = parseTouchConstraint(read(SRC))!;
  // 미세 이동(<tolerance) 후 delay 전에 릴리즈 = 탭
  const tap: Move[] = [{ t: 60, x: 302, y: 301 }];
  const out = simulateDelayDrag(c, INITIAL, tap, /* releaseT */ 150);
  expect(out.cancelled).toBe(false);
  expect(out.activated, '짧은 탭이 드래그로 오발동(onClick 소실 위험)').toBe(false);
});

test('AC5-진짜드래그: 홀드 유지(release 없음) → delay 도달 시 드래그 활성', () => {
  const c = parseTouchConstraint(read(SRC))!;
  // tolerance 내 미세 지터만, 계속 누름 → delay 도달 → 활성
  const held: Move[] = [{ t: 100, x: 303, y: 302 }, { t: 300, x: 305, y: 304 }];
  const out = simulateDelayDrag(c, INITIAL, held, null);
  expect(out.activated).toBe(true);
  expect(out.cancelled).toBe(false);
});

// ── [reopen RC 정적 회귀가드] 지터-abort config 재유입 차단(값 레벨 백스톱) ──
test('RC정적가드: 지터-abort config(과도 delay / 과소 tolerance) 재유입 금지', () => {
  const src = read(SRC);
  expect(src).not.toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*1000/);
  expect(src).not.toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*\d+,\s*tolerance:\s*5\b/);
  expect(src).toMatch(/TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*400,\s*tolerance:\s*16/);
});

// ── AC4: 캘린더 세로 스크롤 보존 — touchAction:'none' 은 드래그 카드 한정(컨테이너 아님) ──
test('AC4: touchAction none 은 draggable 카드에만 적용(세로 스크롤 보존)', () => {
  const src = read(SRC);
  // 드래그 카드 style 에만 touchAction:'none' (disabled 카드/컨테이너는 미적용 → 스크롤 살아있음)
  expect(src).toMatch(/touchAction:\s*disabled\s*\?\s*undefined\s*:\s*'none'/);
  // 스크롤 컨테이너를 통째로 touchAction:none 으로 잠그는 배선이 없어야 함
  expect(src).not.toMatch(/overflow[^\n]*touchAction:\s*'none'/);
});

// ── 불변식: confirmed 예약만 드래그(기존 정책 보존) ──
test('불변식: confirmed 예약만 드래그(비확정은 disabled)', () => {
  const src = read(SRC);
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
  expect(src).toContain('disabled: !allowed');
});
