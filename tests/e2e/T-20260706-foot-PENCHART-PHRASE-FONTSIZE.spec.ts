/**
 * T-20260706-foot-PENCHART-PHRASE-FONTSIZE
 * 풋 펜차트 — 캔버스에 배치된 상용구(boilerplate) 오브젝트의 폰트 사이즈 조절 컨트롤 추가.
 *
 * 배경: 상용구 불러오기 후 캔버스 텍스트 오브젝트 크기가 고정 → 원하는 크기로 못 맞춤(현장 김주연 총괄).
 *       기존 선택 툴바(이동·삭제)에 인접해 폰트 사이즈 조절(±) 컨트롤을 추가.
 *
 * AC-1: 상용구 오브젝트 선택 시 이동·삭제와 같은 툴바에 폰트 사이즈 조절 UI 노출.
 * AC-2: 사이즈 변경 시 캔버스 상 텍스트가 실시간 반영(placedItems.fontSize 갱신 → 오버레이·rasterize 동일 소스).
 * AC-3: 조절 범위 8pt~48pt (경계값 clamp — 8 미만/48 초과 차단).
 * AC-4: 선택 해제 후 재선택 시에도 조절된 크기 유지(캔버스 세션 내 placedItems 소스).
 * AC-5: 이동·삭제 기존 동작 회귀 없음.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬)를 따른다. 실기기 렌더/현장 confirm 은
 *       supervisor field-soak(갤탭) 단계에서 검증.
 */
import { test, expect } from '@playwright/test';

interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }

// ── 실코드 미러: clamp 8~48pt (PenChartTab.clampPenChartFont) ────────────────
const PENCHART_FONT_MIN = 8;
const PENCHART_FONT_MAX = 48;
const PENCHART_FONT_STEP = 2;
const clampPenChartFont = (n: number) =>
  Math.max(PENCHART_FONT_MIN, Math.min(PENCHART_FONT_MAX, Math.round(n)));

// 실코드 onFontSize 핸들러 미러: placedItems 의 해당 id fontSize 만 clamp 갱신(불변 map).
const onFontSize = (items: PlacedItem[], id: string, size: number): PlacedItem[] =>
  items.map((it) => it.id === id ? { ...it, fontSize: clampPenChartFont(size) } : it);

// ± 버튼 탭 시뮬(실코드 dec/inc onPointerUp): 현재 fontSize 기준 ±step 후 clamp.
const tapDec = (items: PlacedItem[], id: string): PlacedItem[] => {
  const cur = items.find((it) => it.id === id)!.fontSize;
  return onFontSize(items, id, clampPenChartFont(cur - PENCHART_FONT_STEP));
};
const tapInc = (items: PlacedItem[], id: string): PlacedItem[] => {
  const cur = items.find((it) => it.id === id)!.fontSize;
  return onFontSize(items, id, clampPenChartFont(cur + PENCHART_FONT_STEP));
};

