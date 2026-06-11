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
 * ── REOPEN6 정책 전환 (planner FIX-REQUEST, T-20260525-BLACKSCR) ───────────────
 *   f9696ff는 "검정화면=iOS WebKit 전용" 전제로 기기별 조건부 desync(Android=ON)를 복원했으나,
 *   6/6 17:10 김주연 총괄 갤럭시탭(Android Chrome)에서 검정화면 재발 → 그 전제가 실기기로 반증됨.
 *   ∴ 결정: 검정화면(P0 운영중단) > 펜 latency(P1). 양립 불가 → **desync=OFF 전 기기 통일**.
 *   Android=ON 분기(isIOS 판별) 제거. Galaxy Tab 저지연은 desync 비의존 hot-path
 *   (PEN-SLOW Fix-2 ctx캐싱 / Fix-3 rect캐싱 / Fix-8 native pointermove + coalesced)로만 확보하고,
 *   추가 저지연은 desync 비의존 별도 후속 티켓으로 분리(후순위).
 *   override: ?penchart_no_desync(강제OFF·기본동일) > ?penchart_enable_desync(테스트 강제ON) > 기본 OFF.
 *
 * AC-1: 환불/비급여 동의서 캔버스 마운트 + 펜 입력 hot-path(native pointermove, coalesced) 보존.
 * AC-2: desync=OFF 전 기기 통일 — isIOS 기기 분기 제거 + useDesync 기본값 false.
 * AC-3: 긴급 폴백 킬스위치(?penchart_no_desync) → 강제 OFF 경로 존재.
 * AC-4: 회귀 비파괴 — PEN-SLOW Fix-2/3/8 + 자동채움 + DRAW_DPR=2 유지.
 *
 * ⚠️ Galaxy Tab 저지연(desync 비의존)은 별도 후속 티켓으로 닫는다.
 *    Playwright 코드증거(구조 검증)는 검정화면 재발 차단 게이트 역할.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC = 'src/components/PenChartTab.tsx';

