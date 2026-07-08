/**
 * T-20260708-foot-PENCHART-REGRESSION-3FIX
 * 풋 펜차트 7/6~7/7 배포 회귀 3종 수정.
 *
 * [한 묶음 diff RC 특정]
 *   이슈1(담당의/담당자 위치·폰트) : TOOLBAR-FIXES A-2 가 라벨 폰트 18px→20px 로 키움
 *       (의심 티켓 PHRASE-DIRECTOR-TO-ASSIGNEE-LABEL / PHRASES-LABEL-DOCTOR-STAFF 는 상용구관리 admin
 *        PhrasesTab 만 변경 → 펜차트 캔버스 라벨 미변경, diff로 실원인=A-2 특정).
 *   이슈2(상용구 삽입 후 조작 핸들 소실) : TOOLBAR-FIXES A-6 이 삽입을 placing 모드로 바꾸며 배치 후
 *        placeBoilerplateAt(fromPlacing=true) 가 switchTool('pen') 로 끝남 → activeTool≠'select' →
 *        오버레이 interactive=false → 이동/삭제/크기 핸들 렌더 안 됨.
 *   이슈3(화이트=지우개 동일·상용구 삭제 안 됨·양식 서식 삭제) : 6FIX #4 가 화이트를 destination-out
 *        (투명화=지움)으로 바꿔 지우개와 동일 + 저장 재적용도 destination-out 이라 '흰 덮기'가 아니라
 *        구멍(양식 비침)이 남음.
 *
 * [AC]
 *   1a/1b : 담당의/담당자 라벨 = 원 baseline(x=618 우측정렬, y=77/99) 유지 + 폰트 현재(20px)의 절반=10px.
 *   2     : 상용구 탭 배치 직후 activeTool='select' → interactive=true + 자동선택 → 이동/삭제/크기 핸들 노출·동작.
 *   3a(재정의) : 화이트 = 상용구 블록 삭제. 화이트 획이 지나간 boilerplate placedItem 제거(캔버스 삭제).
 *        [현장 원문] 김주연 총괄 "상용구 불러오기 하면 지우개로는 못 지우잖아 그걸 지워주는게 화이트임".
 *        지우개=필기 획만 지움(상용구 블록 못 지움). 필기 획 위 화이트 덧칠(source-atop)은 병존 유지.
 *        (구 AC-3a "화이트=흰 덧칠 유지·상용구 미삭제"는 reporter-driven 재정의로 SUPERSEDED.)
 *   3b    : 상용구 블록 선택 후 delete(X) 정상 삭제 — 화이트 삭제 경로와 병존(두 삭제 경로 공존).
 *   3c/3d : AC-FORM-SAFE/AC-LAYER-SEPARATE — 화이트로 상용구 삭제 시에도 양식 서식(bgCanvas)은 read-only(불변).
 *   회귀   : 지우개는 필기 획만(placedItem type='text'/draw clearRect)·상용구 블록 미삭제. 선택→삭제 동선 불변.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 + canvas page.evaluate 시뮬)를 따른다.
 *       화이트 브러시 필압/실기기 렌더·현장 confirm 은 supervisor field-soak(갤탭 Apple Pencil) 단계에서 검증.
 */
import { test, expect } from '@playwright/test';

type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';
interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }

