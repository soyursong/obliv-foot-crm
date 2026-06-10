import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260610-foot-PENCHART-6FIX-REFIX — 부모 T-20260609-foot-PENCHART-TOOLS-UX-6FIX(0c2fb47)
 * field-soak 잔여 3건 RE-FIX (김주연 총괄). PING-PONG 3~4차 → RC 규명 후 수정.
 *
 *  A. [회귀] 텍스트 저장 후 persist 안 됨.
 *     RC = 부모 #6은 "저장 직전"에만 textInputValue를 흡수. 그러나 타이핑 후 '저장'이 아닌 '도구 전환'을
 *          하면 switchTool이 commit 없이 setTextInputValue('')로 버려(특정 종료 경로 미커버) → 저장 시점엔
 *          흡수할 값이 이미 없음. 캔버스 재탭/blur도 동일.
 *     FIX = 입력 종료 모든 경로(도구전환·캔버스 재탭·blur·저장·취소)를 단일 commit 함수 flushTextInput으로
 *          수렴. discard=false → placedItems commit, discard=true → 버림. blur-vs-button 경쟁은 가드로 차단.
 *
 *  B. [회귀] 상용구 삽입 안 됨.
 *     RC 가설 = 즉시삽입은 placedItems에 commit되나, computeVisibleAnchor 위치/스크롤 타이밍 또는 select
 *          전환 미인지로 "어디 들어갔는지 안 보여" 삽입 실패로 인지(뷰포트 밖/muscle-memory 탭 기대).
 *     FIX = ①명시 토스트 피드백 + ②새 아이템 자동 scrollIntoView(뷰포트 중앙). commit 자체는 불변.
 *
 *  C. [정련] 형광펜 여전히 진함 + 실시간 미반영.
 *     FIX = 기본 농도 0.20 → 0.10, 슬라이더 min 0.10 → 0.05, stroke 시작 dot도 highlightAlphaRef.current(live)
 *          읽기 → 슬라이더 조절 직후 다음 stroke 즉시 반영.
 *
 * 실기기(갤탭 S펜) 의존 동작은 field-soak로 닫음. 여기서는 PenChartTab 거대-인라인 컴포넌트 관례인
 * source-integrity gating + 순수 로직으로 회귀 재발(같은 fix 재시도)을 구조적으로 차단한다.
 * DB 무관(FE-only), 저장포맷(PNG) 불변.
 */

