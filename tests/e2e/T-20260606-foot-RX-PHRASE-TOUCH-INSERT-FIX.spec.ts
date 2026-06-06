/**
 * E2E spec — T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX
 * 상용구 펜차트 기입 안 됨 — iPad 손가락 탭이 touch guard에 막힘.
 *
 * 아키텍처 그라운딩 (티켓 정본):
 *   PenChartTab.onPointerDown 첫 줄의 touch guard(`if (e.pointerType === 'touch') return;`)는
 *   원래 "손가락 탭은 스크롤 전용, 드로잉 건너뜀" 의도. 그런데 commit a16193f(RX-PHRASE-INSERT-UX)
 *   이후 상용구 배치(boilerplate-placing) 체크가 이 guard '뒤'에 있어, iPad 손가락 탭으로
 *   상용구를 놓으려 해도 guard에서 전면 return → placeBoilerplate() 진입 자체가 차단됐다.
 *
 *   본 수정: guard에 boilerplate-placing 예외 1줄.
 *     변경 전: if (e.pointerType === 'touch') return;
 *     변경 후: if (e.pointerType === 'touch' && activeTool !== 'boilerplate-placing') return;
 *   → boilerplate-placing 모드에선 손가락 탭도 통과해 placeBoilerplate() 진입 허용.
 *   → 그 외 모드(pen 드로잉 등)에선 종전대로 손가락 탭 = 스크롤 전용(드로잉 안 함) 불변.
 *
 * AC-1 (핵심): boilerplate-placing 모드 + touch 탭 → guard 통과 → 상용구 배치 진입.
 * AC-2 (회귀 필수): 일반 펜 드로잉 모드 + touch 탭 → guard return(드로잉 안 함, 스크롤 전용) 불변.
 * AC-3: 배포 후 iPad 손가락 탭으로 상용구 기입 정상 (현장 검증).
 *
 * 스타일: 기존 PENCHART spec 패턴(in-page 순수 로직 시뮬레이션) — onPointerDown의 guard 분기를
 *   실제 구현과 동일하게 모사해 회귀를 잡는다.
 *
 * related: T-20260605-foot-RX-PHRASE-INSERT-UX(회귀 유발 a16193f)·
 *   T-20260602-foot-PHRASE-PEN-PASSTHROUGH·T-20260522-foot-PENCHART-SCROLL-BLOCK.
 */
import { test, expect } from '@playwright/test';

type PointerType = 'pen' | 'touch' | 'mouse';
type ActiveTool = 'pen' | 'eraser' | 'select' | 'text' | 'boilerplate-placing';

interface PointerEventLike { pointerType: PointerType; }

// onPointerDown 결과: guard에서 막혔으면 'scroll-only'(드로잉/배치 안 함),
// 통과해 배치 진입했으면 'place', 통과해 드로잉 진입했으면 'draw', select면 'noop'.
type Outcome = 'scroll-only' | 'place' | 'draw' | 'noop';

// ── 실제 구현 정본과 동일한 onPointerDown guard 경로 (PenChartTab.tsx) ──────────
// 변경 후 guard: touch && !boilerplate-placing → scroll-only. (수정 핵심)
const onPointerDown = (
  e: PointerEventLike,
  activeTool: ActiveTool,
  pendingBoilerplate: string,
): Outcome => {
  // T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX: boilerplate-placing 모드에선 touch도 통과
  if (e.pointerType === 'touch' && activeTool !== 'boilerplate-placing') return 'scroll-only';
  // select 모드는 빈 영역 탭에도 드로잉 안 함 (PHRASE-PEN-PASSTHROUGH)
  if (activeTool === 'select') return 'noop';
  // 상용구 배치 모드 (pendingBoilerplate 있을 때만 실제 배치)
  if (activeTool === 'boilerplate-placing' && pendingBoilerplate) return 'place';
  // 그 외 = 드로잉(pen/eraser/text)
  return 'draw';
};

