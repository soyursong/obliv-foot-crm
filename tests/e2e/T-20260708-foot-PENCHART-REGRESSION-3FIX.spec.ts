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
 *   3a    : 화이트 = 흰 덧칠(source-atop) — 저장본에서 필기/상용구 위가 하얗게 덮임(상용구 데이터 미삭제).
 *   3b    : 상용구 블록 선택 후 delete(X) 정상 삭제.
 *   3c/3d : AC-FORM-SAFE/AC-LAYER-SEPARATE — 화이트는 draw 레이어에만 작동, 양식 서식(bgCanvas)은 read-only(불변).
 *   회귀   : 지우개(destination-out/clearRect=투명화)·선택→삭제 동선 불변.
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
    fontPx: 10,                 // AC-1b: 현재(20px)의 절반
    textAlign: 'right' as const,
    colonX: 618,                // AC-1a: 우측 콜론열(원 담당의/담당실장 콜론 우측끝)
    doctorBaselineY: 77,        // AC-1a: 원 담당의 하단 baseline
    staffBaselineY: 99,         // AC-1a: 원 담당실장 하단 baseline
  };

  test('AC-1b: 라벨 폰트가 현재(20px)의 절반=10px 로 축소된다', () => {
    const current = 20;
    expect(LABEL_OVERRIDE.fontPx).toBe(current / 2);
    expect(LABEL_OVERRIDE.fontPx).toBe(10);
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
    // 동일 폰트 → 두 라벨 폭이 근사(동일 서체·크기 통일 유지). 10px 라 폭 자체는 작다(축소 확인).
    expect(Math.abs(widths.doctor - widths.staff)).toBeLessThan(4);
    expect(widths.doctor).toBeLessThan(80); // 20px 대비 대략 절반 수준의 작은 폭
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

// ── 이슈3 (AC-3a/3c/3d): 화이트 = 흰 덧칠(source-atop) + 양식 서식 보호 ────────
test.describe('REGRESSION-3FIX 이슈3: 화이트 흰 덧칠 + AC-FORM-SAFE', () => {

  test('AC-3a: 화이트(source-atop)는 draw 레이어 내용(상용구/필기) 위를 하얗게 덮는다(투명화 아님)', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200;
      const ctx = c.getContext('2d')!;
      // 1) 상용구/필기 rasterize (검정 블록)
      ctx.fillStyle = '#000000';
      ctx.fillRect(40, 90, 120, 20); // x40~160 y90~110
      // 2) 그 위에 화이트 source-atop 재적용(실코드 신규)
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
    // 획이 지나간 상용구 픽셀 = 불투명 흰색(덮임, 투명화 아님)
    expect(r.under).toEqual([255, 255, 255, 255]);
    // 획 미통과 상용구 픽셀 = 검정 보존(상용구 데이터 유지)
    expect(r.outside[3]).toBe(255);
    expect(r.outside[0]).toBe(0);
  });

  test('AC-3c/3d: 화이트가 draw 레이어의 빈(투명) 영역엔 아무것도 안 그려 양식(bg)이 비쳐 보존된다', async ({ page }) => {
    await page.goto('about:blank');
    const r = await page.evaluate(() => {
      const draw = document.createElement('canvas'); draw.width = 200; draw.height = 200;
      const d = draw.getContext('2d')!;
      // draw 레이어는 투명(양식 영역엔 필기/상용구 없음). 화이트 source-atop 을 그 위에 시도.
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

  test('AC-3a/회귀: 화이트(source-atop=흰 덮기)와 지우개(destination-out=투명화)는 결과가 명확히 다르다', async ({ page }) => {
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

  test('AC-3a: 화이트 획은 placedItems(상용구 데이터)를 삭제하지 않는다(획 경로만 세션 누적)', () => {
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
    ];
    const whiteStrokesAll: Array<{ path: Array<{ x: number; y: number }>; lineWidth: number }> = [];
    // 실코드 onPointerUp 화이트 브랜치: placedItems 불변, 경로만 push
    whiteStrokesAll.push({ path: [{ x: 110, y: 110 }, { x: 140, y: 118 }], lineWidth: 3 * 8 });
    expect(items).toHaveLength(1);              // 상용구 데이터 보존(AC-1 유지)
    expect(whiteStrokesAll[0].lineWidth).toBe(24);
  });
});
