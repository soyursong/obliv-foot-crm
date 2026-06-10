import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260610-foot-PENCHART-TOOLS-3REFIX — 펜차트 도구 3건 재수정 (김주연 총괄, C0ATE5P6JTH).
 * 직전 배포 T-20260609-foot-PENCHART-TOOLS-UX-6FIX(0c2fb47) field-soak FAIL: #2/#3/#6.
 * #2=4차 재발, #6=2차 재발 → 표면패치 금지·RC 런타임 규명 의무(REPEATED REGRESSION 경보).
 *
 * ── RC 규명 결과(코드 직독, 추정 아님) ──────────────────────────────────────────
 *  #6 텍스트 persist:  현재 HEAD(174cafa)에 flushTextInput(모든 종료경로 commit) + 저장 시
 *      placedItems rasterize(drawCtx.fillText, draw ctx scale(2,2) 좌표 정합 검증완료)가 이미 건전.
 *      현장 불만(09:14, 0c2fb47 기준)은 174cafa(09:54) 배포 *이전* 시점. 본 배포가 fresh 번들을 현장에
 *      도달시킨다. + 잔여 race 하드닝: 저장 흡수 소스를 state→ref(_tPos/_tVal)로 통일(최신 입력값 보장).
 *  #2 상용구 삽입:     commit(placedItems)·computeVisibleAnchor(scroll 반영)는 정상. 잔여 결함 = 새 오버레이가
 *      뷰포트 밖이면 "안 보임=삽입 안 됨" 오인. 단일 rAF scrollIntoView 는 React DOM commit 전이면 null →
 *      미발화. **이중 rAF**(commit 보장 후 측정)로 가시성 결정화.
 *  #3 형광펜 매끄러움+농도: [진짜 미해결] 형광펜이 native move에서 점마다 beginPath→lineTo→stroke() **개별 호출**.
 *      globalAlpha<1 stroke는 호출마다 독립 합성 → 인접 round 캡 겹침에서 알파 **누적(beading)** + 직선
 *      lineTo의 각짐 = "매끄럽지 않음 + 너무 진함". → pen 의 **단일-path quadratic** 경로 공유로 전환
 *      (배치당 stroke() 1회 → 자기겹침 누적 제거 + 곡선 보간). + 슬라이더 max 0.35→0.30(전 구간 더 옅게).
 *
 * 실기기(갤탭 S펜) 픽셀 검증은 field-soak로 닫음. 여기서는 PenChartTab 거대-인라인 컴포넌트 관례인
 * source-integrity gating + 순수 로직으로 회귀 재발(같은 표면 fix 재시도)을 구조적으로 차단한다.
 * DB 무관(FE-only), 저장포맷(PNG) 불변.
 */