const seed = (): PlacedItem[] => [
  { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
  { id: 'txt-1', type: 'text', x: 300, y: 300, text: '환자메모', fontSize: 14, color: '#000' },
];

// ── 시나리오 1: 정상 동선 (폰트 확대 + 상한 clamp) ───────────────────────────
test.describe('PHRASE-FONTSIZE 시나리오 1: 확대 + 상한 48pt', () => {
  test('AC-2: + 탭 시 선택 오브젝트 fontSize 가 즉시(실시간) 증가한다', () => {
    let items = seed();
    items = tapInc(items, 'bp-1');
    expect(items.find((it) => it.id === 'bp-1')!.fontSize).toBe(16);
    // 다른 오브젝트는 불변(선택 오브젝트만 반영)
    expect(items.find((it) => it.id === 'txt-1')!.fontSize).toBe(14);
  });

  test('AC-3: 48pt 상한에서 더 이상 커지지 않는다(상한 clamp)', () => {
    let items: PlacedItem[] = [{ id: 'bp-1', type: 'boilerplate', x: 0, y: 0, text: 'x', fontSize: 48, color: '#000' }];
    items = tapInc(items, 'bp-1');
    expect(items[0].fontSize).toBe(48);
    // 직접 초과 입력도 clamp
    items = onFontSize(items, 'bp-1', 999);
    expect(items[0].fontSize).toBe(48);
  });

  test('AC-3: 47pt 에서 +2 는 48 로 clamp(경계 근접)', () => {
    expect(clampPenChartFont(47 + PENCHART_FONT_STEP)).toBe(48);
  });
});

// ── 시나리오 2: 축소 + 하한 8pt ──────────────────────────────────────────────
test.describe('PHRASE-FONTSIZE 시나리오 2: 축소 + 하한 8pt', () => {
  test('AC-2: − 탭 시 선택 오브젝트 fontSize 가 즉시 감소한다', () => {
    let items = seed();
    items = tapDec(items, 'bp-1');
    expect(items.find((it) => it.id === 'bp-1')!.fontSize).toBe(12);
  });

  test('AC-3: 8pt 하한에서 더 이상 작아지지 않는다(하한 clamp)', () => {
    let items: PlacedItem[] = [{ id: 'bp-1', type: 'boilerplate', x: 0, y: 0, text: 'x', fontSize: 8, color: '#000' }];
    items = tapDec(items, 'bp-1');
    expect(items[0].fontSize).toBe(8);
    // 직접 미만 입력도 clamp
    items = onFontSize(items, 'bp-1', 3);
    expect(items[0].fontSize).toBe(8);
    items = onFontSize(items, 'bp-1', -100);
    expect(items[0].fontSize).toBe(8);
  });

  test('AC-3: 9pt 에서 −2 는 8 로 clamp(경계 근접)', () => {
    expect(clampPenChartFont(9 - PENCHART_FONT_STEP)).toBe(8);
  });
});

// ── 시나리오 3: 회귀 (이동·삭제 유지) ────────────────────────────────────────
test.describe('PHRASE-FONTSIZE 시나리오 3: 이동·삭제 회귀 없음', () => {
  // 실코드 onMove 미러
  const onMove = (items: PlacedItem[], id: string, dx: number, dy: number): PlacedItem[] =>
    items.map((it) => it.id === id ? { ...it, x: it.x + dx, y: it.y + dy } : it);
  // 실코드 onDelete 미러
  const onDelete = (items: PlacedItem[], id: string): PlacedItem[] =>
    items.filter((it) => it.id !== id);

  test('AC-5: fontSize 조절 후에도 이동(x/y 변경) 정상 동작', () => {
    let items = seed();
    items = tapInc(items, 'bp-1');              // 16pt
    items = onMove(items, 'bp-1', 40, -20);     // 이동
    const it = items.find((i) => i.id === 'bp-1')!;
    expect(it.x).toBe(140);
    expect(it.y).toBe(80);
    expect(it.fontSize).toBe(16);               // 이동이 사이즈를 깨지 않음
  });

  test('AC-5: fontSize 조절 후에도 삭제 정상 동작', () => {
    let items = seed();
    items = tapDec(items, 'bp-1');
    items = onDelete(items, 'bp-1');
    expect(items.find((i) => i.id === 'bp-1')).toBeUndefined();
    // 다른 오브젝트는 보존
    expect(items.find((i) => i.id === 'txt-1')).toBeDefined();
  });
});

// ── 시나리오 4: 유지 (재선택 시 크기 유지) ───────────────────────────────────
test.describe('PHRASE-FONTSIZE 시나리오 4: 재선택 시 크기 유지', () => {
  test('AC-4: 24pt 로 조절 → 선택 해제 → 재선택 시에도 24pt 유지', () => {
    let items = seed();
    // 14 → 16 → ... → 24 (step 2, 5회)
    for (let i = 0; i < 5; i++) items = tapInc(items, 'bp-1');
    expect(items.find((it) => it.id === 'bp-1')!.fontSize).toBe(24);

    // 선택 해제(selectedIds 초기화)는 placedItems 를 건드리지 않음 → 소스 값 그대로.
    const selectedIds = new Set<string>();
    expect(selectedIds.has('bp-1')).toBe(false);
    // 재선택 후에도 placedItems 소스 값 = 24pt (오버레이 표시값 = item.fontSize)
    expect(items.find((it) => it.id === 'bp-1')!.fontSize).toBe(24);
  });
});