test.describe('T-20260606-foot-PENCHART-REFUND-PEN-MISS', () => {

  // ── AC-2 핵심: REOPEN6 desync=OFF 전 기기 통일 ──────────────────────────────
  test('AC-2: initDrawCanvas — isIOS 기기 분기 제거 + useDesync 기본값 false (검정화면 안전 우선)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    expect(initDrawIdx, 'initDrawCanvas 없음').toBeGreaterThan(0);
    // 주석 블록이 크므로 충분한 윈도우 사용
    // SPEC-DRIFT-REPAIR(T-20260612): 고정 4000자 윈도는 누적 주석으로 `desynchronized: useDesync`(rel 4373)를 놓침.
    //   initDrawCanvas 함수 끝 경계(다음 `= useCallback`)까지 앵커 → 함수 본문 전체 포착(드리프트 내성). assertion 무변경.
    const drawEnd = src.indexOf('= useCallback', initDrawIdx + 50);
    const block = src.slice(initDrawIdx, drawEnd > initDrawIdx ? drawEnd : initDrawIdx + 8000);

    // REOPEN6: 기기별 분기(isIOS/Android=ON) 완전 제거 — 검정화면 재도입축 차단
    expect(block, 'isIOS 기기 분기 잔존 — Android=ON 검정화면 재발 위험').not.toContain('const isIOS');

    // useDesync 기본 분기는 false (override 없으면 desync 비활성)
    const useDesyncDecl = block.match(/const useDesync\s*=.*?;/s);
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 선언 없음').not.toEqual('');
    expect(useDesyncDecl?.[0] ?? '', '기기 분기(isIOS) 잔존').not.toContain('isIOS');
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 기본값 false 아님').toMatch(/:\s*false\s*;/);

    // getContext에 useDesync 전달
    expect(block).toContain('desynchronized: useDesync');
  });

  // ── AC-3: 긴급 폴백 킬스위치 ─────────────────────────────────────────────────
  test('AC-3: ?penchart_no_desync 강제 OFF + ?penchart_enable_desync 강제 ON override 존재', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    // SPEC-DRIFT-REPAIR(T-20260612): 고정 4000자 윈도는 누적 주석으로 `desynchronized: useDesync`(rel 4373)를 놓침.
    //   initDrawCanvas 함수 끝 경계(다음 `= useCallback`)까지 앵커 → 함수 본문 전체 포착(드리프트 내성). assertion 무변경.
    const drawEnd = src.indexOf('= useCallback', initDrawIdx + 50);
    const block = src.slice(initDrawIdx, drawEnd > initDrawIdx ? drawEnd : initDrawIdx + 8000);

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

  // ── OFFSET 축 (재오픈 NEW-TASK MSG-20260606-150440): 스크롤 stale-rect → 오프셋/미등록 수정 ──
  //   루트코즈: strokeRectRef는 onPointerDown 1회 캐싱 → 3p 대형 폼(1588×6738) overflow-auto +
  //   touchAction:'pan-y' 환경서 획 중/직후 스크롤 시 캐시 rect.top stale → toLogical Y 오프셋.
  //   수정: scroll 리스너가 dirty 플래그 세팅(레이아웃 read 0) → 다음 pointermove에서 rect/scale 1회 재측정.
  //   실기기 펜 정밀도는 Playwright 한계 → 구조 검증(코드 인과체인 보존)으로 게이트, 실필기는 field-soak.
  test('PEN-MISS AC-2: 스크롤 시 strokeRect 캐시 무효화(dirty) 경로 존재', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // dirty 플래그 ref 선언
    expect(src, 'strokeRectDirtyRef 선언 없음').toContain('strokeRectDirtyRef');

    // window scroll 리스너(capture) — 어떤 조상 overflow 컨테이너 스크롤도 캡처
    expect(src).toMatch(/addEventListener\(\s*'scroll'/);
    // 드로잉 중일 때만 dirty 세팅 (스크롤 핸들러는 레이아웃 read 없이 boolean 만)
    expect(src).toContain('if (drawingRef.current) strokeRectDirtyRef.current = true');
  });

  test('PEN-MISS AC-1: dirty 시 native pointermove hot-path가 rect/scale 1회 재측정', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const fnIdx = src.indexOf('const handleNativePointerMove');
    expect(fnIdx, 'handleNativePointerMove 없음').toBeGreaterThan(0);
    const block = src.slice(fnIdx, fnIdx + 4500);

    // hot-path에서 dirty 분기로 rect 재측정 (스크롤 후에만, 매 move 아님)
    expect(block, 'dirty 분기 없음').toContain('if (strokeRectDirtyRef.current)');
    expect(block, 'rect 재측정 없음').toContain('canvas.getBoundingClientRect()');
    // 재측정 후 dirty 해제
    expect(block).toContain('strokeRectDirtyRef.current = false');
  });

  test('PEN-MISS AC-3: onPointerDown fresh rect 캐싱 시 dirty 해제(스크롤 잔여 플래그 제거)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const fnIdx = src.indexOf('const onPointerDown =');
    expect(fnIdx).toBeGreaterThan(0);
    const block = src.slice(fnIdx, fnIdx + 1200);

    // onPointerDown에서 rect 캐싱 직후 dirty 해제 → 갓 측정한 rect를 곧바로 stale 처리하지 않음
    expect(block).toContain('strokeRectRef.current = canvas.getBoundingClientRect()');
    expect(block).toContain('strokeRectDirtyRef.current = false');
  });

  test('PEN-MISS AC-3: pan-y 스크롤(AC-3) 비파괴 — scroll 리스너 passive 등록', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    // passive:true → 스크롤 성능 저하/scroll-block 회귀 없음
    expect(src).toMatch(/addEventListener\(\s*'scroll',[\s\S]{0,80}passive:\s*true/);
  });

  // ── 안전 가드: 전 기기 검정화면 비재발 보장 (REOPEN6) ─────────────────────────
  test('SAFETY: override 없으면 전 기기 desync=false — 검정화면(iOS+Android) 비재발 보장', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    // SPEC-DRIFT-REPAIR(T-20260612): 고정 4000자 윈도는 누적 주석으로 `desynchronized: useDesync`(rel 4373)를 놓침.
    //   initDrawCanvas 함수 끝 경계(다음 `= useCallback`)까지 앵커 → 함수 본문 전체 포착(드리프트 내성). assertion 무변경.
    const drawEnd = src.indexOf('= useCallback', initDrawIdx + 50);
    const block = src.slice(initDrawIdx, drawEnd > initDrawIdx ? drawEnd : initDrawIdx + 8000);
    const useDesyncDecl = (block.match(/const useDesync\s*=.*?;/s)?.[0]) ?? '';

    // 기본 분기는 false — 기기 판별 없이 전 기기 OFF (iOS+Android 검정화면 안전).
    // 강제 ON(penchart_enable_desync)은 명시적 테스트 경로로만 허용(현장 사용 금지).
    expect(useDesyncDecl, '기기 분기(isIOS) 잔존 — Android 검정화면 위험').not.toContain('isIOS');
    expect(useDesyncDecl, '기본값 false 아님 — 검정화면 안전 미보장').toMatch(/:\s*false\s*;/);
    // willChange:'transform' 잔존 금지 (REOPEN3 보존)
    const drawCanvasIdx = src.indexOf('ref={canvasRef}');
    const styleBlock = src.slice(drawCanvasIdx, drawCanvasIdx + 600);
    expect(styleBlock).not.toContain("willChange: 'transform'");
  });
});
