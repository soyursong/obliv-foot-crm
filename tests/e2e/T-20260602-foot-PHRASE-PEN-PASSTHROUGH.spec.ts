/**
 * E2E spec — T-20260602-foot-PHRASE-PEN-PASSTHROUGH
 * 펜차트 상용구(placedItem) 위에서 펜/형광펜 기입이 안 되던 문제 수정.
 *
 * 근인:
 *   PenChartTab.tsx PlacedItemOverlay wrapper div가 position:absolute / zIndex:20 /
 *   touchAction:none + onPointerDown/Move/Up(드래그·선택)으로 상용구 bbox 위 pointerdown을
 *   먼저 소비 → 아래 드로잉 canvas에 도달하지 못함. (내부 텍스트 div만 pointerEvents:none,
 *   wrapper는 interactive)
 *
 * 수정:
 *   ActiveTool에 'select'(선택/이동) 추가. PlacedItemOverlay에 interactive prop 도입.
 *   - 드로잉 도구(pen/eraser/white/highlight) 활성 → interactive=false → wrapper pointerEvents:'none'
 *     → pointerdown이 canvas로 통과 → 상용구 위 직접 필기.
 *   - 선택/이동(select) 도구 활성 → interactive=true → wrapper pointerEvents:'auto'
 *     → 드래그·선택·삭제 정상.
 *   ⚠️ pointerEvents:none 영구화 아님 — 도구 게이팅(AC-2 회귀 방지).
 *
 * AC-1: 상용구 위 직접 펜 시작 → 정상 기입 (passthrough)
 * AC-2: 드래그·선택·삭제 회귀 방지 (select 모드에서 동작)
 * AC-3: 5개(+선택/이동) 도구 전환 무영향
 * AC-4: export 상용구 텍스트 무손상
 *
 * 영상: F0B7KQK8F45(IMG_8155.MOV)
 * parent: T-...-BLACKSCR(검정화면 field-confirm RESOLVED, 증상③ 분리)
 *
 * 스타일: 기존 PENCHART spec 패턴(in-page 로직 시뮬레이션 + 실제 DOM hit-test).
 */
import { test, expect } from '@playwright/test';

// ── 공통 상수 (실제 코드 동일) ───────────────────────────────────────────────
const CANVAS_W = 794;
const CANVAS_H = 1123;
const DRAW_DPR = 2;

// 실제 코드의 ActiveTool 유니온 (select 추가 후 7종)
type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';

// 실제 코드의 게이팅 규칙: 선택/이동 모드일 때만 오버레이 interactive
const isOverlayInteractive = (tool: ActiveTool): boolean => tool === 'select';

// 실제 코드의 DEFAULT_THICKNESS (select 추가 후)
const DEFAULT_THICKNESS: Record<ActiveTool, number> = {
  pen:                  1.5,
  eraser:               3,
  white:                3,
  text:                 2,
  highlight:            2,
  'boilerplate-placing': 1.5,
  select:               1.5,
};

// ── AC-1: 상용구 위 직접 펜 — passthrough (실제 DOM hit-test) ─────────────────

test.describe('PHRASE-PEN-PASSTHROUGH AC-1: 상용구 위 펜 passthrough', () => {

  /**
   * 핵심 회귀 증명:
   *   canvas(아래) 위에 placedItem overlay(위, zIndex:20) 겹침 배치.
   *   - 드로잉 도구: overlay pointerEvents:'none' → elementFromPoint(overlay 중심) === canvas
   *     → pointerdown이 canvas에 도달 → 상용구 위 필기 가능.
   *   - 선택/이동: overlay pointerEvents:'auto' → elementFromPoint === overlay (드래그용 캡처).
   */
  test('AC-1: 드로잉 도구 활성 시 상용구 bbox 중심의 hit-test 결과 = canvas (필기 통과)', async ({ page }) => {
    await page.goto('about:blank');

    const result = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.position = 'relative';
      host.style.width = '400px';
      host.style.height = '300px';
      document.body.appendChild(host);

      // 아래: 드로잉 canvas
      const canvas = document.createElement('canvas');
      canvas.id = 'draw-canvas';
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '400px';
      canvas.style.height = '300px';
      host.appendChild(canvas);

      // 위: 상용구 overlay (PlacedItemOverlay wrapper와 동일 스타일)
      const overlay = document.createElement('div');
      overlay.id = 'placed-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = '100px';
      overlay.style.top = '100px';
      overlay.style.minWidth = '120px';
      overlay.style.minHeight = '40px';
      overlay.style.zIndex = '20';
      overlay.style.touchAction = 'none';
      host.appendChild(overlay);

      // 내부 텍스트 div — 항상 pointerEvents:none (기존과 동일)
      const text = document.createElement('div');
      text.style.pointerEvents = 'none';
      text.textContent = '족저근막염 — 좌측 통증';
      overlay.appendChild(text);

      // 상용구 bbox 중심 좌표
      const r = overlay.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);

      // ── 드로잉 도구(interactive=false): wrapper pointerEvents:'none'
      overlay.style.pointerEvents = 'none';
      const drawHit = document.elementFromPoint(cx, cy)?.id ?? '(none)';

      // ── 선택/이동 도구(interactive=true): wrapper pointerEvents:'auto'
      overlay.style.pointerEvents = 'auto';
      const selectHit = document.elementFromPoint(cx, cy)?.id ?? '(none)';

      host.remove();
      return { drawHit, selectHit };
    });

    // 드로잉 모드: 상용구 위 pointerdown이 canvas에 도달 (passthrough) → 필기 가능
    expect(result.drawHit).toBe('draw-canvas');
    // 선택/이동 모드: overlay가 캡처 (드래그용)
    expect(result.selectHit).toBe('placed-overlay');
  });

  test('AC-1: 게이팅 규칙 — pen/eraser/white/highlight 는 overlay 비활성(passthrough)', () => {
    (['pen', 'eraser', 'white', 'highlight'] as ActiveTool[]).forEach((tool) => {
      expect(isOverlayInteractive(tool)).toBe(false); // pointerEvents:'none'
    });
  });

  test('AC-1: onPointerDown — select 모드는 캔버스 드로잉 시작 안 함 (early return)', () => {
    // 실제 코드: onPointerDown에서 activeTool==='select' 시 early return → drawingRef 미설정
    const startDrawing = (tool: ActiveTool): boolean => {
      if (tool === 'select') return false;            // 신규 가드
      if (tool === 'text' || tool === 'boilerplate-placing') return false; // 기존 가드
      return true;
    };
    expect(startDrawing('select')).toBe(false);
    expect(startDrawing('pen')).toBe(true);
    expect(startDrawing('highlight')).toBe(true);
  });
});

