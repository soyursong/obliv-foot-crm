/**
 * T-20260606-foot-PENCHART-REFUND-PEN-MISS
 * 펜차트 환불/비급여 동의서(3페이지 대형 캔버스) 펜 "선 끊김·거침·느림(latency)" 회귀 수정
 *
 * 신고: 김주연 총괄(풋센터 204), 2026-06-06. Galaxy Tab.
 * 증상(현장 정밀화, MERGE-2): "화면 정상(검정 아님) + 펜은 써지나 선이 끊기거나 거칠거나 느림".
 *
 * ── 루트코즈(코드증거 인과체인) ──────────────────────────────────────────────
 *   1. b955a8c(5/24 PEN-SLOW): desynchronized:true 도입 → Galaxy Tab 펜 저지연 확보.
 *   2. cf69be5(5/27 BLACKSCR REOPEN4): iOS Safari opaque IOSurface 검정화면을 잡으려
 *      desynchronized 를 **전 기기 일괄 OFF** → 부작용으로 Android 저지연 경로까지 소실.
 *   3. 6/6 환불/비급여 동의서(794×3369 논리 → DRAW_DPR=2 = 1588×6738 물리, 대형 캔버스)에서
 *      desync 제거로 인한 합성 latency 회귀 = "선 끊김·거침·느림". 타임라인 정합.
 *
 * ── 수정(기기별 조건부 desync 복원) ──────────────────────────────────────────
 *   opaque IOSurface 검정화면 버그는 **iOS WebKit 전용**(cf69be5 §3 코드증거).
 *   iOS = 전 브라우저 WebKit 강제 → iOS 전체 desync OFF 유지(검정화면 비재발 보장).
 *   Android/데스크톱(Galaxy Tab 포함) = 해당 버그 無 → desync ON 복원(저지연 펜).
 *   override 우선순위: ?penchart_no_desync(긴급 강제OFF) > ?penchart_enable_desync(강제ON) > 기기기본.
 *
 * AC-1: 환불/비급여 동의서 캔버스 마운트 + 펜 입력 hot-path(native pointermove, coalesced) 보존.
 * AC-2: 기기별 조건부 desync — iOS=false(검정화면 안전), non-iOS=true(저지연).
 * AC-3: 긴급 폴백 킬스위치(?penchart_no_desync) → 강제 OFF 경로 존재.
 * AC-4: 회귀 비파괴 — PEN-SLOW Fix-2/3/8 + 자동채움 + DRAW_DPR=2 유지.
 *
 * ⚠️ 실기기 필기 정밀도/latency 최종 확인은 field-soak(현장 Galaxy Tab)로 닫는다.
 *    Playwright 코드증거(구조 검증)는 회귀 차단 게이트 역할.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC = 'src/components/PenChartTab.tsx';

test.describe('T-20260606-foot-PENCHART-REFUND-PEN-MISS', () => {

  // ── AC-2 핵심: 기기별 조건부 desync 복원 ─────────────────────────────────────
  test('AC-2: initDrawCanvas — isIOS 판별로 desync 게이트 (iOS=OFF 검정화면 안전, non-iOS=ON 저지연)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    expect(initDrawIdx, 'initDrawCanvas 없음').toBeGreaterThan(0);
    // 주석 블록이 크므로 충분한 윈도우 사용
    const block = src.slice(initDrawIdx, initDrawIdx + 4000);

    // iOS 판별 존재 (iPad/iPhone/iPod + iPadOS 13+ MacIntel 위장 대응)
    expect(block).toContain('const isIOS');
    expect(block).toContain('/iPad|iPhone|iPod/');
    expect(block).toContain('maxTouchPoints');

    // useDesync = (override) ... : !isIOS — 기기기본 iOS=false, 그 외=true
    const useDesyncDecl = block.match(/const useDesync\s*=.*?;/s);
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 선언 없음').not.toEqual('');
    expect(useDesyncDecl?.[0] ?? '').toContain('!isIOS');

    // getContext에 useDesync 전달
    expect(block).toContain('desynchronized: useDesync');
  });

  // ── AC-3: 긴급 폴백 킬스위치 ─────────────────────────────────────────────────
  test('AC-3: ?penchart_no_desync 강제 OFF + ?penchart_enable_desync 강제 ON override 존재', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    const block = src.slice(initDrawIdx, initDrawIdx + 4000);

    // 긴급 폴백: penchart_no_desync → 강제 OFF
    expect(block).toContain("penchart_no_desync");
    // 강제 ON 테스트 param 유지
    expect(block).toContain("penchart_enable_desync");

    // forceOff 가 useDesync 결정에서 최우선(false 강제)
    const useDesyncDecl = (block.match(/const useDesync\s*=.*?;/s)?.[0]) ?? '';
    expect(useDesyncDecl).toContain('_forceOff');
    expect(useDesyncDecl).toContain('_forceOn');
  });

  // ── AC-1: 펜 입력 hot-path 보존 (latency 회복의 또 다른 축) ───────────────────
  test('AC-1: native pointermove hot-path (coalesced events + ctx/rect 캐싱) 보존', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // Fix-8 native pointermove handler
    expect(src).toContain('handleNativePointerMove');
    expect(src).toContain("addEventListener('pointermove', handleNativePointerMove");
    // coalesced events — 빠른 획 누락 방지
    expect(src).toContain('getCoalescedEvents');
    // Fix-2 ctx 캐싱 / Fix-3 rect 캐싱
    expect(src).toContain('drawCtxRef.current');
    expect(src).toContain('strokeRectRef.current');
  });

  // ── AC-1: 환불/비급여 동의서 대형 캔버스 정의 보존 ────────────────────────────
  test('AC-1: 환불/비급여 동의서 form_key + 3페이지 캔버스 높이 상수 유지', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    expect(src).toContain("form_key: 'refund_consent'");
    expect(src).toContain('CANVAS_H_REFUND_CONSENT = 3369');
    expect(src).toContain('isRefundConsentKey');
  });

  // ── AC-4: 회귀 비파괴 ────────────────────────────────────────────────────────
  test('AC-4: PEN-SLOW 최적화 + 자동채움 + DRAW_DPR=2 회귀 없음', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    expect(src).toContain('const DRAW_DPR = 2');
    expect(src).toContain('drawPenChartAutofillInline');
    expect(src).toContain('drawRefundP3DateAutofill');
  });

  // ── 안전 가드: iOS 검정화면 수정 비파괴 (cf69be5 보존) ────────────────────────
  test('SAFETY: iOS 경로는 여전히 desync=false — 검정화면(REOPEN4) 비재발 보장', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    const block = src.slice(initDrawIdx, initDrawIdx + 4000);
    const useDesyncDecl = (block.match(/const useDesync\s*=.*?;/s)?.[0]) ?? '';

    // 기기기본 분기는 !isIOS — 즉 isIOS=true → false (override 없을 때).
    // 강제 ON(penchart_enable_desync)은 명시적 테스트 경로로만 iOS desync 허용(현장 사용 금지).
    expect(useDesyncDecl).toContain('!isIOS');
    // willChange:'transform' 잔존 금지 (REOPEN3 보존)
    const drawCanvasIdx = src.indexOf('ref={canvasRef}');
    const styleBlock = src.slice(drawCanvasIdx, drawCanvasIdx + 600);
    expect(styleBlock).not.toContain("willChange: 'transform'");
  });
});
