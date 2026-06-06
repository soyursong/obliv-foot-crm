/**
 * T-20260606-foot-PENCHART-REFUND-LATENCY (P1)
 * 환불/비급여 동의서 대형 캔버스(794×3369 논리 → DRAW_DPR=2 = 1588×6738 물리, ~42MB)
 * Galaxy Tab 펜 저지연 — desync 비의존 경로.
 *
 * 배경: REFUND-PEN-MISS(desync 기기별 복원)는 BLACKSCR REOPEN6(83f07b6 desync=OFF 전기기 통일)로
 *       superseded. desync는 기기무관 검정화면(P0) 유발축으로 실기기 확정 → 재도입 절대 금지.
 *       본 티켓이 latency 정본 — desync 비의존 경로(단일 path 배칭 + 실기기 프로파일러)로만 접근.
 *
 * ── 핵심 fix (desync 비의존) ──────────────────────────────────────────────────
 *   기존 hot-path: coalesced 점마다 beginPath()+stroke() 개별 호출 → N점 = N회 stroke flush.
 *   대형 캔버스에서 flush 1회당 래스터/합성 비용이 커 N배 누적 → "선 끊김·거침·느림".
 *   개선: pointermove 1회의 coalesced 점들을 단일 path 로 누적 후 stroke() 1회 (flush N→1).
 *         quadratic 스무딩 기하 동일(연속 path 라 조인트는 더 매끈). 픽셀 동일·desync 미사용.
 *
 * ── 프로파일러(측정 선행) ─────────────────────────────────────────────────────
 *   ?penchart_perf 게이트 — 획 종료 시 console.log('[PenChartTab PERF] {...}') 1줄.
 *   coalescedPerMove / avgDrawMs / maxFrameGapMs 로 "coalesce 손실 vs redraw 비용" 가설을 가른다.
 *   → 김주연 총괄 Galaxy Tab field-soak 캡처로 Phase-2(필요 시) 타깃 확정.
 *
 * AC-1: desync 비의존 저지연 — 펜 단일 path 배칭(stroke flush 횟수 감소) 적용.
 *       (실기기 부드러움 체감은 field-soak로 닫음 — 김주연 총괄 U0ATDB587PV/C0ATE5P6JTH)
 * AC-2(최우선 안전): 검정화면 비재발 — desync 미사용(useDesync 기본 false, isIOS 분기 없음),
 *       willChange:'transform' 없음. BLACK 회귀 spec REOPEN6-FINAL 와 동일 불변식 재검증.
 * AC-3: iPad·타 양식·REFUND-AUTOFILL·PEN-SLOW Fix-1~8 비파괴.
 *
 * 구조 검증(코드증거) — 검정화면 재발 차단 게이트. 실기기 latency 체감은 field-soak.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC = 'src/components/PenChartTab.tsx';

test.describe('T-20260606-foot-PENCHART-REFUND-LATENCY', () => {

  // ── AC-1: 펜 단일 path 배칭(stroke flush 횟수 N→1) ───────────────────────────
  test('AC-1: 펜 hot-path — coalesced 점을 단일 path 로 누적 후 stroke() 1회 (flush 횟수 감소)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const fnIdx = src.indexOf('const handleNativePointerMove = useCallback');
    expect(fnIdx, 'handleNativePointerMove 없음').toBeGreaterThan(0);
    const fnEnd = src.indexOf('}, []); // eslint-disable-line', fnIdx);
    expect(fnEnd, 'handleNativePointerMove 종료 경계 없음').toBeGreaterThan(fnIdx);
    const fn = src.slice(fnIdx, fnEnd);

    // 펜 전용 배칭 분기: tool === 'pen' 블록 안에서 beginPath 1회 + 단일 stroke
    const penBranchIdx = fn.indexOf("if (tool === 'pen') {", fn.indexOf("const eraserSz"));
    expect(penBranchIdx, '펜 배칭 분기(if tool===pen) 없음').toBeGreaterThan(0);
    // 펜 분기 끝 = 펜 외 도구 블록의 white 마커 직전까지 (그 사이엔 펜 stroke 1회만 존재)
    const whiteMarkerIdx = fn.indexOf("tool === 'white'", penBranchIdx);
    expect(whiteMarkerIdx, '펜 외 도구(white) 경계 마커 없음').toBeGreaterThan(penBranchIdx);
    const penBranch = fn.slice(penBranchIdx, whiteMarkerIdx);
    expect(penBranch, '단일 path 배칭 플래그(drewSomething) 없음').toContain('drewSomething');
    expect(penBranch, '배칭 path 시작(beginPath) 없음').toContain('ctx.beginPath()');
    expect(penBranch, '연속 곡선 이어붙임(quadraticCurveTo) 없음').toContain('ctx.quadraticCurveTo(');
    // 펜 분기 안 stroke() 는 정확히 1회 (점별 stroke 제거 확인)
    const penStrokeCount = (penBranch.match(/ctx\.stroke\(\)/g) ?? []).length;
    expect(penStrokeCount, `펜 분기 stroke() ${penStrokeCount}회 — 단일 stroke(1회) 아님`).toBe(1);
  });

  // ── AC-1: 빠른 획 누락 방지(coalesced events) 유지 ──────────────────────────
  test('AC-1: coalesced events + native pointermove hot-path(ctx/rect/scale 캐싱) 보존', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    expect(src).toContain('handleNativePointerMove');
    expect(src).toContain("addEventListener('pointermove', handleNativePointerMove");
    expect(src).toContain('getCoalescedEvents');
    expect(src).toContain('drawCtxRef.current');
    expect(src).toContain('strokeRectRef.current');
    expect(src).toContain('strokeScaleRef.current');
  });

  // ── AC-1(측정 선행): 실기기 펜 지연 프로파일러 게이트 ──────────────────────────
  test('AC-1: ?penchart_perf 프로파일러 — 게이트 + 획 종료 PERF 로그(병목 판정 지표)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // perfRef 선언 + URL 게이트
    expect(src, 'perfRef 프로파일러 ref 없음').toContain('const perfRef = useRef');
    expect(src, '?penchart_perf 게이트 없음').toContain("_search.includes('penchart_perf')");

    // 획 종료 PERF 요약 로그 + 가설 판정 지표 3종
    expect(src, 'PERF 요약 로그 없음').toContain('[PenChartTab PERF]');
    expect(src, 'coalesce 손실 지표(coalescedPerMove) 없음').toContain('coalescedPerMove');
    expect(src, 'redraw 비용 지표(avgDrawMs) 없음').toContain('avgDrawMs');
    expect(src, 'jank 지표(maxFrameGapMs) 없음').toContain('maxFrameGapMs');

    // 게이트 OFF 시 prod hot-path 오버헤드 0 — enabled 분기로 가드
    expect(src).toContain('perf.enabled');
  });

  // ── AC-2(최우선 안전): 검정화면 비재발 — desync 미사용 불변식 ──────────────────
  test('AC-2: initDrawCanvas — useDesync 기본 false + isIOS 기기분기 없음 + desync=OFF 통일 유지', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    expect(initDrawIdx).toBeGreaterThan(0);
    const block = src.slice(initDrawIdx, initDrawIdx + 4500);

    // 기기 분기(isIOS/Android=ON) 재도입 금지 — 검정화면 재도입축 차단
    expect(block, 'isIOS 기기 분기 잔존 — Android=ON 검정화면 재발 위험').not.toContain('const isIOS');
    // useDesync 기본값 false
    const useDesyncDecl = block.match(/const useDesync\s*=.*?;/s)?.[0] ?? '';
    expect(useDesyncDecl, 'useDesync 선언 없음').not.toBe('');
    expect(useDesyncDecl, 'isIOS 기기 분기 잔존').not.toContain('isIOS');
    expect(useDesyncDecl, 'useDesync 기본값 false 아님').toMatch(/:\s*false\s*;/);
    // getContext에 useDesync 전달 + 킬스위치 유지
    expect(block).toContain('desynchronized: useDesync');
    expect(block).toContain('penchart_no_desync');
    expect(block).toContain('penchart_enable_desync');
  });

  test('AC-2: draw canvas(canvasRef) style 에 willChange:"transform" 없음 (검정화면 방지 유지)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    const drawCanvasIdx = src.indexOf('ref={canvasRef}');
    expect(drawCanvasIdx).toBeGreaterThan(0);
    const styleBlock = src.slice(drawCanvasIdx, drawCanvasIdx + 600);
    expect(styleBlock, "willChange:'transform' 잔존 — 검정화면 재발 위험").not.toContain("willChange: 'transform'");
  });

  // ── AC-1: 대형 캔버스(환불/비급여 동의서) 정의 보존 ──────────────────────────
  test('AC-1: 환불/비급여 동의서 form_key + 대형 캔버스 높이(3369) + DRAW_DPR=2 유지', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    expect(src).toContain("form_key: 'refund_consent'");
    expect(src).toContain('CANVAS_H_REFUND_CONSENT = 3369');
    expect(src).toContain('isRefundConsentKey');
    expect(src).toContain('const DRAW_DPR = 2');
  });

  // ── AC-3: 회귀 비파괴 — AUTOFILL / PEN-SLOW Fix / 펜 외 도구 ────────────────────
  test('AC-3: REFUND-AUTOFILL + PEN-SLOW Fix(2/3/5/8) + eraser/white/highlight 도구 비파괴', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // 자동채움
    expect(src).toContain('drawPenChartAutofillInline');
    expect(src).toContain('drawRefundP3DateAutofill');
    expect(src).toContain('drawAutofillOnCtx');

    // PEN-SLOW 누적 최적화 보존
    expect(src).toContain('captureUndoAsync');   // Fix-5 async 사전 캡처
    expect(src).toContain('flushPendingUndo');   // Fix-5
    expect(src).toContain('lastMidRef');         // bezier 스무딩 상태

    // 펜 외 도구는 점별 처리 유지(배칭 미적용) — eraser clearRect / white·highlight stroke
    const fnIdx = src.indexOf('const handleNativePointerMove = useCallback');
    const fnEnd = src.indexOf('}, []); // eslint-disable-line', fnIdx);
    const fn = src.slice(fnIdx, fnEnd);
    expect(fn).toContain("tool === 'eraser'");
    expect(fn).toContain("tool === 'white'");
    expect(fn).toContain("tool === 'highlight'");
    expect(fn).toContain('ctx.clearRect(');               // eraser 보존
    expect(fn).toContain('whiteStrokePathRef.current.push'); // white hit-test 누적 보존
  });
});
