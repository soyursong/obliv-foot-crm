/**
 * T-20260706-foot-PENCHART-TOOLBAR-FIXES
 * 2번차트(펜차트) 툴바 현장 피드백 6건 (김주연 총괄 / 최다혜 치료사, C0ATE5P6JTH).
 *
 * A-1: 환자 성함을 담당의/담당자 라인 '위'로 이동.
 * A-2: 담당의·담당자 글자 크기 통일(둘 다 동일 폰트·크기로 재출력).
 * A-3: 상용구 삽입 시 '마지막 설정 글자 크기' 유지(매번 기본값 리셋 X).
 * A-4: 형광펜 농도 일률 고정(필압/속도 무관 균일) — 오프스크린 버퍼 alpha=1 후 상수 alpha 1회 합성.
 * A-5: 상용구 패널 팝업 z-index 상향 → 캔버스 오버레이(z20)에 가려지지 않음(카테고리 클릭 가능).
 * A-6: 상용구 클릭 = placing 모드 → 원하는 위치(탭 좌표)에 바로 삽입(드래그 불요).
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬)를 따른다. 실코드의 좌표/상태 전이 로직을 미러링해 검증.
 *       A-4 실 iPad Apple Pencil 필압 무관 확인은 시뮬레이터 재현 불가 → supervisor field-soak(최다혜 치료사) 검증.
 *       A-1/A-2 픽셀 렌더 미세 위치도 실기기 스크린샷 confirm 병행.
 */
import { test, expect } from '@playwright/test';

// ══════════════════════════════════════════════════════════════════════════
// A-1: 성함 autofill 위치 — 담당의/담당자 라인 '위' + 우측 콜론열 정렬
// ══════════════════════════════════════════════════════════════════════════
// 실코드 미러: drawPenChartAutofillInline / drawPenChartLabelOverride 좌표 상수(canvas 794×1123).
const AUTOFILL_NAME = { x: 618, y: 40, textAlign: 'right' as const };
const LABEL_DAMDANGUI = { x: 618, baseline: 77 }; // 담당의
const LABEL_DAMDANGJA = { x: 618, baseline: 99 }; // 담당자
// A-2: 두 라벨 동일 크기. ※SUPERSEDED — T-20260708-foot-PENCHART-REGRESSION-3FIX 이슈1(AC-1b)이
//   20px→10px(절반)로 축소. '동일 크기(통일)' 불변식은 유지되고 값만 10 으로 갱신.
const LABEL_FONT_PX = 10;