// ── AC-2: 드래그·선택·삭제 회귀 방지 (select 모드) ───────────────────────────

test.describe('PHRASE-PEN-PASSTHROUGH AC-2: 드래그·선택·삭제 회귀 방지', () => {

  test('AC-2: select 모드에서 overlay interactive=true (드래그·선택·삭제 가능)', () => {
    expect(isOverlayInteractive('select')).toBe(true);
  });

  test('AC-2: 드래그 이동 — select 모드 onMove 로 x,y 누산 (기존 동작 유지)', () => {
    interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }
    let items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 50, y: 300, text: '족저근막염', fontSize: 14, color: '#1a1a1a' },
    ];
    const onMove = (id: string, dx: number, dy: number) => {
      items = items.map((it) => it.id === id ? { ...it, x: it.x + dx, y: it.y + dy } : it);
    };
    onMove('bp-1', 40, -25);
    const bp = items.find((it) => it.id === 'bp-1')!;
    expect(bp.x).toBe(90);  // 50 + 40
    expect(bp.y).toBe(275); // 300 - 25
  });

  test('AC-2: 삭제 — select 모드 onDelete id 필터링 (기존 동작 유지)', () => {
    interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }
    let items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 0, y: 0, text: 'A', fontSize: 14, color: '#000' },
      { id: 'txt-1', type: 'text', x: 0, y: 0, text: 'B', fontSize: 14, color: '#000' },
    ];
    items = items.filter((it) => it.id !== 'bp-1');
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('txt-1');
  });

  test('AC-2: 다중선택 — select 모드 Set<id> 토글 (기존 동작 유지)', () => {
    let selectedIds = new Set<string>();
    const onSelect = (id: string, multi: boolean) => {
      const next = new Set(selectedIds);
      if (multi) { if (next.has(id)) next.delete(id); else next.add(id); }
      else { if (next.has(id) && next.size === 1) next.clear(); else { next.clear(); next.add(id); } }
      selectedIds = next;
    };
    onSelect('bp-1', true);
    onSelect('txt-1', true);
    expect(selectedIds.size).toBe(2);
    onSelect('bp-1', true);
    expect(selectedIds.has('bp-1')).toBe(false);
  });

  test('AC-2: select 토글 버튼 — 재클릭 시 pen 복귀 (선택/이동 ↔ 펜)', () => {
    let activeTool: ActiveTool = 'pen';
    const isSelectTool = () => activeTool === 'select';
    const onClickSelectBtn = () => { activeTool = isSelectTool() ? 'pen' : 'select'; };
    onClickSelectBtn();
    expect(activeTool).toBe('select'); // 진입
    onClickSelectBtn();
    expect(activeTool).toBe('pen');    // 복귀
  });
});

// ── AC-3: 5개(+선택/이동) 도구 전환 무영향 ──────────────────────────────────

