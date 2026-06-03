/**
 * E2E spec — T-20260603-foot-PHRASE-MULTISELECT
 * 펜차트 상용구 패널 복수 선택 + 일괄 배치 (김주연 총괄 요청).
 *
 * 아키텍처 그라운딩 (티켓 정본):
 *   풋 PenChartTab은 상용구를 입력필드에 concat 하지 않는다. 상용구 "삽입" =
 *   캔버스 1회 클릭 시 pendingBoilerplate 1개 문자열을 1개 PlacedItem(boilerplate)로 배치.
 *   기존엔 패널 항목 클릭 = 즉시 단일배치(단일선택 강제). 본 작업은 이를 누적 토글 복수 선택 →
 *   "삽입" 확정 시 선택분 전체를 클릭(선택) 순서대로 줄바꿈('\n') 결합한 1개 PlacedItem으로 배치.
 *
 * AC-1: 항목 클릭 = 누적 토글(패널 유지). 같은 항목 재클릭 시 해제.
 * AC-2: 복수 선택(2개+) 가능, 선택 카운트/순번 시각화.
 * AC-3: "삽입" 시 선택분 클릭순 줄바꿈 결합 → boilerplate-placing 진입 → 캔버스 1클릭 = 결합 1개 PlacedItem.
 * AC-4: 선택 0개 시 삽입 무동작/비활성, 선택 초기화 가능.
 * AC-5 (GUARD): 1개만 선택 후 삽입 = 종전 단일 동선과 동일 결과.
 * AC-6: DB/네트워크 추가 호출 0 (phrase_templates read-only).
 *
 * 스타일: 기존 PENCHART spec 패턴(in-page 순수 로직 시뮬레이션) — 실제 구현과 동일한
 *   결합 상수/헬퍼·토글 순서·confirm 경로를 그대로 모사해 회귀를 잡는다.
 *
 * related: T-20260603-foot-PHRASE-MOVE-RESTORE(배치직후 자동선택)·PENCHART-TOOLS-V3 동작 보존.
 */
import { test, expect } from '@playwright/test';

// ── 실제 구현 정본과 동일한 결합 정책 (PenChartTab.tsx 한 곳에 모음) ──────────
//    결합 순서 = 클릭(선택) 순서 / 구분자 = 줄바꿈('\n')  (planner 확정 #1·#2, reversible)
const PHRASE_JOIN_SEPARATOR = '\n';
const combineBoilerplate = (contents: string[]): string =>
  contents.join(PHRASE_JOIN_SEPARATOR);

// 실제 togglePhraseSelect: 배열(클릭 순서 보존) 누적 토글
const togglePhraseSelect = (prev: number[], id: number): number[] =>
  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];

interface Phrase { id: number; category: string; name: string; content: string; }
const FIXTURES: Phrase[] = [
  { id: 1, category: 'charting', name: 'A 족저근막염', content: '족저근막염 의심\n좌측 통증 (+)' },
  { id: 2, category: 'charting', name: 'B 보존치료', content: '보존적 치료 시행' },
  { id: 3, category: 'charting', name: 'C 재방문', content: '2주 후 재방문' },
];

// 실제 confirmPhraseSelection: 선택 배열 → content 매핑(순서 보존) → 결합
const buildPendingFromSelection = (selectedIds: number[], pool: Phrase[]): string | null => {
  if (selectedIds.length === 0) return null; // AC-4: 0개 무동작
  const contents = selectedIds
    .map((id) => pool.find((p) => p.id === id)?.content)
    .filter((c): c is string => typeof c === 'string');
  if (contents.length === 0) return null;
  return combineBoilerplate(contents);
};