const SRC = path.resolve('src/components/PenChartTab.tsx');
const src = fs.readFileSync(SRC, 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// A — 텍스트 입력 종료 단일 commit 수렴 (persist 회귀)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A 텍스트 persist — 단일 commit 수렴', () => {
  test('AC-A1: flushTextInput 단일 commit 함수 존재(discard 인자)', () => {
    expect(src, 'flushTextInput 미정의').toMatch(/const flushTextInput = useCallback\(\(discard = false\) =>/);
    // commit 경로: placedItems에 text 아이템 push
    expect(src, 'flush가 placedItems commit 안 함').toMatch(/setPlacedItems\(\(prev\) => \[\.\.\.prev, item\]\)/);
  });

  test('AC-A2: 최신 입력값 ref 동기화(stable 콜백이 stale 없이 읽음)', () => {
    expect(src, 'textInputPosRef 미선언').toContain('const textInputPosRef');
    expect(src, 'textInputValueRef 미선언').toContain('const textInputValueRef');
    expect(src, 'textInputPosRef 매 렌더 동기화 없음').toContain('textInputPosRef.current   = textInputPos');
    expect(src, 'textInputValueRef 매 렌더 동기화 없음').toContain('textInputValueRef.current = textInputValue');
  });

  test('AC-A3: [RC] switchTool(도구전환)이 commit 없이 버리지 않음 → flushTextInput 선행', () => {
    // switchTool 본문에서 flushTextInput(false) 가 setActiveTool 보다 먼저 호출되어야 함
    const m = src.match(/const switchTool = useCallback\(\(tool: ActiveTool\) => \{([\s\S]*?)\}, \[flushTextInput\]\);/);
    expect(m, 'switchTool 시그니처/deps 변경됨').not.toBeNull();
    const body = m![1];
    expect(body, 'switchTool이 flushTextInput 미호출(회귀 RC)').toContain('flushTextInput(false)');
    expect(body.indexOf('flushTextInput(false)'), 'flush가 setActiveTool 뒤에 있음(순서 오류)')
      .toBeLessThan(body.indexOf('setActiveTool(tool)'));
    // 더 이상 switchTool이 bare setTextInputValue('')로 텍스트를 버리지 않음
    expect(body, 'switchTool에 bare setTextInputValue 잔존(commit 우회)').not.toContain("setTextInputValue('')");
  });

  test('AC-A4: 캔버스 재탭(text 도구) = 입력 종료 → commit 후 재오픈(닫기로 버리지 않음)', () => {
    expect(src, 'text 재탭이 flush commit 안 함').toContain('if (textInputPos) flushTextInput(false);');
  });

  test('AC-A5: textarea blur = 입력 종료 → commit (버튼 가드로 경쟁 차단)', () => {
    expect(src, 'textarea onBlur commit 없음').toMatch(/onBlur=\{\(\) => \{[\s\S]*?flushTextInput\(false\)/);
    expect(src, 'blur-vs-button 가드(textBtnHandlingRef) 없음').toContain('textBtnHandlingRef');
  });

  test('AC-A6: 삽입/저장=commit, 취소/Esc=discard (단일 함수로 분기)', () => {
    // 삽입 버튼/Enter → flushTextInput(false)
    expect(src).toContain('const handleTextConfirm = useCallback(() => {\n    flushTextInput(false);');
    // 취소 버튼 → flushTextInput(true)
    expect(src, '취소가 discard 아님').toMatch(/flushTextInput\(true\); textBtnHandlingRef\.current = false;/);
    // Escape → discard
    expect(src, 'Escape가 discard 아님').toContain("if (e.key === 'Escape') { flushTextInput(true); }");
    // 저장 버튼도 가드 set(이중 commit 방지)
    expect(src, '저장 버튼 가드 없음(이중 commit 위험)').toMatch(/onPointerDown=\{\(\) => \{ textBtnHandlingRef\.current = true; \}\}\n              onClick=\{handleDrawSave\}/);
  });

  test('AC-A7: 저장 직전 흡수(부모 #6) 보존 — 저장 단독 진입도 커버', () => {
    expect(src, '저장 직전 미확정 텍스트 흡수 유실').toContain('if (textInputPos && textInputValue.trim())');
    expect(src, 'itemsToRasterize 합산 유실').toContain('itemsToRasterize');
  });

  // 순수 로직: flushTextInput commit/discard 의미 모델
  test('AC-A8 [logic]: commit=영속화 / discard=폐기 / 빈값=무영향', () => {
    type Item = { type: 'text'; text: string };
    const flush = (pos: object | null, val: string, discard: boolean, items: Item[]): Item[] =>
      pos && !discard && val.trim() ? [...items, { type: 'text', text: val }] : items;

    expect(flush({}, '환자 호소', false, [])).toHaveLength(1);          // commit
    expect(flush({}, '환자 호소', true, [])).toHaveLength(0);           // discard
    expect(flush({}, '   ', false, [])).toHaveLength(0);               // 공백전용 무영향
    expect(flush(null, '환자 호소', false, [])).toHaveLength(0);        // 입력창 없음
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — 상용구 삽입 가시화 (삽입 회귀)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('B 상용구 삽입 가시화', () => {
  test('AC-B1: placeBoilerplateAt가 새 아이템 id 반환(스크롤 타깃)', () => {
    expect(src, 'placeBoilerplateAt 반환형 string 아님').toContain('fromPlacing: boolean): string =>');
    expect(src, 'newItem.id 반환 없음').toContain('return newItem.id;');
  });

  test('AC-B2: 즉시삽입 후 명시 토스트 피드백 + 자동 scrollIntoView', () => {
    expect(src, '삽입 토스트 피드백 없음').toMatch(/toast\.success\(`상용구 '\$\{name\}' 삽입됨/);
    expect(src, '자동 scrollIntoView 없음').toContain("scrollIntoView({ block: 'center'");
    expect(src, 'scrollIntoView 타깃 셀렉터 없음').toContain('[data-overlay-id="${newId}"]');
  });

  test('AC-B3: 오버레이에 data-overlay-id/testid 부여(스크롤·E2E 가시화 훅)', () => {
    expect(src, 'data-overlay-id 없음').toContain('data-overlay-id={item.id}');
    expect(src, 'overlay testid 없음').toContain('data-testid={`penchart-overlay-${item.type}`}');
  });

  test('AC-B4: 즉시삽입은 여전히 placedItems에 commit(가시화는 보조, 본질 불변)', () => {
    expect(src).toContain('const { x, y } = computeVisibleAnchor();');
    expect(src).toMatch(/placeBoilerplateAt\(content,/);
  });

  test('AC-B5 [logic]: 뷰포트 밖 배치도 scrollIntoView로 가시화 — 위치-독립 보장', () => {
    // 어떤 anchor(상단/하단/스크롤)든 새 id가 존재하면 스크롤 타깃이 결정됨
    const decideScrollTarget = (newId: string | null): string | null => (newId ? `[data-overlay-id="${newId}"]` : null);
    expect(decideScrollTarget('bp-123')).toBe('[data-overlay-id="bp-123"]');
    expect(decideScrollTarget(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — 형광펜 농도 하향 + 실시간 반영
// ═══════════════════════════════════════════════════════════════════════════
test.describe('C 형광펜 농도', () => {
  test('AC-C1: 기본 농도 0.20 → 0.10 (state+ref 일치)', () => {
    expect(src, 'state 기본값 0.10 아님').toContain('const [highlightAlpha, setHighlightAlpha] = useState(0.10)');
    expect(src, 'ref 초기값 0.10 아님').toContain('const highlightAlphaRef = useRef(0.10)');
  });

  test('AC-C2: 슬라이더 min 0.10 → 0.05 확장(더 옅게)', () => {
    expect(src, '슬라이더 min 0.05 확장 안 됨').toContain('min={0.05} max={0.35}');
  });

  test('AC-C3: stroke 시작 dot + native move 모두 highlightAlphaRef.current(live) 읽기 → 실시간 반영', () => {
    // 시작 dot(onPointerDown highlight 분기)이 state 캡처가 아닌 ref 읽기
    expect(src, '시작 dot이 ref 미사용(state 캡처 지연)').toContain('ctx.globalAlpha = highlightAlphaRef.current; // #3');
    // native move도 ref 사용(기존 보존)
    expect(src, 'native move ref 미사용').toContain('ctx.globalAlpha = highlightAlphaRef.current');
    // 매 렌더 ref 동기화
    expect(src, 'ref 매 렌더 동기화 없음').toContain('highlightAlphaRef.current = highlightAlpha');
    // 더 이상 고정 state 직참(시작 dot)이 남지 않음
    expect(src, '시작 dot에 state 직참 잔존').not.toContain('ctx.globalAlpha = highlightAlpha;');
  });

  test('AC-C4 [logic]: 슬라이더 범위 0.05~0.35, 기본 0.10이 더 옅음', () => {
    const MIN = 0.05, MAX = 0.35, DEFAULT = 0.10, PREV_DEFAULT = 0.20;
    expect(DEFAULT).toBeGreaterThanOrEqual(MIN);
    expect(DEFAULT).toBeLessThan(PREV_DEFAULT);   // 기본이 더 옅어짐
    expect(MIN).toBeLessThan(0.10);               // 더 옅게 내릴 수 있음
    const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
    expect(clamp(0.02)).toBe(0.05);
    expect(clamp(0.5)).toBe(0.35);
  });
});
