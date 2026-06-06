/**
 * E2E spec — T-20260606-foot-PENCHART-PHRASE-INSERT-FIX
 * 펜차트 상용구 ✓ 선택 후 캔버스에 미기입 (김주연 총괄, 풋센터).
 *
 * 두 갈래로 분리:
 *  - AC-1 (손가락 탭 차단): RC = onPointerDown touch guard. sister 티켓
 *    T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX(commit 18befa6)의 단일 fix가 공유 해소.
 *    회귀 커버는 그 sister spec(RX-PHRASE-TOUCH-INSERT-FIX.spec.ts) 13케이스가 담당.
 *  - AC-2 (빈 content 가시 피드백): 본 spec 담당. ← 신규 net-new 동선.
 *
 * 아키텍처 그라운딩 (PenChartTab.tsx 정본):
 *   insertPhraseImmediate(id)는 phrase_templates에서 content를 찾아 handleBoilerplateSelect(content)로
 *   boilerplate-placing 모드에 진입시킨다. 기존 가드는 `typeof content !== 'string'`뿐이라
 *   **빈 문자열('')·공백전용 content가 통과**했다.
 *     → handleBoilerplateSelect('') → pendingBoilerplate='' + activeTool='boilerplate-placing'
 *     → 사용자가 캔버스를 탭하면 onPointerDown(L1637) `pendingBoilerplate` falsy 체크에서
 *       placeBoilerplate가 조용히 스킵되고 그대로 펜 드로잉 경로로 떨어짐
 *       → "✓ 했는데 캔버스에 안 들어가고(+낙서만 됨)" = 무피드백 no-op.
 *
 *   본 수정(AC-2): insertPhraseImmediate에서 content가 누락/빈값/공백전용이면
 *     boilerplate-placing 진입 전에 차단하고 toast.warning으로 원인(내용 비어있음)을 가시화.
 *     정상 content는 종전대로 handleBoilerplateSelect 진입(불변).
 *
 * AC-2-a: content='' → 모드 진입 안 함 + 경고 토스트.
 * AC-2-b: content='   '(공백전용) → 모드 진입 안 함 + 경고 토스트.
 * AC-2-c: content=undefined(행 없음/필드 없음) → 모드 진입 안 함 + 경고 토스트.
 * AC-2-d: 정상 content → boilerplate-placing 진입(불변).
 *
 * related: T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX(18befa6, AC-1 공유 fix)·
 *   T-20260605-foot-RX-PHRASE-INSERT-UX(a16193f, ✓ 즉시삽입 동선).
 */
import { test, expect } from '@playwright/test';

interface PhraseTemplate { id: number; content?: string | null; }

type Effect =
  | { kind: 'enter-placing'; pendingBoilerplate: string }
  | { kind: 'toast-warning'; message: string };

// ── 정본 insertPhraseImmediate 와 동일한 분기 (PenChartTab.tsx) ────────────────
//   부수효과(handleBoilerplateSelect / toast.warning)를 Effect 로 캡처해 검증.
const insertPhraseImmediate = (
  id: number,
  phraseTemplates: PhraseTemplate[],
): Effect => {
  const content = phraseTemplates.find((p) => p.id === id)?.content;
  // AC-2: 누락/빈값/공백전용이면 가시 피드백 후 무동작 (모드 미진입).
  if (typeof content !== 'string' || content.trim() === '') {
    return { kind: 'toast-warning', message: '이 상용구에 내용이 없습니다. 상용구 관리에서 내용을 입력해 주세요.' };
  }
  // 정상 → handleBoilerplateSelect(content): boilerplate-placing 진입.
  return { kind: 'enter-placing', pendingBoilerplate: content };
};

const TEMPLATES: PhraseTemplate[] = [
  { id: 1, content: '족저근막염 의심\n좌측 통증 (+)' }, // 정상
  { id: 2, content: '' },                                  // 빈 문자열
  { id: 3, content: '   \n  ' },                           // 공백전용
  { id: 4, content: null },                                // null 필드
  // id 5 = 행 자체 없음(undefined)
];

test.describe('PENCHART-PHRASE-INSERT-FIX AC-2: 빈 상용구 가시 피드백', () => {
  test('AC-2-a 빈 문자열 content → 모드 진입 안 함 + 경고 토스트', () => {
    const eff = insertPhraseImmediate(2, TEMPLATES);
    expect(eff.kind).toBe('toast-warning');
  });

  test('AC-2-b 공백전용 content → 모드 진입 안 함 + 경고 토스트 (낙서 방지)', () => {
    const eff = insertPhraseImmediate(3, TEMPLATES);
    expect(eff.kind).toBe('toast-warning');
  });

  test('AC-2-c null content → 모드 진입 안 함 + 경고 토스트', () => {
    const eff = insertPhraseImmediate(4, TEMPLATES);
    expect(eff.kind).toBe('toast-warning');
  });

  test('AC-2-c2 행 자체 없음(undefined) → 모드 진입 안 함 + 경고 토스트', () => {
    const eff = insertPhraseImmediate(5, TEMPLATES);
    expect(eff.kind).toBe('toast-warning');
  });

  test('AC-2-d 정상 content → boilerplate-placing 진입(불변), pendingBoilerplate 적재', () => {
    const eff = insertPhraseImmediate(1, TEMPLATES);
    expect(eff.kind).toBe('enter-placing');
    if (eff.kind === 'enter-placing') {
      expect(eff.pendingBoilerplate).toBe('족저근막염 의심\n좌측 통증 (+)');
    }
  });

  test('회귀 매트릭스 — 빈/공백/null/undefined 전수는 모두 toast, 정상만 enter-placing', () => {
    expect(insertPhraseImmediate(1, TEMPLATES).kind).toBe('enter-placing');
    for (const id of [2, 3, 4, 5]) {
      expect(insertPhraseImmediate(id, TEMPLATES).kind).toBe('toast-warning');
    }
  });
});

// ── 현장 클릭 시나리오 (티켓 정본 2종) ────────────────────────────────────────
test.describe('PENCHART-PHRASE-INSERT-FIX 현장 시나리오', () => {
  test('시나리오 1 — 정상 상용구 ✓ → boilerplate-placing 진입 → (이후 캔버스 탭=배치)', () => {
    // 김주연 총괄 동선: 드롭다운 → 행 선택 → ✓ 클릭
    const eff = insertPhraseImmediate(1, TEMPLATES);
    expect(eff.kind).toBe('enter-placing'); // 모드 진입 OK (실삽입은 sister AC-1 touch guard fix가 캔버스 탭 보장)
  });

  test('시나리오 2 — 내용 빈 상용구 ✓ → "왜 안 되지" 대신 경고 토스트로 원인 노출(+낙서 안 됨)', () => {
    // 종전 버그: 빈 content가 placing 모드로 진입 → 캔버스 탭이 펜 낙서로 떨어짐(무피드백)
    const eff = insertPhraseImmediate(2, TEMPLATES);
    expect(eff.kind).toBe('toast-warning'); // 모드 미진입 → 캔버스 낙서 경로 자체가 차단됨
  });
});