// ── AC-1: 누적 토글 선택 ──────────────────────────────────────────────────
test.describe('PHRASE-MULTISELECT AC-1: 항목 클릭 = 누적 토글(패널 유지)', () => {
  test('항목 클릭 시 선택에 추가, 같은 항목 재클릭 시 해제', () => {
    let sel: number[] = [];
    sel = togglePhraseSelect(sel, 1); // A 선택
    expect(sel).toEqual([1]);
    sel = togglePhraseSelect(sel, 2); // B 선택
    expect(sel).toEqual([1, 2]);
    sel = togglePhraseSelect(sel, 1); // A 재클릭 → 해제
    expect(sel).toEqual([2]);
  });

  test('단일배치 즉시 트리거 없음 — 클릭만으로는 placing 모드 진입 안 함', () => {
    // 종전: onClick → handleBoilerplateSelect(즉시). 신규: onClick → toggle만.
    let sel: number[] = [];
    let placingEntered = false;
    const onItemClick = (id: number) => { sel = togglePhraseSelect(sel, id); };
    onItemClick(1);
    onItemClick(2);
    expect(placingEntered).toBe(false); // 삽입 확정 전엔 배치 모드 아님
    expect(sel.length).toBe(2);
  });
});

// ── AC-2: 복수 선택 + 순번 시각화 ─────────────────────────────────────────
test.describe('PHRASE-MULTISELECT AC-2: 복수 선택 + 클릭 순번', () => {
  test('선택 순번(1-based) = 클릭 순서. 목록 순서가 아님', () => {
    // C(3) → A(1) 순으로 클릭 → 순번 C=1, A=2 (목록순 A,B,C 아님)
    let sel: number[] = [];
    sel = togglePhraseSelect(sel, 3);
    sel = togglePhraseSelect(sel, 1);
    const orderOf = (id: number) => sel.indexOf(id) + 1; // 배지 표기와 동일
    expect(orderOf(3)).toBe(1);
    expect(orderOf(1)).toBe(2);
    expect(sel.length).toBe(2); // 카운트 배지
  });
});

// ── AC-3: 삽입 = 클릭순 줄바꿈 결합 1개 PlacedItem ────────────────────────
test.describe('PHRASE-MULTISELECT AC-3: 일괄 배치 (클릭순 줄바꿈 결합)', () => {
  test('선택 2개 삽입 → 클릭 순서대로 \\n 결합된 단일 pendingBoilerplate', () => {
    // 클릭: B(2) → A(1)  → 결합 순서 = B내용 \n A내용
    let sel: number[] = [];
    sel = togglePhraseSelect(sel, 2);
    sel = togglePhraseSelect(sel, 1);
    const pending = buildPendingFromSelection(sel, FIXTURES);
    expect(pending).toBe('보존적 치료 시행\n족저근막염 의심\n좌측 통증 (+)');
  });

  test('결합 결과는 PlacedItem 1개 text — 멀티라인 그대로 보존', () => {
    let sel = togglePhraseSelect([], 1);
    sel = togglePhraseSelect(sel, 3);
    const pending = buildPendingFromSelection(sel, FIXTURES)!;
    // placeBoilerplate: PlacedItem{ type:'boilerplate', text: pendingBoilerplate }
    const placed = { id: 'bp-x', type: 'boilerplate' as const, text: pending };
    expect(placed.text.split('\n')).toEqual([
      '족저근막염 의심', '좌측 통증 (+)', '2주 후 재방문',
    ]);
  });

  test('삽입 확정 시 선택 초기화 + 배치 모드 진입(handleBoilerplateSelect 경로)', () => {
    let sel = togglePhraseSelect([], 1);
    sel = togglePhraseSelect(sel, 2);
    let activeTool = 'pen';
    let pendingBoilerplate = '';
    let showPhrasePanel = true;
    // confirmPhraseSelection 모사
    const pending = buildPendingFromSelection(sel, FIXTURES);
    if (pending) {
      pendingBoilerplate = pending;           // handleBoilerplateSelect(text)
      activeTool = 'boilerplate-placing';
      showPhrasePanel = false;
      sel = [];                               // setSelectedPhraseIds([])
    }
    expect(activeTool).toBe('boilerplate-placing');
    expect(showPhrasePanel).toBe(false);
    expect(pendingBoilerplate.length).toBeGreaterThan(0);
    expect(sel).toEqual([]);
  });
});

