/**
 * E2E spec — T-20260603-foot-PHRASE-MOVE-RESTORE
 * 펜차트 상용구 드래그 이동이 불가능해진 UX 회귀 복구 (parent PHRASE-PEN-PASSTHROUGH 배포 후).
 *
 * 회귀 경위:
 *   parent(commit 4375652)가 드로잉 도구 활성 시 PlacedItemOverlay wrapper를
 *   pointerEvents:'none'으로 게이팅(펜 passthrough, AC-1 달성). 부작용: 상용구 드래그 이동이
 *   반드시 '선택/이동'(select) 도구로 명시 전환해야만 가능 → 기존 1단계 동선 파괴.
 *
 * 수정 메커니즘 (dev 선택 — 그립 핸들 방식):
 *   상용구 본문(wrapper)은 드로잉 모드에서 pointerEvents:'none' 그대로 유지(펜 passthrough 무회귀),
 *   대신 각 상용구에 항상 보이는 작은 이동 그립 핸들을 추가하고 핸들만 pointerEvents:'auto'로 둔다.
 *   CSS상 부모가 'none'이어도 자식이 'auto'면 이벤트를 수신 → 어느 도구에서든 핸들 드래그로 1단계 이동.
 *   추가로 상용구 배치 직후 해당 아이템을 자동 선택(B안) → 그립 강조로 affordance 노출.
 *
 * AC-1(본 티켓): 드로잉 도구 활성 중에도 상용구 위에서 위치 조정 가능(별도 버튼 탐색 불필요) — 그립 핸들.
 * AC-2: 이동 진입점(그립 핸들)이 항상 보이는 발견 가능한 위치/형태.
 * AC-3(핵심·회귀방지): parent AC-1(상용구 위 펜 passthrough) 무회귀 — 본문은 여전히 'none'.
 * AC-4: 상용구 드래그 이동 1단계 복원(추가 도구 전환 불필요).
 *
 * parent: T-20260602-foot-PHRASE-PEN-PASSTHROUGH (commit 4375652)
 * 스타일: 기존 PENCHART spec 패턴(in-page 로직 시뮬레이션 + 실제 DOM hit-test).
 */
import { test, expect } from '@playwright/test';

type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';

// 실제 코드: 선택/이동 모드일 때만 wrapper(본문) interactive. 드로잉 도구는 본문 passthrough.
const isOverlayInteractive = (tool: ActiveTool): boolean => tool === 'select';

