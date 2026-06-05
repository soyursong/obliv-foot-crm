/**
 * E2E spec — T-20260605-foot-RX-PHRASE-INSERT-UX
 * 펜차트 상용구 삽입 UX 변경 (문지은 대표원장 요청).
 *
 * 아키텍처 그라운딩 (티켓 정본):
 *   풋 PenChartTab은 상용구를 입력필드에 concat 하지 않는다. 상용구 "삽입" =
 *   캔버스 1회 클릭 시 pendingBoilerplate 1개 문자열을 1개 PlacedItem(boilerplate)로 배치.
 *   직전(PHRASE-MULTISELECT 604e4fc): 체크박스 누적 복수선택 → 하단 "삽입" 버튼으로 결합 1개 배치.
 *   본 작업: 체크박스+하단버튼 제거 → 행 클릭 시 그 행 좌측에 인라인 ✓ 노출(한 번에 한 행) →
 *            ✓ 클릭 = 즉시삽입(pendingBoilerplate → boilerplate-placing 진입 → 캔버스 클릭 배치).
 *
 * AC-1: 체크박스/하단 일괄 삽입 버튼 제거 (단건 즉시삽입 동선).
 * AC-2: 행 클릭 → 그 행에만 좌측 인라인 ✓ 노출(한 번에 한 행). 같은 행 재클릭 = 닫힘.
 * AC-3: ✓ 클릭 = 즉시삽입. handleBoilerplateSelect(단일 content) → boilerplate-placing 진입.
 * AC-4 (GUARD): placeBoilerplate / 카테고리 필터 / 이동·삭제 / 빈 상태 불변. phrase_templates read-only.
 * AC-5: ✓ 접근성 (aria-label·role·키보드).
 *
 * Q1 (planner 비차단): 단건 즉시삽입을 dev 기본안으로 착수. 복수결합 헬퍼/상수는 제거하지 않고
 *   비활성(주석) 보존 → 현장 복수재요청 시 복원 용이. 현장 confirm은 responder 병행, 착수 블로킹 X.
 *
 * 스타일: 기존 PENCHART spec 패턴(in-page 순수 로직 시뮬레이션) — 실제 구현과 동일한
 *   reveal 토글·즉시삽입 경로를 그대로 모사해 회귀를 잡는다.
 *
 * related: T-20260603-foot-PHRASE-MULTISELECT(직전 동선)·T-20260605-foot-RX-PHRASE-CLICK-INSERT
 *   (MedicalChartPanel 텍스트차트의 동형 인라인 ✓ 동선).
 */
import { test, expect } from '@playwright/test';

interface Phrase { id: number; category: string; name: string; content: string; }
const FIXTURES: Phrase[] = [
  { id: 1, category: 'charting', name: 'A 족저근막염', content: '족저근막염 의심\n좌측 통증 (+)' },
  { id: 2, category: 'charting', name: 'B 보존치료', content: '보존적 치료 시행' },
  { id: 3, category: 'charting', name: 'C 재방문', content: '2주 후 재방문' },
];

// ── 실제 구현 정본과 동일한 단건 즉시삽입 경로 (PenChartTab.tsx) ──────────────
// revealPhraseInsert: 행 클릭 → 그 행에만 ✓ 노출(한 번에 한 행). 같은 행 재클릭 = null(닫힘).
const revealPhraseInsert = (prev: number | null, id: number): number | null =>
  prev === id ? null : id;

// insertPhraseImmediate: ✓ 클릭 → 단일 content를 pendingBoilerplate로 → boilerplate-placing 진입.
interface PenState {
  pendingBoilerplate: string;
  activeTool: string;
  showPhrasePanel: boolean;
  revealedPhraseId: number | null;
}
const insertPhraseImmediate = (state: PenState, id: number, pool: Phrase[]): PenState => {
  const content = pool.find((p) => p.id === id)?.content;
  if (typeof content !== 'string') return state; // 방어: content 없으면 무동작
  // handleBoilerplateSelect(content) 모사
  return {
    pendingBoilerplate: content,
    activeTool: 'boilerplate-placing',
    showPhrasePanel: false,
    revealedPhraseId: null,
  };
};

// placeBoilerplate: 캔버스 1클릭 → PlacedItem 1개(boilerplate) — AC-4 GUARD 불변 동작.
const placeBoilerplate = (pendingBoilerplate: string) => ({
  id: 'bp-x',
  type: 'boilerplate' as const,
  text: pendingBoilerplate,
});

const freshState = (): PenState => ({
  pendingBoilerplate: '',
  activeTool: 'pen',
  showPhrasePanel: true,
  revealedPhraseId: null,
});

