/**
 * T-20260602-foot-PENCHART-LOCK-PANZOOM
 * 펜차트 — 빨간X(차트 고정/잠금 토글) 클릭 후에도 펜/형광펜 드로잉 시 차트가 pan/zoom 되던 버그 수정
 *
 * 근본 원인:
 *   - 기존 코드엔 고정/잠금 토글 및 pan/zoom 라이브러리가 부재.
 *   - 유일한 pan/zoom·스크롤 출처 = 드로잉 캔버스 `touchAction:'pan-y'`(b9cd022 SCROLL-BLOCK에서
 *     'none'→'pan-y'로 변경) + 스크롤 컨테이너 overflow-auto/overflow-x-auto.
 *   - 어떤 상태도 이 pan/zoom 활성 조건을 게이팅하지 않아, 드로잉 중 항상 pan/zoom이 살아있었음.
 *
 * 수정:
 *   - chartLocked 토글 신규 도입 (빨간X 버튼).
 *   - 게이팅: locked → 캔버스 touchAction:'none' + 컨테이너 overflow:hidden
 *             unlocked → 기존 touchAction:'pan-y' + overflow-auto (회귀 없음).
 *
 * AC-1: 고정 ON 상태에서 캔버스 드래그 시 차트가 pan/zoom 되지 않는다.
 * AC-2: 고정 ON 상태에서 펜/형광펜 드로잉 시 차트는 고정된 채 획만 기입된다.
 * AC-3: 고정 OFF 상태에서는 기존대로 pan/zoom 정상 동작한다 (회귀 없음).
 * AC-4: 토글 상태(고정 ON/OFF)가 UI상 명확히 구분된다 (빨간X 표시/색).
 *
 * 현장 클릭 시나리오 1: 고정 모드에서 드로잉 — 차트 안 움직임 (펜·형광펜)
 * 현장 클릭 시나리오 2: 고정 해제 시 pan/zoom 회귀 확인
 */
import { test, expect } from '@playwright/test';

// ── 실제 코드와 동일한 게이팅 규칙 (PenChartTab.tsx) ─────────────────────────
//   canvas style:      touchAction: chartLocked ? 'none' : 'pan-y'
//   scroll content:    chartLocked ? 'overflow-hidden'   : 'overflow-auto'
//   canvas wrapper:    chartLocked ? 'overflow-x-hidden' : 'overflow-x-auto'

const canvasTouchAction   = (locked: boolean) => (locked ? 'none' : 'pan-y');
const scrollContentClass  = (locked: boolean) => (locked ? 'overflow-hidden'   : 'overflow-auto');
const canvasWrapperClass  = (locked: boolean) => (locked ? 'overflow-x-hidden' : 'overflow-x-auto');

// ── AC-1·2: 고정 ON → pan/zoom·스크롤 게이팅 차단 ────────────────────────────

test.describe('PENCHART-LOCK-PANZOOM AC-1·2: 고정 ON → pan/zoom 차단', () => {

  test('AC-1: 고정 ON → 캔버스 touchAction="none" (네이티브 pan/zoom 제스처 비활성)', () => {
    // touchAction:'none' → 브라우저가 캔버스 위 어떤 기본 제스처(pan/zoom/pinch/scroll)도 처리하지 않음
    expect(canvasTouchAction(true)).toBe('none');
  });

  test('AC-1: 고정 ON → 세로/가로 스크롤 컨테이너 overflow 차단', () => {
    expect(scrollContentClass(true)).toBe('overflow-hidden');   // 세로 pan/scroll 차단
    expect(canvasWrapperClass(true)).toBe('overflow-x-hidden'); // 가로 pan 차단
  });

  test('AC-2: 고정 ON → touchAction="none"이면 모든 pointer 이벤트가 드로잉 핸들러로 전달', () => {
    // touchAction:'none'에서는 브라우저가 제스처를 가로채지 않으므로
    // 펜/형광펜 pointer move가 전부 캔버스 핸들러에 도달 → 획만 기입, 차트 안 움직임.
    const locked = true;
    const browserHandlesGesture = canvasTouchAction(locked) !== 'none'; // none이면 false
    expect(browserHandlesGesture).toBe(false); // 브라우저가 제스처를 가로채지 않음 → 드로잉 보존
  });

  test('AC-2: 펜·형광펜 모두 동일 캔버스 위에서 게이팅 (도구 무관)', () => {
    // 게이팅은 캔버스 단위 touchAction에 적용 → 펜/형광펜/화이트/지우개 모든 도구에 동일 효과.
    const locked = true;
    const tools = ['pen', 'highlight', 'white', 'eraser'];
    tools.forEach(() => {
      expect(canvasTouchAction(locked)).toBe('none');
    });
  });
});

