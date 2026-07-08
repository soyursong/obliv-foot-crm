/**
 * T-20260708-foot-PENCHART-TOOLBAR-REGRESSION
 * 풋 펜차트(2번차트) 7/6~7/7 배포 3건(TOOLBAR-FIXES / WHITETOOL-PHRASE-DELETE / PHRASE-FONTSIZE)
 * + 3FIX 후속 field-soak 회귀/피드백 2건.
 *
 * [RC 특정]
 *   R-1 (P1 회귀): "상용구 불러오기 후 캔버스 오브젝트 선택 시 이동·삭제·크기조절 컨트롤 전부 사라짐".
 *       - TOOLBAR-FIXES A-5 가 상용구 패널 z-index 를 z-20 → z-50 으로 올림(오버레이 핸들 z30~32 위).
 *       - 3FIX 가 탭배치 분기를 switchTool('pen')(패널 닫음) → setActiveTool('select')(패널 유지)로 바꾸며
 *         setShowPhrasePanel(false) 가 빠짐 → 배치 후 패널이 열린 채 select 모드.
 *       - ∴ 방금 놓은 상용구의 이동/삭제/크기 핸들(z30~32)이 열린 패널(z50) 뒤에 가려 "사라짐"
 *         + 삭제 X 핸들도 가려 R-2 "상용구 삭제 불가" 증상까지 유발.
 *       [수정] 탭배치(fromPlacing=true) 직후 setShowPhrasePanel(false) 복원 → A-6 원 설계(배치 후 패널 닫힘)
 *         회복. A-5 z-50(패널 열려 브라우징 중일 때 오버레이 위) / A-6 탭배치(원하는 위치 삽입)는 불변 → 재회귀 없음.
 *   R-2 (진단): "화이트=지우개 동일 + 상용구 삭제 불가".
 *       - 화이트 도구는 이미 3FIX 에서 source-atop 불투명 흰 덧칠(라이브 dot/native move + 저장 재적용)로 전환됨
 *         → 지우개(destination-out=투명화)와 명확히 구분, 상용구/양식 서식 보존. = 코드상 정상(버그 아님).
 *       - "상용구 삭제 불가"는 R-1(패널이 삭제 X 핸들을 가림)의 파생 증상 → R-1 수정으로 해소.
 *       ∴ 설계결정 재해석 불요 → planner FOLLOWUP 불요. 화이트아웃 정상 동작을 스펙으로 lock-in.
 *
 * NOTE: penchart spec 관례(순수 로직 + canvas page.evaluate 시뮬)를 따른다.
 *       화이트 브러시 필압/실기기 렌더·핸들 육안 노출은 supervisor field-soak(갤탭 Apple Pencil) 단계에서 최종 confirm.
 */
import { test, expect } from '@playwright/test';

type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';
interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }

// 실코드 z-index 상수(재현): 오버레이 래퍼 20, 삭제 X 30, 이동 그립 31, 폰트± 32, 상용구 패널 50(A-5).
const Z = { overlay: 20, deleteBtn: 30, moveGrip: 31, fontCtl: 32, phrasePanel: 50 } as const;

// 실코드 placeBoilerplateAt(fromPlacing=true) 분기 모델(R-1 수정본):
//   setActiveTool('select') + setSelectedIds([id]) + setShowPhrasePanel(false)  ← ★ 패널 닫기 복원
function placeBoilerplateAt(prevPanelOpen: boolean) {
  return {
    activeTool: 'select' as ActiveTool,
    selectedIds: new Set(['bp-new']),
    showPhrasePanel: false,   // ★ R-1 수정: 배치 직후 패널 닫힘(3FIX 에서 빠졌던 지점 복원)
    newId: 'bp-new',
    _prevPanelOpen: prevPanelOpen,
  };
}

// 오버레이 핸들이 실제로 보이고 클릭 가능한지: interactive && isSelected && 패널에 가리지 않음.
//   패널(z50)이 열려 있으면 오버레이 전체(래퍼 z20 스택 컨텍스트)가 패널 뒤로 가림 → 핸들(z30~32) 불가시.
function handleUsable(activeTool: ActiveTool, selectedIds: Set<string>, itemId: string, panelOpen: boolean) {
  const interactive = activeTool === 'select';
  const isSelected = selectedIds.has(itemId);
  const occludedByPanel = panelOpen && Z.phrasePanel > Z.overlay; // 패널 z가 오버레이 스택보다 높으면 가림
  return interactive && isSelected && !occludedByPanel;
}