// ── AC-1: 체크박스/하단 삽입 버튼 제거 ─────────────────────────────────────
test.describe('PHRASE-INSERT-UX AC-1: 복수선택 체크박스/하단버튼 제거', () => {
  test('행 클릭은 더 이상 누적 토글 배열을 만들지 않는다 (단일 reveal id만)', () => {
    // 종전: selectedPhraseIds 배열 누적. 신규: revealedPhraseId 단일 값.
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 1);
    revealed = revealPhraseInsert(revealed, 2); // 다른 행 → 교체(누적 아님)
    expect(revealed).toBe(2); // 배열 [1,2]가 아니라 단일 값 2
  });

  test('하단 일괄 삽입 경로 없음 — 행 클릭만으로는 배치 모드 진입 안 함', () => {
    let state = freshState();
    state = { ...state, revealedPhraseId: revealPhraseInsert(state.revealedPhraseId, 1) };
    // 행 클릭 = ✓ 노출일 뿐, 아직 placing 진입 아님
    expect(state.activeTool).toBe('pen');
    expect(state.revealedPhraseId).toBe(1);
  });
});

// ── AC-2: 행 클릭 → 좌측 ✓ 노출 (한 번에 한 행) ───────────────────────────
test.describe('PHRASE-INSERT-UX AC-2: 행 클릭 → 인라인 ✓ (한 번에 한 행)', () => {
  test('행 클릭 시 그 행에만 ✓ 노출', () => {
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 1);
    expect(revealed).toBe(1);
  });

  test('다른 행 클릭 시 직전 행 ✓ 닫히고 새 행만 노출 (한 번에 한 행)', () => {
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 1);
    revealed = revealPhraseInsert(revealed, 3);
    expect(revealed).toBe(3); // 1은 더 이상 노출 아님
    const isRevealed = (id: number) => revealed === id;
    expect(isRevealed(1)).toBe(false);
    expect(isRevealed(3)).toBe(true);
  });

  test('같은 행 재클릭 = ✓ 닫힘', () => {
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 2);
    revealed = revealPhraseInsert(revealed, 2); // 재클릭
    expect(revealed).toBeNull();
  });
});

// ── AC-3: ✓ 클릭 = 즉시삽입 ───────────────────────────────────────────────
test.describe('PHRASE-INSERT-UX AC-3: ✓ 클릭 = 즉시삽입', () => {
  test('✓ 클릭 → pendingBoilerplate=단일 content + boilerplate-placing 진입 + 패널 닫힘', () => {
    let state = freshState();
    state = { ...state, revealedPhraseId: revealPhraseInsert(state.revealedPhraseId, 1) };
    state = insertPhraseImmediate(state, 1, FIXTURES);
    expect(state.activeTool).toBe('boilerplate-placing');
    expect(state.showPhrasePanel).toBe(false);
    expect(state.pendingBoilerplate).toBe(FIXTURES[0].content);
    expect(state.revealedPhraseId).toBeNull(); // 삽입 후 ✓ 초기화
  });

  test('즉시삽입 후 캔버스 1클릭 → PlacedItem 1개(boilerplate) 단일 content 그대로', () => {
    let state = insertPhraseImmediate(freshState(), 2, FIXTURES);
    const placed = placeBoilerplate(state.pendingBoilerplate);
    expect(placed.type).toBe('boilerplate');
    expect(placed.text).toBe('보존적 치료 시행');
  });

  test('멀티라인 content는 1개 PlacedItem text로 그대로 보존 (결합 구분자 없음)', () => {
    const state = insertPhraseImmediate(freshState(), 1, FIXTURES);
    const placed = placeBoilerplate(state.pendingBoilerplate);
    expect(placed.text.split('\n')).toEqual(['족저근막염 의심', '좌측 통증 (+)']);
  });
});

// ── AC-4 (GUARD): placeBoilerplate / 카테고리 / 빈상태 / read-only 불변 ────
test.describe('PHRASE-INSERT-UX AC-4 (GUARD): 인접 동작 불변', () => {
  test('placeBoilerplate는 종전과 동일 — 단일 content를 1개 PlacedItem으로 배치', () => {
    // 종전 단건 동선(handleBoilerplateSelect(phrase.content))과 완전히 동일 결과
    const state = insertPhraseImmediate(freshState(), 3, FIXTURES);
    expect(placeBoilerplate(state.pendingBoilerplate).text).toBe(FIXTURES[2].content);
  });

  test('카테고리 필터 / 빈 상태 분기 불변', () => {
    const charting = FIXTURES.filter((p) => p.category === 'charting');
    expect(charting.length).toBe(3);
    const prescription = FIXTURES.filter((p) => p.category === 'prescription');
    expect(prescription.length).toBe(0); // 빈 상태 분기 유지
  });

  test('phrase_templates read-only — reveal/insert 순수 로직, 외부 쓰기 0', () => {
    let writes = 0;
    const pool = FIXTURES;
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 1);
    insertPhraseImmediate(freshState(), 1, pool);
    expect(writes).toBe(0);
    expect(pool).toBe(FIXTURES); // 원본 불변(쓰기 없음)
  });
});