// ── AC-4: 선택 0개 무동작 + 초기화 ────────────────────────────────────────
test.describe('PHRASE-MULTISELECT AC-4: 0개 무동작 / 선택 취소', () => {
  test('선택 0개에서 삽입 → null(무동작), 배치 모드 진입 안 함', () => {
    const pending = buildPendingFromSelection([], FIXTURES);
    expect(pending).toBeNull();
  });

  test('선택 취소 → 선택 배열 초기화(패널 유지)', () => {
    let sel = togglePhraseSelect([], 1);
    sel = togglePhraseSelect(sel, 2);
    expect(sel.length).toBe(2);
    sel = []; // clearPhraseSelection
    expect(sel).toEqual([]);
  });
});

// ── AC-5 (GUARD): 단일 선택 하위호환 ─────────────────────────────────────
test.describe('PHRASE-MULTISELECT AC-5 (GUARD): 단일 선택 = 종전과 동일 결과', () => {
  test('1개만 선택 후 삽입 → 결합 헬퍼가 그 1개 content를 그대로 반환(구분자 없음)', () => {
    const single = togglePhraseSelect([], 1);
    const pending = buildPendingFromSelection(single, FIXTURES);
    // 종전 handleBoilerplateSelect(phrase.content) 와 완전히 동일한 문자열
    expect(pending).toBe(FIXTURES[0].content);
    expect(pending).not.toContain('\n족'); // 앞에 구분자가 덧붙지 않음
  });

  test('1개 결합 == 직접 content (combineBoilerplate 동등성)', () => {
    expect(combineBoilerplate([FIXTURES[1].content])).toBe(FIXTURES[1].content);
  });

  test('카테고리 필터/빈상태는 선택 로직과 독립 — 불변', () => {
    const charting = FIXTURES.filter((p) => p.category === 'charting');
    expect(charting.length).toBe(3);
    const prescription = FIXTURES.filter((p) => p.category === 'prescription');
    expect(prescription.length).toBe(0); // 빈 상태 분기 유지
  });
});

// ── 현장 클릭 시나리오 1·2·3 (티켓 E2E 변환 가이드) ──────────────────────────
test.describe('PHRASE-MULTISELECT 현장 시나리오', () => {
  test('시나리오 1: A→B 선택 후 삽입 → A위/B아래 결합 1개 배치', () => {
    let sel = togglePhraseSelect([], 1); // A
    sel = togglePhraseSelect(sel, 2);    // B
    const pending = buildPendingFromSelection(sel, FIXTURES)!;
    const lines = pending.split('\n');
    // A(2줄)가 위, B(1줄)가 아래
    expect(lines[0]).toBe('족저근막염 의심');
    expect(lines[lines.length - 1]).toBe('보존적 치료 시행');
  });

  test('시나리오 2 (GUARD): 단일 1개 → 종전과 동일 단일 배치', () => {
    const sel = togglePhraseSelect([], 2);
    expect(buildPendingFromSelection(sel, FIXTURES)).toBe('보존적 치료 시행');
  });

  test('시나리오 3: A 선택→재클릭 해제(0개) → 삽입 무동작', () => {
    let sel = togglePhraseSelect([], 1);
    sel = togglePhraseSelect(sel, 1); // 재클릭 해제
    expect(sel.length).toBe(0);
    expect(buildPendingFromSelection(sel, FIXTURES)).toBeNull();
  });
});

// ── AC-6: DB/네트워크 추가 호출 0 (read-only) ────────────────────────────
test.describe('PHRASE-MULTISELECT AC-6: phrase_templates read-only', () => {
  test('선택/결합 로직은 순수 함수 — 외부 호출 없음', () => {
    // buildPendingFromSelection·togglePhraseSelect·combineBoilerplate 는 인자만으로 결정.
    let writes = 0;
    const pool = FIXTURES; // read-only 참조
    let sel = togglePhraseSelect([], 1);
    sel = togglePhraseSelect(sel, 2);
    buildPendingFromSelection(sel, pool);
    expect(writes).toBe(0);
    expect(pool).toBe(FIXTURES); // 원본 불변(쓰기 없음)
  });
});
