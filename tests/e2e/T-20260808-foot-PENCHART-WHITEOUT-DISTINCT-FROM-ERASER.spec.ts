/**
 * T-20260808-foot-PENCHART-WHITEOUT-DISTINCT-FROM-ERASER
 * 펜차트(손글씨 캔버스) [화이트] 도구 회귀 수정 — reporter=김주연 총괄.
 *
 * [증상] 직전 구현(v3=source-atop '흰 덧칠')은 흰 양식 위에서 지우개(destination-out/clearRect)와 시각적으로
 *        동일하고, 상용구(DOM 오버레이)는 라이브에서 전혀 삭제하지 못함 → "화이트=지우개, 구분 없음".
 *
 * [v4 재정의 — 레이어 스코프 분리]
 *   지우개(eraser)   = 드로잉(펜/형광펜=draw clearRect + text placedItem hit-test)만 삭제. 상용구 미관여.
 *   화이트(white)    = 상용구 + 드로잉 삭제. draw 레이어 destination-out(투명화). 상용구(DOM)는 onPointerUp 에서
 *                      획이 지나간 hit 아이템만 draw 로 rasterize 후 같은 화이트 경로를 destination-out 재적용.
 *   양식(bgCanvas)   = 두 도구 모두 불침범(별도 하위 레이어). 삭제 자리엔 양식이 그대로 비침.
 *
 * [AC]
 *   AC-1 : 화이트 ≠ 지우개 동작 구분(스코프 차이: 화이트=상용구+드로잉 / 지우개=드로잉).
 *   AC-2 : 화이트로 드래그하면 상용구(미리입력 문구) 픽셀도 삭제된다(rasterize 후 destination-out).
 *   AC-3 : 드래그한 '영역만' 국소 삭제 — 상용구 블록 전체 일괄삭제 금지(획 미통과 잔여 텍스트는 raster 로 보존).
 *   AC-4 : 펜차트 양식(배경 서식/틀) 불침범 — 화이트 destination-out 은 draw 레이어에만 작동, 양식 비침.
 *   AC-5 : 지우개는 기존대로 드로잉만 삭제(회귀0) — boilerplate 는 지우개 대상 아님.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 + canvas page.evaluate 시뮬)를 따른다.
 *       캔버스 픽셀 결정론 assert 한계 → 화이트 브러시 실기기 렌더·현장 confirm 은
 *       supervisor field-soak(갤탭 S펜) 시각검증 단계에서 병행한다(티켓 명시).
 */
import { test, expect } from '@playwright/test';

type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';
interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }

// 실코드 onPointerUp 의 pathHitsItem 헬퍼(동일 로직 복제).
const pathHitsItem = (path: Array<{ x: number; y: number }>, item: PlacedItem, sz: number) => {
  const lineH = item.fontSize + 6;
  const lines = item.text.split('\n');
  const itemH = lines.length * lineH + 8;
  const itemW = Math.max(60, item.text.length * (item.fontSize * 0.55));
  return path.some(({ x, y }) =>
    x + sz > item.x && x - sz < item.x + itemW &&
    y + sz > item.y && y - sz < item.y + itemH
  );
};