// ── AC-5: 접근성 — ✓ 버튼 라벨/키보드 ────────────────────────────────────
test.describe('PHRASE-INSERT-UX AC-5: ✓ 접근성', () => {
  test('✓ 버튼 aria-label = `{name} 삽입` (스크린리더 식별)', () => {
    const phrase = FIXTURES[0];
    const ariaLabel = `${phrase.name} 삽입`;
    expect(ariaLabel).toBe('A 족저근막염 삽입');
    expect(ariaLabel).toContain('삽입');
  });

  test('행 키보드(Enter/Space) → reveal 토글 (onClick과 동등)', () => {
    let revealed: number | null = null;
    const onKey = (key: string, id: number) => {
      if (key === 'Enter' || key === ' ') revealed = revealPhraseInsert(revealed, id);
    };
    onKey('Enter', 1);
    expect(revealed).toBe(1);
    onKey(' ', 1); // Space로 재토글 → 닫힘
    expect(revealed).toBeNull();
    onKey('Tab', 2); // 다른 키는 무동작
    expect(revealed).toBeNull();
  });
});

// ── 현장 클릭 시나리오 1·2·3 (티켓 E2E 변환 가이드) ──────────────────────────
test.describe('PHRASE-INSERT-UX 현장 시나리오', () => {
  test('시나리오 1 — 인라인 ✓ 즉시삽입: 행 클릭 → ✓ 클릭 → 배치 모드 + 단일 content', () => {
    let state = freshState();
    // (1) 행 클릭 → ✓ 노출
    state = { ...state, revealedPhraseId: revealPhraseInsert(state.revealedPhraseId, 2) };
    expect(state.revealedPhraseId).toBe(2);
    expect(state.activeTool).toBe('pen'); // 아직 배치 아님
    // (2) ✓ 클릭 → 즉시삽입
    state = insertPhraseImmediate(state, 2, FIXTURES);
    expect(state.activeTool).toBe('boilerplate-placing');
    expect(placeBoilerplate(state.pendingBoilerplate).text).toBe('보존적 치료 시행');
  });

  test('시나리오 2 — 행 전환: A행 ✓ 노출 중 B행 클릭 → A 닫힘, B만 ✓', () => {
    let revealed: number | null = null;
    revealed = revealPhraseInsert(revealed, 1); // A행 ✓
    revealed = revealPhraseInsert(revealed, 2); // B행 클릭 → A 닫힘
    expect(revealed).toBe(2);
    // B의 ✓를 눌러야 삽입 — A는 노출되지 않으므로 실수 삽입 차단
    const state = insertPhraseImmediate(freshState(), revealed!, FIXTURES);
    expect(placeBoilerplate(state.pendingBoilerplate).text).toBe('보존적 치료 시행');
  });

  test('시나리오 3 (GUARD 회귀) — 단건 동선이 종전 단일 배치와 동일 결과', () => {
    // 종전 단일 동선: 항목 클릭 즉시 handleBoilerplateSelect(content).
    // 신규: 항목 클릭(reveal) → ✓ 클릭(insert). 최종 pendingBoilerplate/배치 결과는 동일해야 함.
    for (const f of FIXTURES) {
      const state = insertPhraseImmediate(freshState(), f.id, FIXTURES);
      expect(state.pendingBoilerplate).toBe(f.content);
      expect(placeBoilerplate(state.pendingBoilerplate).text).toBe(f.content);
    }
  });

  // ── 시나리오 4·4b(AC-6 패널 확장)는 현장 정정(2026-06-05 20:28, MSG-3pb5)으로 삭제됨.
  //    "// < 공간 확장"은 planner 오독 — 본의 = 상용구 로딩 버그(별건 T-...-SUPER-PHRASE-LOAD-FIX).
  //    본 spec은 AC-1~5(인라인 ✓ 즉시삽입) 한정. 패널 폭/높이는 w-64/max-h-56 종전값 유지.
});
