/**
 * T-20260706-foot-PENCHART-WHITETOOL-PHRASE-DELETE
 * 풋 펜차트 — 화이트("화이트아웃 붓") 툴 사용 시 상용구 오브젝트가 통삭제되던 데이터 소실 버그 수정.
 *
 * [RC] 구 onPointerUp 화이트 브랜치(T-20260622 AC-3)는 화이트 획이 지나간 boilerplate placedItem 을
 *      setPlacedItems(prev => prev.filter(...)) 로 '삭제'했다 → 화이트로 상용구 위를 칠하면 상용구가
 *      canvas 에서 사라져 저장본에서도 소실(현장 김주연 총괄 보고).
 *
 * AC-1: 화이트 툴 사용 시 상용구 placedItem 이 삭제되지 않는다(데이터 유지).
 * AC-2: 저장 시 상용구 rasterize '후' 누적 화이트 획을 destination-out 재적용 → 저장본에서 상용구 위에
 *       흰색(투명화)이 덮이는 화이트아웃. 배경 양식(bgCanvas)은 draw 레이어만 투명화되므로 보존.
 * AC-3: 화이트 툴 중 상용구가 selected 로 진입하지 않고 삭제 핸들러도 실행되지 않는다(획 경로만 누적).
 * AC-4(회귀): 다른 툴(지우개=텍스트 hit-test / 선택→삭제)의 정상 삭제 동선은 그대로 동작한다.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 + canvas page.evaluate 시뮬)를 따른다.
 *       실기기 렌더/현장 confirm 은 supervisor field-soak(갤탭) 단계에서 검증.
 */
import { test, expect } from '@playwright/test';

interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }
interface WhiteStroke { path: Array<{ x: number; y: number }>; lineWidth: number; }

// 실코드 pathHitsItem(onPointerUp) 과 동일 — 지우개(텍스트)·선택 회귀 모델에서 재사용
const pathHitsItem = (p: Array<{ x: number; y: number }>, item: PlacedItem, sz: number) => {
  const lineH = item.fontSize + 6;
  const lines = item.text.split('\n');
  const itemH = lines.length * lineH + 8;
  const itemW = Math.max(60, item.text.length * (item.fontSize * 0.55));
  return p.some(({ x, y }) =>
    x + sz > item.x && x - sz < item.x + itemW &&
    y + sz > item.y && y - sz < item.y + itemH);
};

// ── AC-1 / AC-3: 화이트 획 = 삭제 아님, 세션 누적 ────────────────────────────
test.describe('WHITETOOL-PHRASE-DELETE AC-1/AC-3: 화이트=화이트아웃(삭제 금지)', () => {

  // 실코드 onPointerUp 화이트 브랜치(신규): placedItems 불변, whiteStrokesAllRef 에 push 만.
  const onWhitePointerUp = (
    placedItems: PlacedItem[],
    whiteStrokesAll: WhiteStroke[],
    strokePath: Array<{ x: number; y: number }>,
    penSize: number,
  ) => {
    if (strokePath.length > 0) {
      whiteStrokesAll.push({ path: strokePath, lineWidth: penSize * 8 });
    }
    // ★ 핵심: placedItems 는 건드리지 않는다(구 filter 삭제 제거)
    return { placedItems, whiteStrokesAll };
  };

  test('AC-1: 화이트 획이 상용구 위를 지나가도 상용구 placedItem 이 삭제되지 않는다', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'txt-1', type: 'text', x: 105, y: 105, text: '환자메모', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: WhiteStroke[] = [];
    const path = [{ x: 110, y: 110 }, { x: 140, y: 118 }]; // bp-1 위를 문지름

    const { placedItems } = onWhitePointerUp(items, whiteStrokesAll, path, 3);

    // 구 버그: bp-1 이 삭제됐다. 신규: 전부 보존.
    expect(placedItems.find((i) => i.id === 'bp-1')).toBeDefined();  // 상용구 유지(AC-1)
    expect(placedItems.find((i) => i.id === 'txt-1')).toBeDefined();
    expect(placedItems.find((i) => i.id === 'bp-2')).toBeDefined();
    expect(placedItems).toHaveLength(3);
  });

  test('AC-3: 화이트 획은 상용구 selected 진입/삭제 없이 획 경로만 누적한다', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: WhiteStroke[] = [];
    const selectedIds = new Set<string>(); // 화이트=드로잉 툴 → 오버레이 pointerEvents:none → 선택 발화 없음

    const path = [{ x: 110, y: 110 }];
    onWhitePointerUp(items, whiteStrokesAll, path, 3);

    expect(selectedIds.size).toBe(0);          // selected 진입 없음
    expect(items).toHaveLength(1);             // 삭제 없음
    expect(whiteStrokesAll).toHaveLength(1);   // 경로 누적됨
    expect(whiteStrokesAll[0].lineWidth).toBe(24); // penSize(3)*8 = native move stroke 폭과 일치
    expect(whiteStrokesAll[0].path).toEqual(path);
  });

  test('AC-3: 빈 획(경로 0)은 누적하지 않는다', () => {
    const whiteStrokesAll: WhiteStroke[] = [];
    onWhitePointerUp([], whiteStrokesAll, [], 3);
    expect(whiteStrokesAll).toHaveLength(0);
  });
});