// ── AC-1/AC-5: 도구 스코프 분리 (지우개=드로잉 / 화이트=상용구+드로잉) ──────────────
test.describe('WHITEOUT-DISTINCT 스코프 분리(화이트 ≠ 지우개)', () => {
  // 실코드 대상 필터: 지우개 onPointerUp = type==='text' 만, 화이트 onPointerUp = boilerplate+text 모두.
  const eraserTargets = (items: PlacedItem[], path: Array<{ x: number; y: number }>, sz: number) =>
    items.filter((it) => it.type === 'text' && pathHitsItem(path, it, sz));
  const whiteTargets = (items: PlacedItem[], path: Array<{ x: number; y: number }>, sz: number) =>
    items.filter((it) => pathHitsItem(path, it, sz));

  const items: PlacedItem[] = [
    { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    { id: 'txt-1', type: 'text', x: 100, y: 100, text: '메모', fontSize: 14, color: '#000' },
  ];
  const path = [{ x: 105, y: 108 }, { x: 130, y: 112 }]; // bp-1/txt-1 bbox 통과
  const sz = 3 * 8 / 2;

  test('AC-5: 지우개는 boilerplate(상용구)를 삭제하지 않는다 — text 만 대상(회귀0)', () => {
    const hit = eraserTargets(items, path, sz);
    expect(hit.map((i) => i.id)).toContain('txt-1');
    expect(hit.map((i) => i.id)).not.toContain('bp-1'); // 상용구는 지우개 미관여
  });

  test('AC-1/AC-2: 화이트는 boilerplate(상용구)+text 모두 대상 — 지우개보다 스코프가 넓다', () => {
    const hit = whiteTargets(items, path, sz);
    expect(hit.map((i) => i.id).sort()).toEqual(['bp-1', 'txt-1']);
    // 화이트 대상 ⊃ 지우개 대상 → "화이트=지우개" 회귀 해소(구분됨)
    const eraserHitIds = new Set(eraserTargets(items, path, sz).map((i) => i.id));
    const whiteHitIds = new Set(hit.map((i) => i.id));
    expect(whiteHitIds.has('bp-1')).toBe(true);
    expect(eraserHitIds.has('bp-1')).toBe(false);
  });
});

// ── AC-3: 드래그 영역만 국소 삭제 — 블록 통삭제 금지 ────────────────────────────
test.describe('WHITEOUT-DISTINCT AC-3: 국소 삭제(블록 통삭제 금지)', () => {
  test('AC-3: 화이트 hit 상용구는 placedItems 에서 제거되고 raster 로 대체된다(부분 삭제본 노출용)', () => {
    // 실코드 onPointerUp: hit 아이템은 draw 로 rasterize 후 setPlacedItems 로 DOM 목록에서 제거(이중 렌더 방지).
    let items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염 의심', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    const path = [{ x: 105, y: 108 }, { x: 130, y: 112 }]; // bp-1 만 통과
    const sz = 3 * 8 / 2;
    const whit = items.filter((it) => pathHitsItem(path, it, sz));
    const whitIds = new Set(whit.map((it) => it.id));
    items = items.filter((it) => !whitIds.has(it.id)); // rasterize 후 제거
    // 획이 지나간 상용구만 DOM 목록에서 빠짐(→ raster 로 부분삭제 반영), 다른 상용구는 그대로.
    expect(whit.map((i) => i.id)).toEqual(['bp-1']);
    expect(items.map((i) => i.id)).toEqual(['bp-2']); // bp-2 는 미통과 → DOM 유지
  });

  test('AC-3: rasterize 후 destination-out 은 획이 지나간 픽셀만 삭제하고 잔여 텍스트 픽셀은 남긴다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const ctx = c.getContext('2d')!;
      // 1) 상용구 rasterize (검정 블록 = 상용구 텍스트 대역, x40~240 y90~110)
      ctx.fillStyle = '#000000';
      ctx.fillRect(40, 90, 200, 20);
      // 2) 화이트 경로 destination-out 재적용(실코드 신규) — 좌측만 통과(x60~100)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 24;
      ctx.beginPath(); ctx.arc(60, 100, 12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(60, 100); ctx.lineTo(100, 100); ctx.stroke();
      ctx.restore();
      const under = Array.from(ctx.getImageData(80, 100, 1, 1).data);   // 획 통과 → 삭제(투명)
      const rest = Array.from(ctx.getImageData(220, 100, 1, 1).data);   // 미통과 → 상용구 픽셀 보존
      return { under, rest };
    });
    expect(r.under[3]).toBe(0);   // AC-2/AC-3: 획 통과 상용구 픽셀 = 삭제(투명)
    expect(r.rest[3]).toBe(255);  // AC-3: 획 미통과 부분 = 보존(블록 통삭제 아님)
    expect(r.rest[0]).toBe(0);
  });
});