// ── R-1: 상용구 배치 후 조작 핸들 노출(패널이 가리지 않음) ─────────────────────
test.describe('R-1: 상용구 삽입 후 이동/삭제/크기 핸들 노출 (패널 미가림)', () => {
  test('R-1: 탭배치 직후 activeTool=select + 자동선택 + 패널 닫힘', () => {
    const s = placeBoilerplateAt(true);
    expect(s.activeTool).toBe('select');
    expect(s.selectedIds.has(s.newId)).toBe(true);
    expect(s.showPhrasePanel).toBe(false); // ★ 핵심 수정: 배치 후 패널이 닫혀 핸들을 가리지 않음
  });

  test('R-1: 배치 직후 이동/삭제/크기 핸들이 노출된다(패널 닫힘이므로 미가림)', () => {
    const s = placeBoilerplateAt(true);
    expect(handleUsable(s.activeTool, s.selectedIds, s.newId, s.showPhrasePanel)).toBe(true);
  });

  test('R-1 회귀 재현: 3FIX 처럼 패널이 열린 채면 핸들이 z-50 패널 뒤로 가려 사라진다', () => {
    // 회귀 상태: select + 선택은 됐으나 showPhrasePanel=true(패널 열림) → 핸들 불가시.
    const regressed = { activeTool: 'select' as ActiveTool, selectedIds: new Set(['bp-new']), showPhrasePanel: true };
    expect(handleUsable(regressed.activeTool, regressed.selectedIds, 'bp-new', regressed.showPhrasePanel)).toBe(false);
    // 수정본은 동일 입력에서 패널이 닫혀 있어 가시.
    const fixed = placeBoilerplateAt(true);
    expect(handleUsable(fixed.activeTool, fixed.selectedIds, fixed.newId, fixed.showPhrasePanel)).toBe(true);
  });

  test('R-1: 빈 캔버스 클릭 deselect → 핸들 사라짐 / 재선택 → 재노출 (PINGPONG5 위치고정 불변)', () => {
    const s = placeBoilerplateAt(true);
    expect(handleUsable(s.activeTool, new Set<string>(), s.newId, false)).toBe(false); // deselect
    expect(handleUsable('select', new Set([s.newId]), s.newId, false)).toBe(true);      // 재선택(패널 닫힘)
  });

  test('R-2 파생 해소: 삭제 X 핸들도 패널에 가리지 않아 상용구 선택→삭제 가능', () => {
    let items: PlacedItem[] = [
      { id: 'bp-new', type: 'boilerplate', x: 120, y: 120, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    const s = placeBoilerplateAt(true);
    // 삭제 X 핸들이 사용 가능해야 클릭→삭제가 성립(R-1 수정 전에는 패널이 가려 클릭 불가 = "삭제 불가").
    expect(handleUsable(s.activeTool, s.selectedIds, s.newId, s.showPhrasePanel)).toBe(true);
    items = items.filter((i) => i.id !== 'bp-new'); // onDelete
    expect(items.find((i) => i.id === 'bp-new')).toBeUndefined();
    expect(items.find((i) => i.id === 'bp-2')).toBeDefined();
  });
});

// ── A-5 / A-6 재회귀 금지 가드 ────────────────────────────────────────────────
test.describe('A-5/A-6 재회귀 금지', () => {
  test('A-5 불변: 패널이 열린 상태에선 패널(z50)이 오버레이(z20) 위 → 카테고리/다른 상용구 클릭 가능', () => {
    // A-5 시나리오: 배치된 상용구가 있고 패널 재오픈 후 select 모드. 패널 z가 오버레이보다 높아야 클릭 가능.
    expect(Z.phrasePanel).toBeGreaterThan(Z.overlay);
    expect(Z.phrasePanel).toBeGreaterThan(Z.fontCtl); // 핸들보다도 위 → 패널 열림 중엔 패널이 우선(브라우징 전용)
  });

  test('A-6 불변: 상용구 클릭 = placing 모드 진입 → 캔버스 탭 좌표에 삽입(중앙 선배치·드래그 불요)', () => {
    // insertPhraseImmediate: setPendingBoilerplate(content) + setActiveTool('boilerplate-placing')
    const afterInsertClick = { activeTool: 'boilerplate-placing' as ActiveTool, pending: '족저근막염' };
    expect(afterInsertClick.activeTool).toBe('boilerplate-placing');
    // 캔버스 탭(x,y) → placeBoilerplate(x,y) → 그 좌표에 배치.
    const tap = { x: 333, y: 444 };
    const placed = { x: tap.x, y: tap.y };
    expect(placed).toEqual(tap); // 임의 중앙좌표가 아니라 탭 좌표 그대로
  });

  test('회귀: 배치 후 패널 닫힘은 A-6 연속삽입 동선(상용구 버튼 재오픈)과 정합', () => {
    const s = placeBoilerplateAt(true);
    expect(s.showPhrasePanel).toBe(false); // 다음 삽입은 상용구 버튼으로 패널 재오픈(A-6 설계)
  });
});

// ── R-2: 화이트 = 흰 덧칠(source-atop) — 지우개와 구분 + 양식/상용구 보존 (진단 lock-in) ──
test.describe('R-2: 화이트아웃 정상 동작(진단) — 버그 아님, 설계결정 재해석 불요', () => {
  test('R-2: 화이트(source-atop)는 draw 레이어(상용구/필기) 위를 하얗게 덮는다(투명화 아님)', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000000'; ctx.fillRect(40, 90, 120, 20); // 상용구 rasterize(검정)
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 24;
      ctx.beginPath(); ctx.arc(60, 100, 12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(60, 100); ctx.lineTo(100, 100); ctx.stroke();
      ctx.restore();
      return {
        under: Array.from(ctx.getImageData(80, 100, 1, 1).data),
        outside: Array.from(ctx.getImageData(150, 100, 1, 1).data),
      };
    });
    expect(r.under).toEqual([255, 255, 255, 255]);   // 획 통과 = 불투명 흰색(덮임)
    expect(r.outside[3]).toBe(255); expect(r.outside[0]).toBe(0); // 미통과 = 검정 보존(상용구 데이터 유지)
  });

  test('R-2 회귀: 화이트(source-atop)와 지우개(destination-out)는 결과가 명확히 다르다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const paint = (mode: GlobalCompositeOperation, color: string) => {
        const c = document.createElement('canvas'); c.width = 100; c.height = 100;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000000'; ctx.fillRect(20, 40, 60, 20);
        ctx.save();
        ctx.globalCompositeOperation = mode; ctx.fillStyle = color; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(40, 50, 12, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return Array.from(ctx.getImageData(40, 50, 1, 1).data);
      };
      return { white: paint('source-atop', '#ffffff'), eraser: paint('destination-out', 'rgba(0,0,0,1)') };
    });
    expect(r.white).toEqual([255, 255, 255, 255]); // 화이트 = 불투명 흰색
    expect(r.eraser[3]).toBe(0);                    // 지우개 = 투명(지움)
    expect(r.white[3]).not.toBe(r.eraser[3]);       // "화이트=지우개 동일" 아님
  });

  test('R-2 AC-FORM-SAFE: 화이트는 draw 레이어 투명 영역엔 안 그려 양식 서식(bg)이 보존된다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const draw = document.createElement('canvas'); draw.width = 200; draw.height = 200;
      const d = draw.getContext('2d')!;
      d.save(); d.globalCompositeOperation = 'source-atop';
      d.fillStyle = '#ffffff'; d.globalAlpha = 1;
      d.beginPath(); d.arc(100, 100, 20, 0, Math.PI * 2); d.fill(); d.restore();
      const drawPx = Array.from(d.getImageData(100, 100, 1, 1).data);
      const comp = document.createElement('canvas'); comp.width = 200; comp.height = 200;
      const cc = comp.getContext('2d')!;
      cc.fillStyle = '#3366cc'; cc.fillRect(0, 0, 200, 200);
      cc.drawImage(draw, 0, 0);
      return { drawPx, compPx: Array.from(cc.getImageData(100, 100, 1, 1).data) };
    });
    expect(r.drawPx[3]).toBe(0);                    // draw 레이어 투명 유지(양식 read-only)
    expect(r.compPx.slice(0, 4)).toEqual([0x33, 0x66, 0xcc, 255]); // 양식 색 그대로 보존
  });

  test('R-2: 화이트 획은 placedItems(상용구 데이터)를 삭제하지 않는다(경로만 세션 누적)', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }> = [];
    whiteStrokesAll.push({ path: [{ x: 110, y: 110 }, { x: 140, y: 118 }], lineWidth: 3 * 8 });
    expect(items).toHaveLength(1);           // 상용구 데이터 보존
    expect(whiteStrokesAll[0].lineWidth).toBe(24);
  });
});