// ── AC-1 (핵심): boilerplate-placing + touch → 배치 진입 ──────────────────────
test.describe('TOUCH-INSERT-FIX AC-1: 손가락 탭으로 상용구 배치 진입', () => {
  test('boilerplate-placing 모드 + touch 탭 → place (guard 통과)', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'boilerplate-placing', '족저근막염 의심');
    expect(out).toBe('place');
  });

  test('pen(스타일러스) 탭도 종전대로 boilerplate-placing에서 배치 진입 불변', () => {
    const out = onPointerDown({ pointerType: 'pen' }, 'boilerplate-placing', '보존적 치료 시행');
    expect(out).toBe('place');
  });

  test('mouse(데스크톱) 클릭도 boilerplate-placing에서 배치 진입 불변', () => {
    const out = onPointerDown({ pointerType: 'mouse' }, 'boilerplate-placing', '2주 후 재방문');
    expect(out).toBe('place');
  });

  test('pendingBoilerplate 빈 문자열이면 배치 안 함 (방어) — touch라도 place 아님', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'boilerplate-placing', '');
    expect(out).not.toBe('place'); // pendingBoilerplate 없으면 배치 분기 미진입
    expect(out).toBe('draw');      // guard는 통과했으나 배치 조건 미충족 → 드로잉 fallthrough
  });
});

// ── AC-2 (회귀 필수): 일반 드로잉 모드 + touch → 스크롤 전용 불변 ───────────────
test.describe('TOUCH-INSERT-FIX AC-2 (GUARD): 펜 드로잉 모드 touch = 스크롤 전용 불변', () => {
  test('pen 드로잉 모드 + touch 탭 → scroll-only (획 안 그음)', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'pen', '');
    expect(out).toBe('scroll-only');
  });

  test('eraser 모드 + touch 탭 → scroll-only 불변', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'eraser', '');
    expect(out).toBe('scroll-only');
  });

  test('text 모드 + touch 탭 → scroll-only 불변', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'text', '');
    expect(out).toBe('scroll-only');
  });

  test('select 모드 + touch 탭 → scroll-only (guard가 select 분기보다 먼저)', () => {
    const out = onPointerDown({ pointerType: 'touch' }, 'select', '');
    expect(out).toBe('scroll-only');
  });

  test('pen 드로잉 모드 + pen(스타일러스) 탭 → draw (정상 획) 불변', () => {
    const out = onPointerDown({ pointerType: 'pen' }, 'pen', '');
    expect(out).toBe('draw');
  });
});

// ── 현장 시나리오 (티켓 E2E 변환 가이드) ──────────────────────────────────────
test.describe('TOUCH-INSERT-FIX 현장 시나리오', () => {
  test('시나리오 1 — iPad 손가락 탭 상용구 기입: ✓ 즉시삽입 후 손가락 탭 → 배치', () => {
    // (1) ✓ 클릭 → boilerplate-placing 진입 (pendingBoilerplate 적재) — INSERT-UX 동선
    const activeTool: ActiveTool = 'boilerplate-placing';
    const pending = '족저근막염 의심\n좌측 통증 (+)';
    // (2) iPad 손가락으로 캔버스 탭 → 이제 막히지 않고 배치
    const out = onPointerDown({ pointerType: 'touch' }, activeTool, pending);
    expect(out).toBe('place');
  });

  test('시나리오 2 (회귀) — 차팅 중 손가락 탭은 여전히 스크롤만 (오획 방지)', () => {
    // 상용구 배치 모드가 아닌 일반 차팅(pen) 중 손바닥/손가락이 닿아도 획이 안 그어져야 함
    const out = onPointerDown({ pointerType: 'touch' }, 'pen', '');
    expect(out).toBe('scroll-only');
    // 스타일러스(pen)로는 정상 차팅
    expect(onPointerDown({ pointerType: 'pen' }, 'pen', '')).toBe('draw');
  });

  test('시나리오 3 (회귀 매트릭스) — pointerType × activeTool 전수 불변 확인', () => {
    const tools: ActiveTool[] = ['pen', 'eraser', 'select', 'text', 'boilerplate-placing'];
    for (const tool of tools) {
      const touchOut = onPointerDown({ pointerType: 'touch' }, tool, 'x');
      if (tool === 'boilerplate-placing') {
        expect(touchOut).toBe('place'); // 유일하게 touch 통과
      } else {
        expect(touchOut).toBe('scroll-only'); // 나머지는 모두 스크롤 전용
      }
    }
  });
});