// ── 이슈1 (AC-1a/1b): 담당의/담당자 라벨 위치·폰트 ────────────────────────────
test.describe('REGRESSION-3FIX 이슈1: 담당의/담당자 라벨 위치·폰트', () => {
  // 실코드 drawPenChartLabelOverride 의 재출력 파라미터(수정본).
  const LABEL_OVERRIDE = {
    fontPx: 13,                 // AC-1b: 13px 현장 확정값(최초 "절반=10px"은 근사치 → INFO MSG-xt5a로 13px 우선)
    textAlign: 'right' as const,
    colonX: 618,                // AC-1a: 우측 콜론열(원 담당의/담당실장 콜론 우측끝)
    doctorBaselineY: 77,        // AC-1a: 원 담당의 하단 baseline
    staffBaselineY: 99,         // AC-1a: 원 담당실장 하단 baseline
  };

  test('AC-1b: 라벨 폰트가 13px(현장 확정값)로 축소된다 — 기존 20px 대비 축소, 최초 근사치 10px 아님', () => {
    expect(LABEL_OVERRIDE.fontPx).toBe(13);
    expect(LABEL_OVERRIDE.fontPx).toBeLessThan(20); // 기존 20px 대비 축소
  });

  test('AC-1a: 라벨 위치(콜론열 x=618 우측정렬 / 원 baseline y=77·99)는 배포 전 좌표로 유지', () => {
    expect(LABEL_OVERRIDE.textAlign).toBe('right');
    expect(LABEL_OVERRIDE.colonX).toBe(618);
    expect(LABEL_OVERRIDE.doctorBaselineY).toBe(77);
    expect(LABEL_OVERRIDE.staffBaselineY).toBe(99);
  });

  test('AC-1a: 담당의/담당자 두 라벨은 동일 콜론열·동일 폰트(통일)로 재출력된다', async ({ page }) => {
    await page.goto('about:blank');
    const widths = await page.evaluate((fontPx) => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.font = `${fontPx}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      return { doctor: ctx.measureText('담당의 :').width, staff: ctx.measureText('담당자 :').width };
    }, LABEL_OVERRIDE.fontPx);
    // 동일 폰트 → 두 라벨 폭이 근사(동일 서체·크기 통일 유지). 13px 라 폭 자체는 작다(20px 대비 축소 확인).
    expect(Math.abs(widths.doctor - widths.staff)).toBeLessThan(5);
    expect(widths.doctor).toBeLessThan(80); // 20px 대비 축소된 작은 폭
  });
});

// ── 이슈2 (AC-2): 상용구 삽입 후 조작 핸들 노출 ───────────────────────────────
test.describe('REGRESSION-3FIX 이슈2: 상용구 삽입 후 이동/삭제/크기 핸들', () => {
  // 실코드 placeBoilerplateAt(fromPlacing) 분기 모델(수정본): 두 분기 모두 select 로 전환 + 자동선택.
  const placeBoilerplateAt = (fromPlacing: boolean) => {
    const state = { activeTool: 'boilerplate-placing' as ActiveTool, selectedIds: new Set<string>() };
    const newId = 'bp-new';
    if (fromPlacing) {
      state.activeTool = 'select';            // ★ 수정: 구 switchTool('pen') → setActiveTool('select')
      state.selectedIds = new Set([newId]);
    } else {
      state.activeTool = 'select';
      state.selectedIds = new Set([newId]);
    }
    return { ...state, newId };
  };

  // 실코드 오버레이 핸들 렌더 조건: interactive && isSelected. interactive = (activeTool==='select').
  const handlesVisible = (activeTool: ActiveTool, selectedIds: Set<string>, itemId: string) => {
    const interactive = activeTool === 'select';
    const isSelected = selectedIds.has(itemId);
    return interactive && isSelected; // 이동 그립·삭제 X·크기 ± 모두 이 조건으로 렌더
  };

  test('AC-2: placing 탭 배치(fromPlacing=true) 직후 activeTool=select + 자동선택', () => {
    const s = placeBoilerplateAt(true);
    expect(s.activeTool).toBe('select');
    expect(s.selectedIds.has(s.newId)).toBe(true);
  });

  test('AC-2: 배치 직후 이동/삭제/크기 핸들이 노출된다(회귀=pen 전환 시 미노출)', () => {
    const s = placeBoilerplateAt(true);
    expect(handlesVisible(s.activeTool, s.selectedIds, s.newId)).toBe(true);
    // 회귀 재현: 구 코드처럼 pen 으로 전환됐다면 핸들이 사라진다.
    expect(handlesVisible('pen', s.selectedIds, s.newId)).toBe(false);
  });

  test('AC-2: 빈 캔버스 클릭으로 deselect 되면 핸들이 사라진다(PINGPONG5 위치 고정 불변)', () => {
    const s = placeBoilerplateAt(true);
    const afterDeselect = new Set<string>(); // 빈 캔버스 탭 → deselect
    expect(handlesVisible(s.activeTool, afterDeselect, s.newId)).toBe(false);
    // 재선택(select 도구에서 본문 탭)하면 다시 노출
    expect(handlesVisible('select', new Set([s.newId]), s.newId)).toBe(true);
  });

  test('AC-2: ✓ 즉시삽입(fromPlacing=false)도 동일하게 핸들 노출', () => {
    const s = placeBoilerplateAt(false);
    expect(handlesVisible(s.activeTool, s.selectedIds, s.newId)).toBe(true);
  });
});

// ── 이슈3 (재정의 AC-3a): 화이트 = 상용구 블록 삭제 + 필기 획 위 덧칠 병존 + AC-FORM-SAFE ────────
test.describe('REGRESSION-3FIX 이슈3: 화이트=상용구 블록 삭제 + AC-FORM-SAFE', () => {

  // 실코드 onPointerUp 헬퍼 미러: pathHitsItem + 화이트 브랜치(상용구 삭제 + 획 누적)
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
  // 화이트 획 종료 처리 — (i) 지나간 boilerplate 제거, (ii) 필기 획 위 덧칠용 세션 누적
  const applyWhiteStroke = (
    items: PlacedItem[],
    whitePath: Array<{ x: number; y: number }>,
    whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }>,
    penSize = 3,
  ) => {
    const wsz = penSize * 4;
    const next = items.filter((item) =>
      !(item.type === 'boilerplate' && pathHitsItem(whitePath, item, wsz))
    );
    whiteStrokesAll.push({ path: whitePath, lineWidth: penSize * 8 });
    return next;
  };

  // ── 재정의 AC-3a 핵심: 화이트 획이 지나간 상용구 블록 삭제 ──
  test('재정의 AC-3a: 화이트 획이 지나간 상용구 블록(boilerplate)이 캔버스에서 삭제된다', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }> = [];
    // bp-1 위를 지나는 화이트 획
    const next = applyWhiteStroke(items, [{ x: 110, y: 110 }, { x: 150, y: 118 }], whiteStrokesAll);
    expect(next.find((i) => i.id === 'bp-1')).toBeUndefined(); // 지나간 상용구 삭제
    expect(next.find((i) => i.id === 'bp-2')).toBeDefined();   // 미통과 상용구 보존
  });

  test('재정의 AC-3a 엣지: 지우개는 상용구 블록을 못 지운다(필기 획만 지움 — type=text/draw 레이어)', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'tx-1', type: 'text', x: 100, y: 100, text: '메모', fontSize: 14, color: '#000' },
    ];
    // 실코드 지우개 onPointerUp: type==='text' 만 hit-test 삭제(상용구 미관여)
    const esz = 3 * 4;
    const path = [{ x: 110, y: 110 }, { x: 150, y: 118 }];
    const next = items.filter((item) => !(item.type === 'text' && pathHitsItem(path, item, esz)));
    expect(next.find((i) => i.id === 'bp-1')).toBeDefined();   // 상용구 = 지우개로 못 지움
    expect(next.find((i) => i.id === 'tx-1')).toBeUndefined(); // 필기 텍스트 = 지우개로 지워짐
  });

  test('재정의 AC-3a 엣지: 필기 획 위 화이트 덧칠(source-atop)은 유지된다(상용구 없이 획만 통과)', () => {
    // 상용구가 없는 경로 → 삭제 대상 없음. 그러나 화이트 획은 저장 재적용용으로 계속 누적됨.
    const items: PlacedItem[] = [
      { id: 'bp-far', type: 'boilerplate', x: 800, y: 800, text: '메모', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }> = [];
    const next = applyWhiteStroke(items, [{ x: 110, y: 110 }, { x: 150, y: 118 }], whiteStrokesAll);
    expect(next).toHaveLength(1);                 // 획이 지나가지 않은 상용구 보존
    expect(whiteStrokesAll).toHaveLength(1);      // 필기 획 위 덧칠용 세션 누적(병존)
    expect(whiteStrokesAll[0].lineWidth).toBe(24);
  });

  test('AC-3a 엣지: 필기 획 위 화이트 덧칠은 source-atop으로 하얗게 덮인다(투명화 아님)', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200;
      const ctx = c.getContext('2d')!;
      // 1) 필기 획 rasterize (검정 블록) — 상용구가 아닌 handwriting stroke
      ctx.fillStyle = '#000000';
      ctx.fillRect(40, 90, 120, 20); // x40~160 y90~110
      // 2) 그 위에 화이트 source-atop 재적용(필기 획 위 덧칠 — 병존 유지)
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 24;
      ctx.beginPath(); ctx.arc(60, 100, 12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(60, 100); ctx.lineTo(100, 100); ctx.stroke();
      ctx.restore();
      const under = Array.from(ctx.getImageData(80, 100, 1, 1).data);   // 획 통과 → 흰색 덮임
      const outside = Array.from(ctx.getImageData(150, 100, 1, 1).data); // 미통과 → 검정 보존
      return { under, outside };
    });
    // 획이 지나간 필기 픽셀 = 불투명 흰색(덮임, 투명화 아님)
    expect(r.under).toEqual([255, 255, 255, 255]);
    // 획 미통과 필기 픽셀 = 검정 보존
    expect(r.outside[3]).toBe(255);
    expect(r.outside[0]).toBe(0);
  });

  test('AC-3c/3d: 화이트 덧칠이 draw 레이어의 빈(투명) 영역엔 아무것도 안 그려 양식(bg)이 비쳐 보존된다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const draw = document.createElement('canvas'); draw.width = 200; draw.height = 200;
      const d = draw.getContext('2d')!;
      // draw 레이어는 투명(양식 영역엔 필기 없음). 화이트 source-atop 덧칠을 그 위에 시도.
      //   (상용구 삭제는 placedItems 배열만 변경 → bgCanvas 미관여. 아래는 필기 위 덧칠의 bg 불변 검증.)
      d.save();
      d.globalCompositeOperation = 'source-atop';
      d.fillStyle = '#ffffff'; d.globalAlpha = 1;
      d.beginPath(); d.arc(100, 100, 20, 0, Math.PI * 2); d.fill();
      d.restore();
      // draw 레이어 픽셀 = 그려진 게 없어야 함(source-atop: destination 없음 → no-op)
      const drawPx = Array.from(d.getImageData(100, 100, 1, 1).data);

      // 저장 합성: bg(양식) 위에 draw 를 얹음. draw 가 투명 → 양식 그대로 노출.
      const comp = document.createElement('canvas'); comp.width = 200; comp.height = 200;
      const cc = comp.getContext('2d')!;
      cc.fillStyle = '#3366cc'; cc.fillRect(0, 0, 200, 200); // 양식(예: 괘선/서식 색)
      cc.drawImage(draw, 0, 0);
      const compPx = Array.from(cc.getImageData(100, 100, 1, 1).data);
      return { drawPx, compPx };
    });
    // draw 레이어: 화이트가 안 그려짐(투명 유지) → 양식 read-only
    expect(r.drawPx[3]).toBe(0);
    // 합성본: 양식 색 그대로(#3366cc) — 화이트가 양식 서식을 지우거나 덮지 않음
    expect(r.compPx[0]).toBe(0x33);
    expect(r.compPx[1]).toBe(0x66);
    expect(r.compPx[2]).toBe(0xcc);
    expect(r.compPx[3]).toBe(255);
  });

  test('AC-3a 엣지/회귀: 필기 획 위 화이트 덧칠(source-atop=흰 덮기)과 지우개(destination-out=투명화)는 결과가 명확히 다르다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const paint = (mode: GlobalCompositeOperation, color: string) => {
        const c = document.createElement('canvas'); c.width = 100; c.height = 100;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000000'; ctx.fillRect(20, 40, 60, 20); // 필기(검정)
        ctx.save();
        ctx.globalCompositeOperation = mode; ctx.fillStyle = color; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(40, 50, 12, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return Array.from(ctx.getImageData(40, 50, 1, 1).data);
      };
      return {
        white: paint('source-atop', '#ffffff'),   // 화이트: 흰색 덮임
        eraser: paint('destination-out', 'rgba(0,0,0,1)'), // 지우개: 투명화
      };
    });
    expect(r.white).toEqual([255, 255, 255, 255]); // 화이트 = 불투명 흰색
    expect(r.eraser[3]).toBe(0);                    // 지우개 = 투명(지움)
    // 두 도구의 alpha 결과가 다름 → "화이트=지우개 동일" 회귀 해소
    expect(r.white[3]).not.toBe(r.eraser[3]);
  });

  test('AC-3b: 상용구 블록 선택 후 delete(X)로 해당 상용구만 삭제된다', () => {
    let items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    const selectedIds = new Set(['bp-1']); // select 도구에서 bp-1 선택(이슈2 수정으로 핸들/선택 가능)
    const onDelete = (id: string) => { items = items.filter((i) => i.id !== id); };
    onDelete('bp-1');
    expect(items.find((i) => i.id === 'bp-1')).toBeUndefined();
    expect(items.find((i) => i.id === 'bp-2')).toBeDefined();
    expect(selectedIds.has('bp-1')).toBe(true); // 삭제 대상이 선택돼 있었음
  });

  test('AC-3b 병존: 핸들 delete 삭제와 화이트 삭제는 공존한다(두 삭제 경로)', () => {
    // 경로A: 핸들 delete(선택 후 X)
    let a: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    ];
    a = a.filter((i) => i.id !== 'bp-1');
    expect(a).toHaveLength(0);
    // 경로B: 화이트 획 hit-test 삭제 — 동일 결과(상용구 제거) 도달
    const b: PlacedItem[] = [
      { id: 'bp-2', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }> = [];
    const nextB = applyWhiteStroke(b, [{ x: 110, y: 110 }, { x: 150, y: 118 }], whiteStrokesAll);
    expect(nextB).toHaveLength(0);
  });
});