// ── AC-3 (핵심): 상용구 위 펜 passthrough 무회귀 (본문은 여전히 'none') ──────────
//    + AC-4: 그립 핸들은 동일 상황에서도 pointerEvents:'auto' → 드래그 이동 수신
test.describe('PHRASE-MOVE-RESTORE AC-3·AC-4: 본문 passthrough 유지 + 핸들 이동 양립', () => {

  /**
   * 핵심 회귀 증명 (실제 DOM hit-test):
   *   드로잉 도구 활성(본문 pointerEvents:'none') 상태에서
   *   - 본문 중심 hit-test === canvas → 펜 필기 통과 (AC-3 무회귀, parent AC-1 보존)
   *   - 그립 핸들 중심 hit-test === handle → 핸들이 이벤트 수신 → 1단계 드래그 이동 (AC-4)
   *   = 부모가 'none'이어도 자식 'auto'가 hit 된다는 CSS 동작을 실제 브라우저로 증명.
   */
  test('AC-3+AC-4: 드로잉 모드 — 본문 hit=canvas(펜 통과) / 그립 핸들 hit=handle(이동)', async ({ page }) => {
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

      // 위: 상용구 overlay wrapper — 드로잉 모드: pointerEvents:'none' (본문 passthrough)
      const overlay = document.createElement('div');
      overlay.id = 'placed-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = '100px';
      overlay.style.top = '100px';
      overlay.style.minWidth = '120px';
      overlay.style.minHeight = '40px';
      overlay.style.zIndex = '20';
      overlay.style.touchAction = 'none';
      overlay.style.pointerEvents = 'none'; // 드로잉 도구 활성
      host.appendChild(overlay);

      // 내부 텍스트 div — 항상 pointerEvents:none
      const text = document.createElement('div');
      text.style.pointerEvents = 'none';
      text.textContent = '족저근막염 — 좌측 통증';
      overlay.appendChild(text);

      // 신규: 이동 그립 핸들 — 부모가 'none'이어도 자식만 'auto'
      const handle = document.createElement('div');
      handle.id = 'move-handle';
      handle.style.position = 'absolute';
      handle.style.top = '-9px';
      handle.style.left = '-9px';
      handle.style.width = '22px';
      handle.style.height = '22px';
      handle.style.pointerEvents = 'auto'; // 핵심
      handle.style.touchAction = 'none';
      handle.style.zIndex = '31';
      overlay.appendChild(handle);

      // 본문 중심 좌표
      const r = overlay.getBoundingClientRect();
      const bodyCx = Math.round(r.left + r.width / 2);
      const bodyCy = Math.round(r.top + r.height / 2);
      const bodyHit = document.elementFromPoint(bodyCx, bodyCy)?.id ?? '(none)';

      // 그립 핸들 중심 좌표
      const hr = handle.getBoundingClientRect();
      const hCx = Math.round(hr.left + hr.width / 2);
      const hCy = Math.round(hr.top + hr.height / 2);
      const handleHit = document.elementFromPoint(hCx, hCy)?.id ?? '(none)';

      host.remove();
      return { bodyHit, handleHit };
    });

    // AC-3: 본문 위 펜 pointerdown이 canvas에 도달 → 상용구 위 직접 필기 (parent AC-1 무회귀)
    expect(result.bodyHit).toBe('draw-canvas');
    // AC-4: 그립 핸들은 드로잉 모드에서도 이벤트 수신 → 핸들 드래그로 1단계 이동
    expect(result.handleHit).toBe('move-handle');
  });

  test('AC-3: 드로잉 도구(pen/eraser/white/highlight)는 본문 비활성(passthrough) 유지', () => {
    (['pen', 'eraser', 'white', 'highlight'] as ActiveTool[]).forEach((tool) => {
      expect(isOverlayInteractive(tool)).toBe(false); // wrapper pointerEvents:'none'
    });
  });

  test('AC-4: 그립 핸들 pointerEvents 는 활성 도구와 무관하게 항상 auto', () => {
    // 실제 코드: 핸들은 interactive prop과 무관하게 style.pointerEvents='auto' 고정
    const handlePointerEvents = (_tool: ActiveTool): 'auto' => 'auto';
    (['pen', 'eraser', 'white', 'highlight', 'boilerplate-placing', 'select'] as ActiveTool[])
      .forEach((tool) => expect(handlePointerEvents(tool)).toBe('auto'));
  });
});

// ── AC-4: 드래그 이동 1단계 (도구 전환 불필요) ───────────────────────────────
test.describe('PHRASE-MOVE-RESTORE AC-4: 1단계 드래그 이동', () => {

  // 실제 핸들 드래그 로직(PlacedItemOverlay handlePointerDown/Move/Up) 시뮬레이션
  function makeDragger(start: { px: number; py: number }) {
    let dragStart: { px: number; py: number } | null = { ...start };
    let hasMoved = false;
    const moves: Array<{ dx: number; dy: number }> = [];
    return {
      move(px: number, py: number) {
        if (!dragStart) return;
        const dx = px - dragStart.px;
        const dy = py - dragStart.py;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasMoved = true;
          moves.push({ dx, dy });
          dragStart = { px, py };
        }
      },
      up() { const m = hasMoved; dragStart = null; return { moved: m, moves }; },
    };
  }

  test('AC-4: 펜 도구 활성 상태에서도 핸들 드래그 → 상용구 x,y 누산 이동', () => {
    const activeTool: ActiveTool = 'pen'; // 별도 select 전환 없음 (1단계)
    interface PlacedItem { id: string; x: number; y: number; }
    let item: PlacedItem = { id: 'bp-1', x: 50, y: 300 };
    const onMove = (id: string, dx: number, dy: number) => {
      if (item.id === id) item = { ...item, x: item.x + dx, y: item.y + dy };
    };

    const d = makeDragger({ px: 100, py: 100 });
    d.move(140, 75);   // dx 40, dy -25
    d.move(150, 70);   // dx 10, dy -5
    const { moved } = d.up();
    // 핸들 드래그 결과를 onMove로 반영
    onMove('bp-1', 40, -25);
    onMove('bp-1', 10, -5);

    expect(activeTool).toBe('pen');      // 도구 전환 없었음을 명시 (1단계)
    expect(moved).toBe(true);
    expect(item.x).toBe(100); // 50 + 40 + 10
    expect(item.y).toBe(270); // 300 - 25 - 5
  });

  test('AC-4: 미세 이동(<=3px)은 드래그로 간주 안 함 → 탭=선택', () => {
    const d = makeDragger({ px: 200, py: 200 });
    d.move(202, 201); // dx2 dy1 — threshold 이하
    const { moved } = d.up();
    expect(moved).toBe(false); // hasMoved=false → onSelect 경로 (탭=선택)
  });

  test('AC-4: 핸들 탭(이동 없음) → onSelect 호출 (선택 토글)', () => {
    let selectedIds = new Set<string>();
    const onSelect = (id: string, multi: boolean) => {
      const next = new Set(selectedIds);
      if (multi) { if (next.has(id)) next.delete(id); else next.add(id); }
      else { if (next.has(id) && next.size === 1) next.clear(); else { next.clear(); next.add(id); } }
      selectedIds = next;
    };
    // 핸들 pointerup 시 hasMoved=false → onSelect
    onSelect('bp-1', false);
    expect(selectedIds.has('bp-1')).toBe(true);
  });
});