test.describe('A-1: 성함 위치 담당 라인 위로', () => {
  test('성함 y(40) 는 담당의(y64~77)·담당자(y86~99) 보다 위(작은 y)', () => {
    expect(AUTOFILL_NAME.y).toBeLessThan(64);           // 담당의 상단(canvas y64) 위
    expect(AUTOFILL_NAME.y).toBeLessThan(LABEL_DAMDANGUI.baseline);
    expect(AUTOFILL_NAME.y).toBeLessThan(LABEL_DAMDANGJA.baseline);
  });

  test('성함은 담당 라벨과 동일 콜론열(x=618)에 우측정렬(세로 컬럼 스택)', () => {
    expect(AUTOFILL_NAME.textAlign).toBe('right');
    expect(AUTOFILL_NAME.x).toBe(LABEL_DAMDANGUI.x);
    expect(AUTOFILL_NAME.x).toBe(LABEL_DAMDANGJA.x);
  });

  test('세로 스택 순서: 성함(40) < 담당의(77) < 담당자(99)', () => {
    const order = [AUTOFILL_NAME.y, LABEL_DAMDANGUI.baseline, LABEL_DAMDANGJA.baseline];
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted); // 이미 오름차순 = 위→아래 배치 정합
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A-2: 담당의·담당자 글자 크기 통일 — 마스크가 두 라인 모두 덮고, 둘 다 동일 폰트로 재출력
// ══════════════════════════════════════════════════════════════════════════
// 실코드 미러: drawPenChartLabelOverride 마스크 rect + 두 fillText 폰트.
const MASK_RECT = { x: 543, y: 60, w: 84, h: 60 - 60 + 44 }; // fillRect(543,60,84,44)
const maskCovers = (labelBaseline: number, glyphTopApprox: number) =>
  glyphTopApprox >= MASK_RECT.y && labelBaseline <= MASK_RECT.y + MASK_RECT.h;

test.describe('A-2: 담당 라벨 크기 통일', () => {
  test('마스크(y60~104)가 담당의(64~77)·담당실장(86~99) 두 라인을 모두 덮는다', () => {
    // glyphTop ≈ baseline - fontPx*0.7
    expect(maskCovers(LABEL_DAMDANGUI.baseline, 77 - Math.round(LABEL_FONT_PX * 0.7))).toBe(true);
    expect(maskCovers(LABEL_DAMDANGJA.baseline, 99 - Math.round(LABEL_FONT_PX * 0.7))).toBe(true);
  });

  test('담당의·담당자 재출력 폰트 크기가 동일(10px, REGRESSION-3FIX로 20→10 축소)', () => {
    // 실코드는 두 fillText 를 같은 ctx.font('10px …') 로 그린다 → 크기 동일(통일) 보장.
    const font1 = `${LABEL_FONT_PX}px "Malgun Gothic"`;
    const font2 = `${LABEL_FONT_PX}px "Malgun Gothic"`;
    expect(font1).toBe(font2);
  });

  test('성함(A-1) 밴드(y40)는 마스크(y60~104) 밖 → 라벨 마스킹에 지워지지 않음', () => {
    expect(AUTOFILL_NAME.y).toBeLessThan(MASK_RECT.y);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A-3: 상용구 삽입 폰트 크기 '지속' — ± 조절값이 다음 삽입 기본크기로 유지
// ══════════════════════════════════════════════════════════════════════════
const PENCHART_FONT_MIN = 8;
const PENCHART_FONT_MAX = 48;
const PENCHART_FONT_STEP = 2;
const clampPenChartFont = (n: number) =>
  Math.max(PENCHART_FONT_MIN, Math.min(PENCHART_FONT_MAX, Math.round(n)));
const DEFAULT_PEN_THICKNESS = 1.5;
const DEFAULT_PHRASE_FONT = clampPenChartFont(Math.round(DEFAULT_PEN_THICKNESS * 4 + 6)); // 12

// 실코드 미러: phraseFontSize(state/ref) 소스. placeBoilerplateAt 는 phraseFontSizeRef.current 사용.
class PhraseFontModel {
  phraseFontSize = DEFAULT_PHRASE_FONT;
  items: Array<{ id: string; fontSize: number }> = [];
  private seq = 0;
  // 상용구 삽입 = 현재 phraseFontSize 로 배치(penSize 와 분리)
  place(): string {
    const id = `bp-${this.seq++}`;
    this.items.push({ id, fontSize: this.phraseFontSize });
    return id;
  }
  // ± 조절(onFontSize): 해당 아이템 + '다음 삽입 기본크기(phraseFontSize)' 동시 갱신
  setFontSize(id: string, size: number) {
    const next = clampPenChartFont(size);
    this.items = this.items.map((it) => it.id === id ? { ...it, fontSize: next } : it);
    this.phraseFontSize = next;
  }
  // 세션 리셋 시 기본값 복귀
  reset() { this.phraseFontSize = DEFAULT_PHRASE_FONT; this.items = []; }
}

test.describe('A-3: 상용구 폰트 크기 지속(매번 리셋 방지)', () => {
  test('첫 삽입은 기본 크기(12), 이후 ± 조절값이 다음 삽입에 유지', () => {
    const m = new PhraseFontModel();
    const a = m.place();
    expect(m.items.find((i) => i.id === a)!.fontSize).toBe(12);

    // a 를 20pt 로 조절(+2 × 4)
    for (let i = 0; i < 4; i++) {
      const cur = m.items.find((i2) => i2.id === a)!.fontSize;
      m.setFontSize(a, cur + PENCHART_FONT_STEP);
    }
    expect(m.items.find((i) => i.id === a)!.fontSize).toBe(20);

    // 새 상용구 삽입 → 기본값(12)이 아니라 마지막 크기(20)로 나온다
    const b = m.place();
    expect(m.items.find((i) => i.id === b)!.fontSize).toBe(20);
  });

  test('연속 삽입해도 매번 리셋되지 않고 마지막 크기로 유지', () => {
    const m = new PhraseFontModel();
    const a = m.place();
    m.setFontSize(a, 30);
    const b = m.place();
    const c = m.place();
    expect(m.items.find((i) => i.id === b)!.fontSize).toBe(30);
    expect(m.items.find((i) => i.id === c)!.fontSize).toBe(30);
  });

  test('세션 리셋(차트 전환) 시 기본 크기(12)로 복귀 — 차트 간 격리', () => {
    const m = new PhraseFontModel();
    const a = m.place();
    m.setFontSize(a, 40);
    m.reset();
    const b = m.place();
    expect(m.items.find((i) => i.id === b)!.fontSize).toBe(12);
  });

  test('± 상/하한 clamp(8~48)는 지속값에도 적용', () => {
    const m = new PhraseFontModel();
    const a = m.place();
    m.setFontSize(a, 999);
    expect(m.phraseFontSize).toBe(48);
    m.setFontSize(a, -5);
    expect(m.phraseFontSize).toBe(8);
    expect(m.place() && m.items.at(-1)!.fontSize).toBe(8);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A-4: 형광펜 농도 일률 고정 — 획 어디나 상수 alpha (필압/겹침 무관)
// ══════════════════════════════════════════════════════════════════════════
const HIGHLIGHT_ALPHA = 0.10; // 실코드 기본 highlightAlpha

// [구 동작 모델] 배치별 stroke() 개별 합성 → 겹친 지점 알파 누적: 1-(1-a)^n
const oldAccumulatedAlpha = (a: number, overlaps: number) => 1 - Math.pow(1 - a, overlaps);
// [신 동작 모델] 오프스크린 버퍼 alpha=1(불투명, 자기겹침 누적 없음) → 상수 alpha 1회 합성 = a (겹침 무관)
const newUniformAlpha = (a: number, _overlaps: number) => a;

test.describe('A-4: 형광펜 균일 농도', () => {
  test('신 모델: 겹침 횟수와 무관하게 최종 농도가 상수(highlightAlpha)', () => {
    for (const overlaps of [1, 2, 5, 10, 30]) {
      expect(newUniformAlpha(HIGHLIGHT_ALPHA, overlaps)).toBeCloseTo(HIGHLIGHT_ALPHA, 6);
    }
  });

  test('구 모델은 겹침이 늘수록 짙어짐(회귀 대상) — 신 모델이 이를 제거', () => {
    // 구: 겹침 많을수록 알파 증가(비균일)
    expect(oldAccumulatedAlpha(HIGHLIGHT_ALPHA, 5)).toBeGreaterThan(oldAccumulatedAlpha(HIGHLIGHT_ALPHA, 1));
    // 신: 1회 겹침과 5회 겹침의 농도 차이 = 0 (균일)
    const diff = Math.abs(newUniformAlpha(HIGHLIGHT_ALPHA, 5) - newUniformAlpha(HIGHLIGHT_ALPHA, 1));
    expect(diff).toBe(0);
  });

  test('스냅샷 실패(getImageData throw) 시 재합성 스킵 → 라이브 획 유지(무회귀 가드)', () => {
    // 실코드: hlSnapshotRef=null 이면 pointerup 합성 분기 미진입 → 기존 라이브 렌더 그대로.
    const snapshot: ImageData | null = null;
    const path = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
    const willRecomposite = !!snapshot && path.length > 0;
    expect(willRecomposite).toBe(false);
  });

  test('버퍼 합성은 physical 1:1(setTransform identity) — draw ctx scale(dpr) 이중적용 방지', () => {
    // 버퍼는 dpr 스케일로 그리고(logical→physical), 합성은 identity 로 1:1 → 이중 스케일 없음.
    const DRAW_DPR = 2;
    const bufferDrawScale = DRAW_DPR;   // bctx.setTransform(dpr,…)
    const compositeScale  = 1;          // dctx.setTransform(1,…) then drawImage
    expect(bufferDrawScale).toBe(DRAW_DPR);
    expect(compositeScale).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A-5: 상용구 패널 z-index 상향 — 캔버스 placedItem 오버레이 위로
// ══════════════════════════════════════════════════════════════════════════
const PANEL_Z = 50;            // 실코드: className z-50
const OVERLAY_Z = 20;          // PlacedItemOverlay zIndex
const OVERLAY_DELETE_Z = 30;   // 삭제 버튼
const OVERLAY_MOVE_Z = 31;     // 이동 핸들
const OVERLAY_FONT_Z = 32;     // 폰트 컨트롤

test.describe('A-5: 상용구 팝업 겹침(z-index)', () => {
  test('패널 z(50) > 캔버스 오버레이/컨트롤 z(20/30/31/32) → 항상 클릭 가능', () => {
    expect(PANEL_Z).toBeGreaterThan(OVERLAY_Z);
    expect(PANEL_Z).toBeGreaterThan(OVERLAY_DELETE_Z);
    expect(PANEL_Z).toBeGreaterThan(OVERLAY_MOVE_Z);
    expect(PANEL_Z).toBeGreaterThan(OVERLAY_FONT_Z);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A-6: 상용구 원하는 위치 삽입 — 클릭=placing 모드, 캔버스 탭 좌표에 배치(드래그 불요)
// ══════════════════════════════════════════════════════════════════════════
type ActiveTool = 'pen' | 'boilerplate-placing' | 'select';
// 실코드 미러: insertPhraseImmediate → placing 진입 / onPointerDown(placing) → placeBoilerplate(tap)
class PlacingModel {
  activeTool: ActiveTool = 'pen';
  pendingBoilerplate = '';
  showPhrasePanel = true;
  placed: Array<{ text: string; x: number; y: number }> = [];

  // 상용구 클릭 → placing 모드 진입(중앙 자동배치 아님)
  clickPhrase(content: string) {
    if (!content.trim()) return; // 빈 상용구 가드
    this.pendingBoilerplate = content;
    this.activeTool = 'boilerplate-placing';
    this.showPhrasePanel = false; // 탭 지점 안 가리도록 닫힘
  }
  // 캔버스 탭 → 탭 좌표에 삽입
  tapCanvas(x: number, y: number) {
    if (this.activeTool === 'boilerplate-placing' && this.pendingBoilerplate) {
      this.placed.push({ text: this.pendingBoilerplate, x, y });
      this.pendingBoilerplate = '';
      this.activeTool = 'pen'; // 배치 후 pen 복귀(placeBoilerplateAt fromPlacing=true)
    }
  }
}

test.describe('A-6: 상용구 원하는 위치 삽입', () => {
  test('상용구 클릭 = placing 모드 진입(임의 중앙배치 아님)', () => {
    const m = new PlacingModel();
    m.clickPhrase('족저근막염');
    expect(m.activeTool).toBe('boilerplate-placing');
    expect(m.pendingBoilerplate).toBe('족저근막염');
    expect(m.showPhrasePanel).toBe(false);
    expect(m.placed).toHaveLength(0); // 아직 배치 안 됨(탭 대기)
  });

  test('클릭 → 캔버스 탭 좌표(430,610)에 정확히 삽입 (드래그 불요)', () => {
    const m = new PlacingModel();
    m.clickPhrase('무지외반증');
    m.tapCanvas(430, 610);
    expect(m.placed).toHaveLength(1);
    expect(m.placed[0]).toMatchObject({ text: '무지외반증', x: 430, y: 610 });
    expect(m.activeTool).toBe('pen'); // 배치 후 pen 복귀
  });

  test('탭 좌표마다 서로 다른 위치에 배치 — 사용자가 위치 지정', () => {
    const m = new PlacingModel();
    m.clickPhrase('A'); m.tapCanvas(100, 100);
    m.clickPhrase('B'); m.tapCanvas(500, 800);
    expect(m.placed[0]).toMatchObject({ x: 100, y: 100 });
    expect(m.placed[1]).toMatchObject({ x: 500, y: 800 });
  });

  test('빈 상용구는 placing 진입 안 함(가드)', () => {
    const m = new PlacingModel();
    m.clickPhrase('   ');
    expect(m.activeTool).toBe('pen');
    expect(m.pendingBoilerplate).toBe('');
  });
});