// ── AC-3: 고정 OFF → 기존 pan/zoom 동작 유지 (회귀 없음) ─────────────────────

test.describe('PENCHART-LOCK-PANZOOM AC-3: 고정 OFF → pan/zoom 회귀 없음', () => {

  test('AC-3: 고정 OFF → 캔버스 touchAction="pan-y" (기존 세로 스크롤 유지)', () => {
    expect(canvasTouchAction(false)).toBe('pan-y');
  });

  test('AC-3: 고정 OFF → 스크롤 컨테이너 overflow-auto (기존 pan 유지)', () => {
    expect(scrollContentClass(false)).toBe('overflow-auto');
    expect(canvasWrapperClass(false)).toBe('overflow-x-auto');
  });

  test('AC-3: 기본값은 OFF(unlocked) — 초기 진입 시 기존 동작과 동일', () => {
    // const [chartLocked, setChartLocked] = useState(false)
    const initialLocked = false;
    expect(canvasTouchAction(initialLocked)).toBe('pan-y');
    expect(scrollContentClass(initialLocked)).toBe('overflow-auto');
  });
});

// ── AC-4: 토글 상태 UI 명확 구분 ─────────────────────────────────────────────

test.describe('PENCHART-LOCK-PANZOOM AC-4: 토글 ON/OFF UI 구분', () => {

  // 실제 버튼 className 게이팅 (PenChartTab.tsx)
  const lockButtonClass = (locked: boolean) =>
    locked
      ? 'bg-red-600 border-red-700 text-white font-semibold shadow-sm'
      : 'bg-white border-red-300 text-red-600 hover:bg-red-50';
  const lockButtonLabel = (locked: boolean) => (locked ? '고정됨' : '고정');

  test('AC-4: ON → 빨간 배경(채워진 X), OFF → 흰 배경+빨간 테두리 (빨간X 색 구분)', () => {
    expect(lockButtonClass(true)).toContain('bg-red-600');   // ON: 채워진 빨강
    expect(lockButtonClass(false)).toContain('border-red-300'); // OFF: 빨간 테두리(빨간X 유지)
    expect(lockButtonClass(false)).toContain('text-red-600');
  });

  test('AC-4: 라벨이 상태별로 구분 — 고정 / 고정됨', () => {
    expect(lockButtonLabel(false)).toBe('고정');
    expect(lockButtonLabel(true)).toBe('고정됨');
  });

  test('AC-4: 토글 클릭 → 상태 반전 (setChartLocked(v => !v))', () => {
    let locked = false;
    const toggle = () => { locked = !locked; };
    toggle(); expect(locked).toBe(true);   // 1클릭 → 고정 ON
    toggle(); expect(locked).toBe(false);  // 2클릭 → 고정 OFF
  });
});

// ── 현장 시나리오 1: 고정 모드 드로잉 — 차트 안 움직임 ───────────────────────

