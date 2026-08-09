/**
 * T-20260807-foot-PENCHART-BOTTOM-PEN-ICON
 * 펜차트 작성 화면 하단(뷰포트 우하단)에 [펜] 아이콘 추가 — 상단 펜 버튼과 동일 동작.
 * 요청: 김주연 총괄 (U0ATDB587PV), #project-doai-crm-풋확장 (C0ATE5P6JTH).
 *
 * [배경] 펜(그리기) 아이콘이 상단 도구영역에만 있어, 필기 시작 시 매번 위로 스크롤해 펜을 클릭해야 함
 *        (캔버스 최대 ~6738px). 하단(첨부 F0BNMQRHP1B 빨간박스=뷰포트 우하단)에도 펜을 추가 → 동선 단축.
 * [구현] 하단 펜 버튼은 상단 펜 버튼과 '동일 핸들러(switchTool('pen'))·동일 active 상태(activeTool==='pen')'
 *        재사용. 새 토글 로직 신설 X. draw 컨테이너(relative) 기준 absolute 로 스크롤 뷰포트 우하단 고정.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬)를 따른다. 실코드의 switchTool 상태전이 + 상·하단 버튼
 *       active 상태 공유 불변식을 미러링해 검증. 실기기(갤탭) 하단 펜 아이콘 렌더 위치(우하단)·1탭 펜 전환은
 *       supervisor field-soak(김주연 총괄) 스크린샷 confirm 병행.
 */
import { test, expect } from '@playwright/test';

// ── 실코드 미러: ActiveTool / DEFAULT_THICKNESS (PenChartTab.tsx L445~456) ──
type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';
const DEFAULT_THICKNESS: Record<ActiveTool, number> = {
  pen: 1.5,
  eraser: 3,
  white: 3,
  text: 2,
  highlight: 2,
  'boilerplate-placing': 1.5,
  select: 1.5,
};

// ── 실코드 미러: switchTool (PenChartTab.tsx L2135~2142) ──
//   flushTextInput(false) → setActiveTool(tool) → setPenSize(DEFAULT_THICKNESS[tool]) → setShowPhrasePanel(false)
class PenChartToolModel {
  activeTool: ActiveTool = 'pen';          // 초기값 (useState<ActiveTool>('pen'))
  penSize = DEFAULT_THICKNESS.pen;
  showPhrasePanel = false;
  flushedCount = 0;

  switchTool(tool: ActiveTool) {
    this.flushedCount += 1;                // flushTextInput(false) — 미확정 텍스트 commit
    this.activeTool = tool;
    this.penSize = DEFAULT_THICKNESS[tool];
    this.showPhrasePanel = false;
  }

  // 상단 펜 버튼 onClick — switchTool('pen') (L3624)
  clickTopPen() { this.switchTool('pen'); }
  // 하단 플로팅 펜 버튼 onClick — switchTool('pen') (신규, 동일 핸들러 재사용)
  clickBottomPen() { this.switchTool('pen'); }

  // 버튼 active 표시 계산식 (상·하단 동일: activeTool === 'pen')
  topPenActive() { return this.activeTool === 'pen'; }
  bottomPenActive() { return this.activeTool === 'pen'; }
}

// ══════════════════════════════════════════════════════════════════════════
// AC-1: 하단 펜 버튼 클릭 = 상단 펜 버튼과 동일하게 펜 모드로 전환 (동일 핸들러)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 하단 펜 = 즉시 펜 모드 전환', () => {
  test('다른 도구(지우개) 상태에서 하단 펜 클릭 → activeTool=pen', () => {
    const m = new PenChartToolModel();
    m.switchTool('eraser');
    expect(m.activeTool).toBe('eraser');
    m.clickBottomPen();
    expect(m.activeTool).toBe('pen');
  });

  test('하단 펜 전환 = 상단 펜 전환과 결과 동일(핸들러/굵기/패널 부작용 일치)', () => {
    const top = new PenChartToolModel();
    const bottom = new PenChartToolModel();
    // 동일 선행 상태(형광펜)
    top.switchTool('highlight');
    bottom.switchTool('highlight');
    top.clickTopPen();
    bottom.clickBottomPen();
    expect(bottom.activeTool).toBe(top.activeTool);       // 둘 다 'pen'
    expect(bottom.penSize).toBe(top.penSize);             // 둘 다 1.5
    expect(bottom.showPhrasePanel).toBe(top.showPhrasePanel); // 둘 다 false
  });

  test('하단 펜 전환도 펜 기본 굵기(1.5) 적용', () => {
    const m = new PenChartToolModel();
    m.switchTool('white'); // 굵기 3
    expect(m.penSize).toBe(3);
    m.clickBottomPen();
    expect(m.penSize).toBe(DEFAULT_THICKNESS.pen); // 1.5
  });

  test('하단 펜 전환 시 미확정 텍스트 commit(flush) — 상단과 동일 부작용', () => {
    const m = new PenChartToolModel();
    m.switchTool('text');
    const before = m.flushedCount;
    m.clickBottomPen();
    expect(m.flushedCount).toBe(before + 1); // flushTextInput(false) 1회
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-2: 상·하단 버튼 active 상태 공유 (같은 그리기-모드 상태)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-2: 상·하단 펜 버튼 active 일관성', () => {
  test('상단 펜 클릭 → 상·하단 둘 다 active', () => {
    const m = new PenChartToolModel();
    m.switchTool('select'); // 비-펜 상태로 초기화
    m.clickTopPen();
    expect(m.topPenActive()).toBe(true);
    expect(m.bottomPenActive()).toBe(true);
  });

  test('하단 펜 클릭 → 상단 펜 active 표시도 유지/동기', () => {
    const m = new PenChartToolModel();
    m.switchTool('eraser');
    m.clickBottomPen();
    expect(m.bottomPenActive()).toBe(true);
    expect(m.topPenActive()).toBe(true); // 같은 activeTool 소스 → 상단도 동기 active
  });

  test('엣지: 다른 도구 선택 시 상·하단 펜 버튼 active 동시 해제', () => {
    const m = new PenChartToolModel();
    m.clickBottomPen();
    expect(m.topPenActive()).toBe(true);
    expect(m.bottomPenActive()).toBe(true);
    m.switchTool('highlight'); // 형광펜 선택
    expect(m.topPenActive()).toBe(false);
    expect(m.bottomPenActive()).toBe(false); // 둘 다 동시 해제
  });

  test('active 계산식이 상·하단 동일 소스(activeTool)에서 파생 → 항상 일치', () => {
    const m = new PenChartToolModel();
    const tools: ActiveTool[] = ['pen', 'eraser', 'white', 'text', 'highlight', 'select'];
    for (const t of tools) {
      m.switchTool(t);
      expect(m.topPenActive()).toBe(m.bottomPenActive());
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-3: 새 토글 로직 신설 X — 하단 버튼은 항상 'pen'으로 고정 전환(토글 아님)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-3: 하단 펜은 pen 고정 전환(토글 아님)', () => {
  test('펜 상태에서 하단 펜 재클릭해도 펜 유지(다른 모드로 토글되지 않음)', () => {
    const m = new PenChartToolModel();
    m.clickBottomPen();
    expect(m.activeTool).toBe('pen');
    m.clickBottomPen(); // 재클릭
    expect(m.activeTool).toBe('pen'); // 여전히 pen (예: white 버튼의 isWhite?'pen':'white' 토글과 대비)
  });
});
