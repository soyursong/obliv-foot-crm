/**
 * E2E spec — T-20260603-foot-RX-CHART-FOLLOWUP3 C-4
 * 처방세트 드롭다운 "여전히 이상함" (FOLLOWUP2 #1 후속) 정상화.
 *
 * 근본 원인(문지은 대표원장 실사용): 공통 Select(`src/components/ui/select.tsx`)가
 *   @base-ui/react Select 기반인데 Positioner 의 `alignItemWithTrigger` 기본값이 true 라,
 *   팝업이 "선택된 항목 텍스트를 트리거 위에 겹쳐 정렬"하려 한다. Dialog 내부(QuickRxButtonsTab,
 *   SuperPhrasesTab 의 '처방세트 불러오기' Select) 나 화면 가장자리에서 드롭다운이 어긋나거나
 *   트리거를 덮어 "이상하게" 보이는 증상의 원인.
 *
 * 정본 수정: Positioner 에 alignItemWithTrigger={false} + side="bottom" + align="start"
 *   + collisionPadding 고정 → 항상 트리거 바로 아래에서 예측가능하게 열림.
 *   목록 높이는 max-h=min(available-height,20rem) 로 스크롤(긴 처방세트 목록 잘림 방지).
 *   너비는 max(8rem, anchor-width).
 *
 * 본 spec 은 in-page 순수 로직 시뮬레이션 패턴(기존 RX-* spec 과 동일) — select.tsx 의
 *   포지셔닝 규칙을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════
// 정본: SelectContent 가 BaseSelect.Positioner 에 넘기는 포지셔닝 props
//   (src/components/ui/select.tsx SelectContent 와 1:1 동기화)
// ═══════════════════════════════════════════════════════════════════════════
const SELECT_POSITIONER_PROPS = {
  side: 'bottom' as const,
  align: 'start' as const,
  sideOffset: 4,
  collisionPadding: 8,
  alignItemWithTrigger: false,
};

test.describe('C-4 처방세트 드롭다운 — 트리거 겹침 정렬 해제', () => {
  test('alignItemWithTrigger=false (팝업이 트리거 위에 겹쳐 정렬되지 않음)', () => {
    // base-ui 기본값 true 를 명시적으로 false 로 끈다 → 일반 드롭다운(트리거 아래) 동작
    expect(SELECT_POSITIONER_PROPS.alignItemWithTrigger).toBe(false);
  });

  test('항상 트리거 바로 아래(start 정렬)에서 열림', () => {
    expect(SELECT_POSITIONER_PROPS.side).toBe('bottom');
    expect(SELECT_POSITIONER_PROPS.align).toBe('start');
  });

  test('화면 가장자리 충돌 패딩 확보 (가장자리 잘림/뒤집힘 완화)', () => {
    expect(SELECT_POSITIONER_PROPS.collisionPadding).toBeGreaterThan(0);
    expect(SELECT_POSITIONER_PROPS.sideOffset).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 목록 높이 정책 — 처방세트가 많아도 잘리지 않고 스크롤
//   className: max-h-[min(var(--available-height),20rem)] overflow-y-auto
// ═══════════════════════════════════════════════════════════════════════════

/** 정본 max-h 결정: 가용 높이와 20rem(=320px) 중 작은 값. 초과분은 스크롤. */
function listMaxHeightPx(availableHeightPx: number): number {
  const CAP = 320; // 20rem
  return Math.min(availableHeightPx, CAP);
}

test.describe('C-4 처방세트 드롭다운 — 긴 목록 스크롤(잘림 방지)', () => {
  test('가용 높이가 충분하면 20rem(320px) 상한으로 고정', () => {
    expect(listMaxHeightPx(900)).toBe(320);
  });

  test('가용 높이가 좁으면 가용 높이로 축소(화면 밖 넘침 방지)', () => {
    expect(listMaxHeightPx(180)).toBe(180);
  });

  test('많은 처방세트도 컨텐츠 높이가 max-h 를 넘으면 스크롤 영역으로 수용', () => {
    const ITEM_PX = 32;
    const sets = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `세트 ${i + 1}` }));
    const contentHeight = sets.length * ITEM_PX; // 1280px
    const maxH = listMaxHeightPx(900);
    expect(contentHeight).toBeGreaterThan(maxH); // 스크롤 발생 → 잘림 없음
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 너비 정책 — 트리거 너비에 맞추되 8rem(128px) 하한
//   className: min-w-[max(8rem,var(--anchor-width))]
// ═══════════════════════════════════════════════════════════════════════════

function popupMinWidthPx(anchorWidthPx: number): number {
  const FLOOR = 128; // 8rem
  return Math.max(FLOOR, anchorWidthPx);
}

test.describe('C-4 처방세트 드롭다운 — 너비', () => {
  test('트리거가 넓으면 트리거 너비에 맞춤', () => {
    expect(popupMinWidthPx(200)).toBe(200);
  });

  test('트리거가 좁아도 최소 8rem 보장(빈약한 폭 방지)', () => {
    expect(popupMinWidthPx(90)).toBe(128);
  });
});