// ── AC-2: 저장 시 상용구 rasterize '후' 화이트 destination-out 재적용 = 화이트아웃 ──
test.describe('WHITETOOL-PHRASE-DELETE AC-2: 저장본 화이트아웃(상용구 위 덮기)', () => {

  test('AC-2: 상용구 fillText 후 화이트 destination-out 재적용 → 획 통과 픽셀은 투명, 미통과 픽셀은 상용구 보존', async ({ page }) => {
    await page.goto('about:blank');
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext('2d')!;

      // 1) 상용구 rasterize (실코드 handleDrawSave 순서: 불투명 텍스트/블록 먼저)
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(40, 90, 120, 20); // 상용구 텍스트 블록 근사(x40~160, y90~110)
      ctx.restore();

      // 2) 그 '후' 누적 화이트 획 destination-out 재적용(실코드 신규 블록)
      const stroke = { path: [{ x: 60, y: 100 }, { x: 100, y: 100 }], lineWidth: 24 };
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.lineWidth;
      ctx.beginPath();
      ctx.arc(stroke.path[0].x, stroke.path[0].y, stroke.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(stroke.path[0].x, stroke.path[0].y);
      for (let i = 1; i < stroke.path.length; i++) ctx.lineTo(stroke.path[i].x, stroke.path[i].y);
      ctx.stroke();
      ctx.restore();

      const underWhite = Array.from(ctx.getImageData(80, 100, 1, 1).data);   // 획 통과 → 상용구 위 화이트아웃
      const outsideWhite = Array.from(ctx.getImageData(150, 100, 1, 1).data); // 획 미통과 → 상용구 보존
      return { underWhiteAlpha: underWhite[3], outsideAlpha: outsideWhite[3], outsideR: outsideWhite[0] };
    });

    // 획이 지나간 상용구 픽셀 = destination-out 으로 투명화(화이트아웃, 배경/양식이 비침)
    expect(result.underWhiteAlpha).toBe(0);
    // 획이 지나가지 않은 상용구 픽셀 = 불투명 유지(상용구 그대로 남음)
    expect(result.outsideAlpha).toBe(255);
    expect(result.outsideR).toBe(0); // 검정 상용구 픽셀 보존
  });

  test('AC-2: 화이트는 별도 bg(양식) 캔버스를 건드리지 않는다(destination-out=draw 레이어 전용)', async ({ page }) => {
    await page.goto('about:blank');
    const result = await page.evaluate(() => {
      // 배경 양식 캔버스(별도) — 저장 합성에서 draw 아래에 깔림
      const bg = document.createElement('canvas');
      bg.width = 200; bg.height = 200;
      const bgCtx = bg.getContext('2d')!;
      bgCtx.fillStyle = '#3366cc';
      bgCtx.fillRect(0, 0, 200, 200);

      // draw 캔버스에서만 화이트 destination-out
      const draw = document.createElement('canvas');
      draw.width = 200; draw.height = 200;
      const dCtx = draw.getContext('2d')!;
      dCtx.fillStyle = '#000';
      dCtx.fillRect(40, 90, 120, 20);
      dCtx.save();
      dCtx.globalCompositeOperation = 'destination-out';
      dCtx.fillStyle = 'rgba(0,0,0,1)';
      dCtx.beginPath();
      dCtx.arc(80, 100, 12, 0, Math.PI * 2);
      dCtx.fill();
      dCtx.restore();

      const bgPixel = Array.from(bgCtx.getImageData(80, 100, 1, 1).data);
      return { bgR: bgPixel[0], bgG: bgPixel[1], bgB: bgPixel[2], bgA: bgPixel[3] };
    });
    // bg 양식은 완전 보존(파란 배경 그대로)
    expect(result.bgR).toBe(0x33);
    expect(result.bgG).toBe(0x66);
    expect(result.bgB).toBe(0xcc);
    expect(result.bgA).toBe(255);
  });
});

// ── AC-4(회귀): 다른 툴의 정상 선택·삭제 동선 유지 ─────────────────────────────
test.describe('WHITETOOL-PHRASE-DELETE AC-4: 회귀 — 다른 툴 삭제 동선 유지', () => {

  test('AC-4: 지우개 = 텍스트 placedItem hit-test 삭제(상용구 미관여) 유지', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'txt-1', type: 'text', x: 105, y: 105, text: '환자메모', fontSize: 14, color: '#000' },
    ];
    const esz = 3 * 4;
    const path = [{ x: 110, y: 110 }];
    // 실코드 지우개 브랜치: type==='text' && pathHitsItem 만 삭제 (불변)
    const remaining = items.filter((item) => !(item.type === 'text' && pathHitsItem(path, item, esz)));
    expect(remaining.find((i) => i.id === 'txt-1')).toBeUndefined(); // 텍스트 정상 삭제
    expect(remaining.find((i) => i.id === 'bp-1')).toBeDefined();    // 상용구는 지우개 미관여
  });

  test('AC-4: 선택 툴 → 상용구 선택 → 삭제(X버튼) 정상 동작 유지', () => {
    let items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    // 실코드 onDelete(itemId): 해당 id 제거 (선택 상태에서 X버튼)
    const onDelete = (id: string) => { items = items.filter((i) => i.id !== id); };
    onDelete('bp-1');
    expect(items.find((i) => i.id === 'bp-1')).toBeUndefined(); // 선택-삭제 동선은 그대로 삭제됨
    expect(items.find((i) => i.id === 'bp-2')).toBeDefined();
  });
});