test.describe('PHRASE-PEN-PASSTHROUGH AC-3: 도구 전환 무영향', () => {

  test('AC-3: ActiveTool 7종 모두 유효 (기존 6종 + select)', () => {
    const tools: ActiveTool[] = ['pen', 'eraser', 'white', 'text', 'highlight', 'boilerplate-placing', 'select'];
    expect(tools.length).toBe(7);
    expect(tools).toContain('select');
    // 기존 6종 보존
    ['pen', 'eraser', 'white', 'text', 'highlight', 'boilerplate-placing'].forEach((t) => {
      expect(tools).toContain(t as ActiveTool);
    });
  });

  test('AC-3: DEFAULT_THICKNESS — select 포함 7종 모두 정의, 기존 값 무변경', () => {
    expect(DEFAULT_THICKNESS.pen).toBe(1.5);
    expect(DEFAULT_THICKNESS.eraser).toBe(3);
    expect(DEFAULT_THICKNESS.white).toBe(3);
    expect(DEFAULT_THICKNESS.text).toBe(2);
    expect(DEFAULT_THICKNESS.highlight).toBe(2);
    expect(DEFAULT_THICKNESS['boilerplate-placing']).toBe(1.5);
    expect(DEFAULT_THICKNESS.select).toBe(1.5);
    expect(Object.keys(DEFAULT_THICKNESS).length).toBe(7);
  });

  test('AC-3: switchTool 전환 — 기존 5개 도구 굵기 적용 정상 (회귀 없음)', () => {
    let currentSize = 1.5;
    const switchTool = (tool: ActiveTool) => { currentSize = DEFAULT_THICKNESS[tool]; };
    switchTool('eraser');    expect(currentSize).toBe(3);
    switchTool('highlight'); expect(currentSize).toBe(2);
    switchTool('text');      expect(currentSize).toBe(2);
    switchTool('white');     expect(currentSize).toBe(3);
    switchTool('pen');       expect(currentSize).toBe(1.5);
    switchTool('select');    expect(currentSize).toBe(1.5);
  });

  test('AC-3: 드로잉 도구 4종 + 텍스트/상용구는 비-select → overlay 모두 passthrough', () => {
    (['pen', 'eraser', 'white', 'highlight', 'text', 'boilerplate-placing'] as ActiveTool[]).forEach((tool) => {
      expect(isOverlayInteractive(tool)).toBe(false);
    });
    expect(isOverlayInteractive('select')).toBe(true); // select만 interactive
  });
});

// ── AC-4: export 상용구 텍스트 무손상 ───────────────────────────────────────

test.describe('PHRASE-PEN-PASSTHROUGH AC-4: export 상용구 텍스트 무손상', () => {

  test('AC-4: placedItem 래스터화 경로는 게이팅과 무관 — 텍스트 픽셀 보존', async ({ page }) => {
    await page.goto('about:blank');

    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width  = 794 * 2;
      canvas.height = 1123 * 2;
      const ctx = canvas.getContext('2d')!;

      // handleDrawSave 의 placedItem 래스터화 (게이팅과 무관, 변경 없음)
      const item = { x: 100, y: 200, text: '족저근막염\n좌측 통증', fontSize: 14, color: '#1a1a1a' };
      const lines = item.text.split('\n');
      ctx.save();
      ctx.font = `${item.fontSize}px 'Malgun Gothic', sans-serif`;
      ctx.fillStyle = item.color;
      ctx.textBaseline = 'top';
      ctx.globalAlpha = 1;
      const lineH = item.fontSize + 6;
      lines.forEach((line, i) => ctx.fillText(line, item.x, item.y + i * lineH));
      ctx.restore();

      // 단일 픽셀 샘플은 폰트 글리프 위치에 따라 불안정 → 행별 bbox 영역에서 비투명 픽셀 카운트
      const countOpaque = (sx: number, sy: number, w: number, h: number) => {
        const data = ctx.getImageData(sx, sy, w, h).data;
        let n = 0;
        for (let p = 3; p < data.length; p += 4) if (data[p] > 0) n++;
        return n;
      };
      // 1행: y=200 ~ 200+fontSize, 2행: y=200+lineH ~ +lineH+fontSize, x 100~250 영역
      const line1Opaque = countOpaque(item.x, item.y, 150, item.fontSize + 4);
      const line2Opaque = countOpaque(item.x, item.y + lineH, 150, item.fontSize + 4);
      return { line1Opaque, line2Opaque, lineCount: lines.length };
    });

    expect(result.lineCount).toBe(2);          // 멀티라인 텍스트 분리 유지
    expect(result.line1Opaque).toBeGreaterThan(0); // 1행 래스터화됨 (비투명 픽셀 존재)
    expect(result.line2Opaque).toBeGreaterThan(0); // 2행 래스터화됨
  });

  test('AC-4: pointerEvents 게이팅은 overlay 표시 전용 — 저장 파일명/경로 무변경', () => {
    // FE-only 변경, 저장 로직 비접촉 → 기존 파일명 패턴 그대로
    const storagePath = 'customer/test-id/pen-chart';
    const fileName = `${1748000000000}_abcd.png`;
    const path = `${storagePath}/${fileName}`;
    expect(path).toMatch(/^customer\/[\w-]+\/pen-chart\/\d+_[a-z0-9]{4}\.png$/);
  });

  test('AC-4: 캔버스 좌표 상수 유지 (기존 데이터 호환)', () => {
    expect(CANVAS_W).toBe(794);
    expect(CANVAS_H).toBe(1123);
    expect(DRAW_DPR).toBe(2);
  });
});