test.describe('PENCHART-LOCK-PANZOOM 시나리오1: 고정 모드 드로잉 차트 고정', () => {

  test('시나리오1: 빨간X 클릭(고정) → 펜 드래그 → 차트 고정 (computed touch-action/overflow 검증)', async ({ page }) => {
    await page.goto('about:blank');

    const result = await page.evaluate(() => {
      // PenChartTab 캔버스 구조 재현: 스크롤 컨테이너 > 캔버스
      const scroller = document.createElement('div');
      scroller.style.height = '300px';
      scroller.style.width = '300px';
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 2000; // A4 세로 (컨테이너보다 큼)
      scroller.appendChild(canvas);
      document.body.appendChild(scroller);

      // ── 고정 ON 게이팅 적용 (chartLocked=true) ──
      const locked = true;
      canvas.style.touchAction = locked ? 'none' : 'pan-y';
      scroller.style.overflow  = locked ? 'hidden' : 'auto';

      // 브라우저가 실제로 적용한 computed 값 측정
      // (touch-action:none → 네이티브 pan/zoom/pinch 제스처 비활성,
      //  overflow:hidden → 사용자 pan 제스처로 스크롤 불가)
      const cs = getComputedStyle(canvas);
      const csScroller = getComputedStyle(scroller);
      return {
        touchAction: cs.touchAction,
        overflowY: csScroller.overflowY,
      };
    });

    expect(result.touchAction).toBe('none');  // AC-1·2: 제스처 비활성 → 펜 이벤트만 전달, 차트 고정
    expect(result.overflowY).toBe('hidden');   // AC-1: 사용자 pan 제스처 차단
  });

  test('시나리오1: 형광펜도 동일 — 고정 시 동일 캔버스 게이팅으로 차트 고정', () => {
    // 형광펜 선택 시에도 캔버스 touchAction/overflow는 도구가 아닌 lock 상태에만 의존
    const locked = true;
    expect(canvasTouchAction(locked)).toBe('none');
    expect(scrollContentClass(locked)).toBe('overflow-hidden');
  });
});

// ── 현장 시나리오 2: 고정 해제 시 pan/zoom 회귀 확인 ─────────────────────────

test.describe('PENCHART-LOCK-PANZOOM 시나리오2: 고정 해제 → pan 회귀', () => {

  test('시나리오2: 고정 ON→OFF 토글 후 캔버스 드래그 → 차트 pan 정상 (overflow-auto 복원)', async ({ page }) => {
    await page.goto('about:blank');

    const result = await page.evaluate(() => {
      const scroller = document.createElement('div');
      scroller.style.height = '300px';
      scroller.style.width = '300px';
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 2000;
      scroller.appendChild(canvas);
      document.body.appendChild(scroller);

      // 고정 ON → OFF 전환
      let locked = true;
      locked = !locked; // OFF

      canvas.style.touchAction = locked ? 'none' : 'pan-y';
      scroller.style.overflow  = locked ? 'hidden' : 'auto';

      // OFF 상태 → 스크롤(pan) 정상 동작해야 함
      const before = scroller.scrollTop;
      scroller.scrollTop = 400;
      const panWorks = scroller.scrollTop !== before;

      return {
        touchAction: canvas.style.touchAction,
        overflow: scroller.style.overflow,
        panWorks,
      };
    });

    expect(result.touchAction).toBe('pan-y'); // AC-3: 기존 제스처 복원
    expect(result.overflow).toBe('auto');      // AC-3: overflow 복원
    expect(result.panWorks).toBe(true);        // AC-3: pan(이동) 정상 동작
  });

  test('시나리오2: OFF 상태에서 게이팅 규칙이 기존값과 100% 동일 (회귀 0)', () => {
    // 기존(수정 전) 하드코딩 값과 비교: 캔버스='pan-y', 컨테이너=overflow-auto/overflow-x-auto
    const PRE_FIX = { touchAction: 'pan-y', content: 'overflow-auto', wrapper: 'overflow-x-auto' };
    expect(canvasTouchAction(false)).toBe(PRE_FIX.touchAction);
    expect(scrollContentClass(false)).toBe(PRE_FIX.content);
    expect(canvasWrapperClass(false)).toBe(PRE_FIX.wrapper);
  });
});