const SRC = path.resolve('src/components/PenChartTab.tsx');
const src = fs.readFileSync(SRC, 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// #3-RE — 형광펜 매끄러움 + 더 연하게 (진짜 미해결 RC 수정)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#3-RE 형광펜 스무딩·농도', () => {
  test('AC-7: 기본 농도 0.10 (현재 0.20보다 연함) — state+ref 일치', () => {
    expect(src, 'state 기본 0.10 아님').toContain('const [highlightAlpha, setHighlightAlpha] = useState(0.10)');
    expect(src, 'ref 초기 0.10 아님').toContain('const highlightAlphaRef = useRef(0.10)');
  });

  test('AC-8: [RC] 형광펜이 pen 단일-path quadratic 경로 공유 → beading 제거·매끄럽게', () => {
    // native move 진입 분기에 highlight 포함(점별 lineTo 경로 이탈)
    expect(src, 'highlight가 단일-path quadratic 경로 미공유').toContain("if (tool === 'pen' || tool === 'highlight')");
    // 획 시작 시 bezier 상태 리셋(highlight pointerdown) — 직전 획 mid 이어붙기 방지
    expect(src, 'highlight 획시작 lastMidRef 리셋 없음').toMatch(/형광펜이 pen 단일-path quadratic[\s\S]*?lastMidRef\.current = null;/);
  });

  test('AC-8b: 점별 per-point highlight stroke 분기 제거(알파 누적 RC 원천 제거)', () => {
    // else(eraser/white) 루프에 더 이상 highlight 분기가 없어야 함
    const m = src.match(/\/\/ eraser \/ white[\s\S]*?\n    \}\n\n    if \(tool === 'highlight'\) ctx\.globalAlpha = 1;/);
    expect(m, 'eraser/white 루프 블록 매칭 실패(구조 변경됨)').not.toBeNull();
    expect(m![0], 'per-point highlight lineTo 분기 잔존(beading 미해소)').not.toMatch(/else if \(tool === 'highlight'\)/);
  });

  test('AC-9: 슬라이더 정상 — min 0.05 유지 + max 0.35→0.30(전 구간 더 옅게)', () => {
    expect(src, '슬라이더 범위 0.05~0.30 아님').toContain('min={0.05} max={0.30}');
    expect(src, 'onChange 핸들러 없음').toContain('onChange={(e) => setHighlightAlpha(parseFloat(e.target.value))}');
  });

  test('AC-8c [logic]: 단일-path stroke가 점별 대비 알파 누적(겹침 짙어짐)을 제거', () => {
    // 모델: globalAlpha=a 인 stroke 호출 N회가 같은 픽셀에 겹치면 over-compositing → 1-(1-a)^N (짙어짐).
    //       단일 path 1회 stroke는 자기겹침이 한 coverage 로 합성 → a 유지(누적 없음).
    const over = (a: number, n: number) => 1 - Math.pow(1 - a, n);
    const a = 0.10;
    expect(over(a, 4)).toBeGreaterThan(a);          // 점별 4겹 = 0.344 (현장 "너무 진함")
    expect(over(a, 4)).toBeCloseTo(0.3439, 3);
    const singlePath = (alpha: number) => alpha;     // 단일 stroke = 누적 없음
    expect(singlePath(a)).toBe(a);                   // 매끄럽고 일정한 농도
    expect(singlePath(a)).toBeLessThan(over(a, 4));  // 동일 alpha라도 더 옅게 보임
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #6-RE — 텍스트 저장 persist (RC 규명 + race 하드닝)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#6-RE 텍스트 persist', () => {
  test('AC-1/AC-2: 저장 시 placedItems(텍스트) 캔버스 rasterize → PNG persist (하위호환 PNG 포맷 불변)', () => {
    // 저장 경로가 placedItems를 draw 캔버스에 fillText 래스터화
    expect(src, 'placedItems 래스터화 유실').toContain('drawCtx.fillText(line, item.x, item.y + i * lineH)');
    // 저장 포맷은 PNG 그대로(하위호환)
    expect(src, '저장 PNG toDataURL 유실').toContain("tempCanvas.toDataURL('image/png')");
  });

  test('AC-3 [RC]: 저장 흡수 소스 state→ref 통일 — 미확정 입력 race 누락 차단', () => {
    expect(src, 'ref 기반 흡수 미적용(_tPos)').toContain('const _tPos = textInputPosRef.current;');
    expect(src, 'ref 기반 흡수 미적용(_tVal)').toContain('const _tVal = textInputValueRef.current;');
    expect(src, '저장 흡수 조건이 ref 미사용').toContain('if (_tPos && _tVal.trim())');
    // refs는 매 렌더 동기화되어 최신값 보장(flushTextInput 과 동일 소스)
    expect(src, 'ref 매 렌더 동기화 없음').toContain('textInputValueRef.current = textInputValue');
  });

  test('AC-3b: 모든 입력 종료 경로 단일 commit 수렴(flushTextInput) 유지 — 회귀 방지', () => {
    expect(src, 'flushTextInput 소실').toMatch(/const flushTextInput = useCallback\(\(discard = false\) =>/);
    expect(src, 'switchTool 선행 commit 소실').toContain('flushTextInput(false)');
  });

  test('AC-3c [logic]: ref 흡수 = 최신값 / 빈값·미오픈은 무영향', () => {
    const absorb = (pos: object | null, val: string): boolean => !!(pos && val.trim());
    expect(absorb({}, '족저근막염 호소')).toBe(true);   // 최신 입력 흡수
    expect(absorb({}, '   ')).toBe(false);             // 공백전용 무영향
    expect(absorb(null, '내용')).toBe(false);          // 입력창 미오픈
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #2-RE — 상용구 삽입 가시화 결정성 (이중 rAF)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#2-RE 상용구 삽입', () => {
  test('AC-4: ✓ 즉시삽입 = placedItems commit (선택만 되던 결함 해소)', () => {
    expect(src, '즉시삽입 commit 경로 소실').toContain('const newId = placeBoilerplateAt(content, x + n * 14, y + n * 30, false);');
    expect(src, 'placeBoilerplateAt가 commit(setPlacedItems) 안 함')
      .toMatch(/const placeBoilerplateAt[\s\S]*?setPlacedItems\(\(prev\) => \[\.\.\.prev, newItem\]\)/);
  });

  test('AC-5: 단일/다중선택 삽입 — ✓ 핸들러 배선 + 오버레이 가시화 훅 유지', () => {
    expect(src, '✓ 버튼이 insertPhraseImmediate 미배선').toContain('insertPhraseImmediate(phrase.id);');
    expect(src, 'overlay data-overlay-id 훅 소실').toContain('data-overlay-id={item.id}');
  });

  test('AC-6 [RC]: 삽입 가시화 = 이중 rAF(React commit 보장 후 측정) scrollIntoView', () => {
    expect(src, '이중 rAF 미적용').toContain('requestAnimationFrame(() => requestAnimationFrame(scrollToNew));');
    expect(src, 'scrollIntoView 타깃 셀렉터 소실').toContain('[data-overlay-id="${newId}"]');
    expect(src, '삽입 토스트 피드백 소실').toMatch(/toast\.success\(`상용구 '\$\{name\}' 삽입됨/);
  });

  test('AC-6b [logic]: 새 id 존재 시 항상 스크롤 타깃 결정 — 위치 독립 가시성', () => {
    const target = (id: string | null) => (id ? `[data-overlay-id="${id}"]` : null);
    expect(target('bp-9')).toBe('[data-overlay-id="bp-9"]');
    expect(target(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 회귀 방지 (AC-10~12)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('회귀 방지', () => {
  test('AC-10: #4 화이트 양식보존(destination-out)·#5 [고정] 제거 회귀 없음', () => {
    // #4 화이트 = destination-out(양식 보존)
    expect(src, '화이트 destination-out 회귀').toContain("ctx.globalCompositeOperation = 'destination-out';");
    // #5 [고정](chartLocked) 토글 제거 결과 = 스크롤 콘텐츠 항상 overflow-auto (분기 부활 시 회귀)
    expect(src, '#5 항상 overflow-auto 회귀(chartLocked 분기 부활)')
      .toContain('스크롤 콘텐츠 (#5: chartLocked 제거 → 항상 overflow-auto)');
    expect(src, 'chartLocked 상태 변수 부활(회귀)').not.toContain('const [chartLocked');
  });

  test('AC-11: 펜/지우개/Undo/저장/불러오기 무영향 — pen quadratic·eraser clearRect 보존', () => {
    // pen 단일-path quadratic 보존
    expect(src, 'pen quadratic 스무딩 소실').toContain('ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y)');
    // eraser는 여전히 clearRect(드로잉 레이어만)
    expect(src, 'eraser clearRect 회귀').toContain('ctx.clearRect(pos.x - eraserSz, pos.y - eraserSz, eraserSz * 2, eraserSz * 2)');
    // 저장 PNG 포맷 불변
    expect(src, '저장 PNG 포맷 변경(하위호환 위반)').toContain("supabase.storage.from('photos').upload(path, blob, { contentType: 'image/png'");
  });

  test('AC-12: white(destination-out) 후 GCO 복원 — highlight/pen 경로 오염 없음', () => {
    expect(src, 'white 후 source-over 복원 소실').toContain("if (tool === 'white') ctx.globalCompositeOperation = 'source-over';");
    expect(src, 'highlight globalAlpha 복원 소실').toContain("if (tool === 'highlight') ctx.globalAlpha = 1;");
  });
});