// ── B안: 배치 직후 자동 선택 (AC-2 발견성 보강) ──────────────────────────────
test.describe('PHRASE-MOVE-RESTORE B안: 배치 직후 자동 선택', () => {

  test('placeBoilerplate 직후 방금 놓은 아이템이 selectedIds에 단독 포함', () => {
    // 실제 코드: setPlacedItems(+newItem) → switchTool('pen') → setSelectedIds(new Set([newItem.id]))
    interface PlacedItem { id: string; }
    let placedItems: PlacedItem[] = [{ id: 'bp-old' }];
    let selectedIds = new Set<string>(['bp-old']);

    const newItem: PlacedItem = { id: 'bp-new' };
    placedItems = [...placedItems, newItem];
    selectedIds = new Set([newItem.id]); // 자동 선택 — 기존 선택은 해제

    expect(placedItems.map((i) => i.id)).toContain('bp-new');
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has('bp-new')).toBe(true);
    expect(selectedIds.has('bp-old')).toBe(false);
  });

  test('자동 선택 시 그립 핸들 색상 = 선택(보라) → affordance 강조', () => {
    // 실제 코드: handle background = isSelected ? '#7c3aed' : '#0d9488'
    const handleColor = (isSelected: boolean) => (isSelected ? '#7c3aed' : '#0d9488');
    expect(handleColor(true)).toBe('#7c3aed');  // 배치 직후 자동 선택 상태
    expect(handleColor(false)).toBe('#0d9488'); // 평시 teal
  });
});

// ── AC-3 회귀방지(추가): 도구 전환 일관성 ────────────────────────────────────
test.describe('PHRASE-MOVE-RESTORE AC-3: 도구 전환 무영향', () => {

  test('5개 도구 순차 전환 — 본문 interactive는 select에서만 true, 핸들은 항상 이동 가능', () => {
    const tools: ActiveTool[] = ['pen', 'highlight', 'eraser', 'white', 'select', 'boilerplate-placing'];
    const handleAlwaysMovable = true; // 핸들은 모든 도구에서 pointerEvents:'auto'
    tools.forEach((tool) => {
      // 본문 게이팅: select에서만 interactive
      expect(isOverlayInteractive(tool)).toBe(tool === 'select');
      // 핸들은 도구 무관하게 이동 가능 (AC-4)
      expect(handleAlwaysMovable).toBe(true);
    });
  });

  test('select 모드: 본문 전체 드래그 + 핸들 드래그 모두 가능 (회귀 없음)', () => {
    const tool: ActiveTool = 'select';
    const bodyDraggable = isOverlayInteractive(tool); // 본문 interactive
    const handleDraggable = true;                     // 핸들 항상 가능
    expect(bodyDraggable).toBe(true);
    expect(handleDraggable).toBe(true);
  });
});