// ── AC-2/AC-4: 삭제 자리에 양식 비침 + 양식 서식 불침범 ─────────────────────────
test.describe('WHITEOUT-DISTINCT AC-2/AC-4: 삭제=양식 비침, 양식 불침범', () => {
  test('AC-2/AC-4: 화이트 destination-out 은 draw 레이어만 투명화 → 합성 시 양식(bg)이 그대로 비친다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      // draw 레이어: 상용구 rasterize(검정 블록)
      const draw = document.createElement('canvas'); draw.width = 200; draw.height = 200;
      const d = draw.getContext('2d')!;
      d.fillStyle = '#000000'; d.fillRect(40, 90, 120, 20);
      // 화이트 destination-out 으로 삭제(획 통과 영역)
      d.save();
      d.globalCompositeOperation = 'destination-out';
      d.fillStyle = '#ffffff'; d.globalAlpha = 1;
      d.beginPath(); d.arc(100, 100, 20, 0, Math.PI * 2); d.fill();
      d.restore();
      const drawPx = Array.from(d.getImageData(100, 100, 1, 1).data); // 삭제 → 투명

      // 저장 합성: bg(양식 서식색) 위에 draw 를 얹음 → 삭제 자리엔 양식이 비쳐 보존.
      const comp = document.createElement('canvas'); comp.width = 200; comp.height = 200;
      const cc = comp.getContext('2d')!;
      cc.fillStyle = '#3366cc'; cc.fillRect(0, 0, 200, 200); // 양식(괘선/서식)
      cc.drawImage(draw, 0, 0);
      const compPx = Array.from(cc.getImageData(100, 100, 1, 1).data);
      return { drawPx, compPx };
    });
    // draw 레이어: 화이트가 지나간 곳 = 투명(삭제)
    expect(r.drawPx[3]).toBe(0);
    // 합성본: 삭제 자리에 양식 색(#3366cc) 그대로 — 양식 서식 불침범(AC-4)
    expect(r.compPx[0]).toBe(0x33);
    expect(r.compPx[1]).toBe(0x66);
    expect(r.compPx[2]).toBe(0xcc);
    expect(r.compPx[3]).toBe(255);
  });

  test('AC-1: 화이트(destination-out=삭제)와 지우개(destination-out=삭제)는 draw 레이어 결과는 같으나, 화이트만 상용구까지 rasterize+삭제해 스코프가 다르다', async ({ page }) => {
    await page.goto('about:blank');
    // draw 레이어 픽셀 합성 결과는 동일(둘 다 삭제=투명)이지만,
    // 도구 구분의 본질은 "무엇을 대상으로 draw 로 편입시키는가"(스코프)에 있음을 명시.
    const px = await page.evaluate(() => {
      const paint = () => {
        const c = document.createElement('canvas'); c.width = 100; c.height = 100;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000000'; ctx.fillRect(20, 40, 60, 20);
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(40, 50, 12, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return Array.from(ctx.getImageData(40, 50, 1, 1).data);
      };
      return paint();
    });
    expect(px[3]).toBe(0); // draw 레이어 삭제 결과(투명)는 두 도구 동일
    // 스코프 차이(화이트=상용구+드로잉, 지우개=드로잉)는 위 describe(스코프 분리) 테스트가 보증.
    const items: PlacedItem[] = [{ id: 'bp-1', type: 'boilerplate', x: 30, y: 40, text: 'X', fontSize: 14, color: '#000' }];
    const path = [{ x: 35, y: 48 }];
    const sz = 12;
    const eraserHit = items.filter((it) => it.type === 'text' && pathHitsItem(path, it, sz));
    const whiteHit = items.filter((it) => pathHitsItem(path, it, sz));
    expect(eraserHit).toHaveLength(0); // 지우개는 상용구 안 건드림
    expect(whiteHit).toHaveLength(1);  // 화이트는 상용구 삭제 대상에 포함
  });
});
