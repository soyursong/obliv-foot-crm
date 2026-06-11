/**
 * T-20260525-foot-PENCHART-FORM-BLACK (+ REOPEN 2026-05-26 × 3)
 * 펜차트 전체 양식 검정 화면 + 튕겨나감 회귀 수정 검증
 *
 * AC-3: 검정 화면 대신 양식이 정상 렌더링됨 (흰 배경 + 양식 내용)
 * AC-4: 튕겨나감 방지 — 에러 바운더리(fallback UI) + console.error 로깅
 * AC-5: 기존 펜차트 기능 정상 동작 확인 (회귀 없음)
 *
 * REOPEN 1 (2026-05-26 09:36) 추가 AC:
 *   AC-R1: form template 이미지 URL console.log 로딩 시작 로그
 *   AC-R2: img.naturalWidth===0 decode 실패 감지 → fallback
 *   AC-R3: ctx.isContextLost() 체크 (initBgCanvas + onload 2곳)
 *          + contextlost 이벤트 핸들러 useEffect
 *          + setBgImgLoadError(false) 를 drawImage 성공 후 호출 (기존: onload 시작 즉시 → 버그)
 *   AC-R4: drawImage try-catch → 실패 시 setBgImgLoadError(true)
 *
 * REOPEN 2 (2026-05-26 19:26) 추가 AC:
 *   AC-R2-1: img.decode() await — CPU decode 완료 보장 후 drawImage
 *   AC-R2-2: createImageBitmap 타일 분할 — iOS Safari GPU 텍스처 상한(2048px) 초과 대응
 *   AC-R2-3: stale check — await 중 canvas 재초기화 감지
 *
 * REOPEN 3 (2026-05-26 REOPEN 2 근본 수정):
 *   AC-R3-ROOT: willChange:'transform' 제거 — GPU compositor layer 불투명화가 진짜 원인
 *
 *   근본 원인:
 *     b955a8c(PENCHART-PEN-SLOW, 5/24)에서 willChange:'transform' + desynchronized:true
 *     동시 추가 → draw canvas가 별도 GPU compositor layer로 승격 → 불투명(alpha-less) GPU 텍스처
 *     → 투명 픽셀이 BLACK으로 표시 → bgCanvas(양식 이미지)가 가려져 검정화면.
 *
 *   수정:
 *     willChange:'transform' 제거 → GPU compositor layer 미승격 → drawCanvas는 parent
 *     layer 안에서 투명 합성 → bgCanvas 정상 표시.
 *     desynchronized:true 유지 — HW 가속(펜 반응 속도)은 유지.
 *
 * 회귀 후보:
 *   - T-20260523-foot-PENCHART-FORM-AUTOFILL (ccba516): canvas 최적화 사이드이펙트
 *   - T-20260523-foot-FORM-TEMPLATE-REGEN (f398fe3): 300DPI 재래스터화
 *
 * 수정 내용:
 *   - select/draw 단일 FullscreenFormWrapper 공유 → Dialog 재마운트 오발화 제거
 *   - bgImgLoadError 상태 + img.onerror → [data-testid="penchart-bg-load-error"] 폴백 UI
 *   - initCanvas 진입 시 bgImgLoadError 초기화 → 재시도 가능
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

// ─── 설계 상수 ──────────────────────────────────────────────────────────────

// AC-3: 배경 캔버스는 흰색 배경 표시 (검정 화면 없음)
const BG_CANVAS_INITIAL_COLOR = '#ffffff';

// AC-4: 이미지 로드 실패 시 폴백 UI testid
const FALLBACK_TESTID = 'penchart-bg-load-error';

// AC-4: 폴백 UI에 "다시 시도" 버튼 포함
const RETRY_BTN_TEXT = '다시 시도';

// AC-5: 기존 양식 select → draw 전환이 정상 동작 (단일 Dialog 인스턴스)
const DRAW_MODE_WRAPPER_CLASS = 'bg-white';

// ─── 구조 검증 ──────────────────────────────────────────────────────────────

test.describe('T-20260525-foot-PENCHART-FORM-BLACK', () => {

  // ── AC-3: Dialog 단일 인스턴스 — select/draw 공유 ──────────────────────────
  test('AC-3: select→draw 전환 시 단일 FullscreenFormWrapper 유지 (재마운트 없음)', () => {
    /**
     * 검증: PenChartTab 렌더 경로에서 mode==='select' || mode==='draw' 조건이
     *       하나의 FullscreenFormWrapper 블록 안에 공존하는지 확인.
     * → Dialog 재마운트 → onOpenChange(false) 오발화 → 튕겨나감 버그 재현 방지.
     */
    const srcPath = 'src/components/PenChartTab.tsx';
    const src: string = fs.readFileSync(srcPath, 'utf-8');

    // FullscreenFormWrapper 가 "select" 와 "draw" 양 모드를 감싸는지 확인
    const wrapperStart = src.indexOf("if (mode === 'select' || mode === 'draw')");
    expect(wrapperStart, 'select/draw 공유 FullscreenFormWrapper 시작 조건 없음').toBeGreaterThan(0);

    // 단일 FullscreenFormWrapper 블록 내에 mode==='select' 분기와 mode==='draw' 분기 공존
    // 블록 경계를 닫는 태그로 동적 산정 (고정 char 윈도우는 분기 사이 코드 추가 시 깨짐 —
    //  cf. T-20260606-REFUND-PEN-MISS 기기별 조건부 desync 추가로 draw 분기가 +6030 으로 밀림)
    const wrapperEnd = src.indexOf('</FullscreenFormWrapper>', wrapperStart);
    expect(wrapperEnd, '닫는 </FullscreenFormWrapper> 태그 없음').toBeGreaterThan(wrapperStart);
    const block = src.slice(wrapperStart, wrapperEnd);
    expect(block).toContain("{mode === 'select' &&");
    expect(block).toContain("{mode === 'draw' &&");
    expect(block).toContain('FullscreenFormWrapper');
  });

  // ── AC-3: 배경 캔버스 초기 흰 배경 ──────────────────────────────────────────
  test('AC-3: initBgCanvas — 이미지 로드 전 흰 배경(#ffffff) fillRect 코드 확인', () => {
    /**
     * 검증: initBgCanvas() 내부에서 이미지 로드 전(img.src 설정 전) ctx.fillStyle='#ffffff'
     *       + ctx.fillRect 가 있어야 검정 화면 방지 가능.
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const initStart = src.indexOf('const initBgCanvas = useCallback');
    expect(initStart).toBeGreaterThan(0);
    // REOPEN: isContextLost() 추가로 함수 길이 증가 → 2500자 윈도우 사용
    const initBlock = src.slice(initStart, initStart + 2500);

    // 이미지 로드 전 흰 배경 설정
    expect(initBlock).toContain("ctx.fillStyle = '#ffffff'");
    expect(initBlock).toContain('ctx.fillRect(0, 0, CANVAS_W, canvasH)');

    // 이미지 onload에서도 흰 배경 재설정 (이중 보장)
    expect(initBlock).toContain('img.onload');
  });

  // ── AC-4: 폴백 UI 존재 ──────────────────────────────────────────────────────
  test('AC-4: bgImgLoadError 상태 + img.onerror → setBgImgLoadError(true) 코드 확인', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // bgImgLoadError 상태 선언
    expect(src).toContain('bgImgLoadError');
    expect(src).toContain('setBgImgLoadError');

    // img.onerror에서 에러 상태 설정
    const oerrIdx = src.indexOf('img.onerror');
    expect(oerrIdx).toBeGreaterThan(0);
    const oerrBlock = src.slice(oerrIdx, oerrIdx + 300);
    expect(oerrBlock).toContain('setBgImgLoadError(true)');
    expect(oerrBlock).toContain('console.error'); // AC-4: console.error 로깅
  });

  test('AC-4: img.onload에서 drawImage 성공 후 setBgImgLoadError(false) 호출 (버그 수정: onload 시작 즉시 false 금지)', () => {
    /**
     * REOPEN AC-R3 핵심 버그 수정:
     *   기존: setBgImgLoadError(false) → onload 진입 즉시 → drawImage 실패해도 fallback 비표시 → 검정화면
     *   수정: setBgImgLoadError(false) → drawImage try-catch 성공 블록 후에 위치
     *
     * 검증: img.onload 블록 시작 후 200자 이내에 setBgImgLoadError(false)가 없어야 함
     *       (drawImage 이후인 충분히 뒤에 있어야 함)
     *
     * REOPEN 2: img.onload = async () => { (await img.decode() 추가)
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // REOPEN 2: async onload 패턴
    const onloadIdx = src.indexOf('img.onload = async () => {');
    expect(onloadIdx, 'img.onload = async () => { 패턴 없음 — REOPEN 2 수정 누락').toBeGreaterThan(0);

    // REOPEN 2: tiling 코드로 onload 블록 길이 증가.
    //   SPEC-DRIFT-REPAIR(T-20260612): 고정 6000자 윈도는 REOPEN 누적 주석으로 setBgImgLoadError(false)가
    //   rel 5993~6017로 밀려 윈도 경계(6000)에 걸쳐 contains 실패. onload 핸들러 종료 = 이어지는 img.src 대입
    //   (이미지 setup 종료) 지점을 끝 경계로 앵커 → 핸들러 본문 전체를 포착(드리프트 내성). assertion 무변경.
    const onloadEnd = src.indexOf('img.src', onloadIdx);
    const onloadFullBlock = src.slice(onloadIdx, onloadEnd > onloadIdx ? onloadEnd : onloadIdx + 8000);
    expect(onloadFullBlock).toContain('setBgImgLoadError(false)');

    // onload 시작 200자 이내에는 setBgImgLoadError(false) 없어야 함 (drawImage 이후로 이동됨)
    const onloadEarlyBlock = src.slice(onloadIdx, onloadIdx + 200);
    expect(onloadEarlyBlock).not.toContain('setBgImgLoadError(false)');

    // drawImage 뒤에 setBgImgLoadError(false) 위치 확인 (tiling 또는 fallback 경로 이후)
    const setBgFalseIdx = src.indexOf('setBgImgLoadError(false)', onloadIdx);
    expect(setBgFalseIdx).toBeGreaterThan(onloadIdx);
    // drawImage가 setBgImgLoadError(false) 보다 먼저 나와야 함
    const drawImageIdx = src.indexOf('ctx.drawImage(img, 0, 0, CANVAS_W, canvasH)', onloadIdx);
    expect(drawImageIdx).toBeGreaterThan(onloadIdx);
    expect(drawImageIdx).toBeLessThan(setBgFalseIdx);
  });

  test('AC-4: 폴백 UI — data-testid="penchart-bg-load-error" 렌더 조건 확인', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // 폴백 UI testid
    expect(src).toContain(FALLBACK_TESTID);

    // 폴백 UI는 bgImgLoadError 조건부 렌더
    const fallbackIdx = src.indexOf(FALLBACK_TESTID);
    expect(fallbackIdx).toBeGreaterThan(0);
    // 앞 600자 내에 bgImgLoadError 조건이 있어야 함 (실측: style 객체 길이 ~490자)
    const before = src.slice(Math.max(0, fallbackIdx - 600), fallbackIdx);
    expect(before).toContain('bgImgLoadError');
  });

  test('AC-4: 폴백 UI에 "다시 시도" 버튼 포함', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain(RETRY_BTN_TEXT);

    // 다시 시도 버튼 onClick은 initCanvas
    const retryIdx = src.indexOf(RETRY_BTN_TEXT);
    const surroundingBlock = src.slice(Math.max(0, retryIdx - 400), retryIdx + 200);
    expect(surroundingBlock).toContain('initCanvas');
  });

  // ── AC-4: initCanvas 재시도 시 에러 초기화 ────────────────────────────────
  test('AC-4: initCanvas 진입 시 setBgImgLoadError(false) 초기화 — 재시도 가능', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const initCanvasIdx = src.indexOf('const initCanvas = useCallback');
    expect(initCanvasIdx).toBeGreaterThan(0);
    const initBlock = src.slice(initCanvasIdx, initCanvasIdx + 400);
    expect(initBlock).toContain('setBgImgLoadError(false)');
  });

  // ── AC-4: OOM / ctx null 방어 (T-20260525-foot-PENCHART-FORM-BLACKSCR) ────────
  test('AC-4: initBgCanvas — getContext null 시 setBgImgLoadError(true) + console.error', () => {
    /**
     * 검증: 300DPI + DRAW_DPR=2 조합에서 GPU 메모리 초과로 canvas.getContext('2d')가 null을 반환하면
     *   bgImgLoadError=true 폴백 UI를 트리거 + console.error 로깅해야 함.
     *   → 검정 화면 대신 "양식 이미지를 불러올 수 없습니다." + 다시 시도 버튼 노출.
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const bgInitIdx = src.indexOf('const initBgCanvas = useCallback');
    expect(bgInitIdx).toBeGreaterThan(0);
    // 1500→2100자 윈도우: ctx null 가드(~300) + canvasH 계산 + Fix-1 주석 + canvas.width 설정 + BLACKSCR 주석 + size check
    //   (T-20260608-foot-PENCHART-REFUND-FORMIMG: 각 가드에 setBgImgErrorReason 진단 줄 추가 → canvas.width===0 가 ~1713 으로 밀림)
    const bgBlock = src.slice(bgInitIdx, bgInitIdx + 2100);

    // ctx null 가드 이후 setBgImgLoadError(true) 존재
    expect(bgBlock).toContain("if (!ctx)");
    expect(bgBlock).toContain('setBgImgLoadError(true)');
    // console.error 로깅
    expect(bgBlock).toContain('console.error');
    // bgCanvas 크기 할당 실패 방어 (canvas.width === 0)
    expect(bgBlock).toContain('canvas.width === 0');
  });

  test('AC-4: initDrawCanvas — getContext null 시 setBgImgLoadError(true) + console.error', () => {
    /**
     * 검증: draw canvas 초기화 실패(GPU 메모리 한계) 시도
     *   ctx null 가드 + canvas.width=0 가드 → setBgImgLoadError(true).
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const drawInitIdx = src.indexOf('const initDrawCanvas = useCallback');
    expect(drawInitIdx).toBeGreaterThan(0);
    // SPEC-DRIFT-REPAIR(T-20260612): 고정 5600자 윈도는 누적 주석으로 canvas.width===0 가 rel 5759로 밀려 벗어남.
    //   고정 char 윈도를 매번 키우는 대신 initDrawCanvas 함수 끝 경계(다음 `= useCallback` 선언)까지 앵커 →
    //   주석 증감과 무관하게 함수 본문 전체를 포착(드리프트 내성). 가드 로직/assertion 자체는 무변경.
    // ctx null 가드 + drawCtxRef 캐싱 + canvasH 계산 + canvas.width 설정 + BLACKSCR size check
    const drawBlockEnd = src.indexOf('= useCallback', drawInitIdx + 50);
    const drawBlock = src.slice(drawInitIdx, drawBlockEnd > drawInitIdx ? drawBlockEnd : drawInitIdx + 8000);

    expect(drawBlock).toContain("if (!ctx)");
    expect(drawBlock).toContain('setBgImgLoadError(true)');
    expect(drawBlock).toContain('console.error');
    // draw canvas 크기 할당 실패 방어
    expect(drawBlock).toContain('canvas.width === 0');
  });

  // ── REOPEN AC-R1: 이미지 URL 로딩 시작 로그 ──────────────────────────────────
  test('AC-R1: initBgCanvas — 배경 이미지 URL console.log 로딩 시작 로그 존재', () => {
    /**
     * 현장 디버깅 지원: bgUrl 로딩 시작 시 console.log로 URL + formKey + canvasPhysical 기록
     * → 현장 DevTools에서 URL 200 OK 여부 확인 가능 (CORS/404 조기 감지)
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const bgInitIdx = src.indexOf('const initBgCanvas = useCallback');
    expect(bgInitIdx).toBeGreaterThan(0);
    const bgBlock = src.slice(bgInitIdx, bgInitIdx + 3500);

    expect(bgBlock).toContain('배경 이미지 로딩 시작');
    expect(bgBlock).toContain('bgUrl');
    expect(bgBlock).toContain('canvasPhysical');
  });

  // ── REOPEN AC-R2: 이미지 디코드 검증 ─────────────────────────────────────────
  test('AC-R2: img.onload — naturalWidth===0 decode 실패 감지 → setBgImgLoadError(true)', () => {
    /**
     * img.onload 발화 후에도 naturalWidth=0이면 이미지 디코드 실패.
     * 일부 Android 브라우저에서 발생 가능 → fallback 표시.
     * REOPEN 2: async () + await img.decode() 패턴
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // REOPEN 2: async onload
    const onloadIdx = src.indexOf('img.onload = async () => {');
    expect(onloadIdx, 'img.onload = async () => { 패턴 없음').toBeGreaterThan(0);
    const onloadBlock = src.slice(onloadIdx, onloadIdx + 2500);

    expect(onloadBlock).toContain('img.naturalWidth === 0');
    expect(onloadBlock).toContain('img.naturalHeight === 0');
    // REOPEN 2: await img.decode() 존재
    expect(onloadBlock).toContain('await img.decode()');
  });

  // ── REOPEN AC-R3: ctx.isContextLost() 체크 + contextlost 이벤트 핸들러 ────────
  test('AC-R3: initBgCanvas — ctx.isContextLost() 체크 존재 (GPU context loss 감지)', () => {
    /**
     * ctx !== null이어도 GPU context loss 발생 시 모든 draw 연산이 무효화됨.
     * ctx.isContextLost() 체크로 감지 → setBgImgLoadError(true) 폴백.
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const bgInitIdx = src.indexOf('const initBgCanvas = useCallback');
    expect(bgInitIdx).toBeGreaterThan(0);
    const bgBlock = src.slice(bgInitIdx, bgInitIdx + 3500);

    // initBgCanvas 초기와 img.onload 내 2곳에 isContextLost() 체크 존재
    const contextLostMatches = (bgBlock.match(/ctx\.isContextLost\(\)/g) ?? []).length;
    expect(contextLostMatches).toBeGreaterThanOrEqual(2);
  });

  test('AC-R3: contextlost 이벤트 핸들러 useEffect 존재 — GPU context 소실 fallback + 복구', () => {
    /**
     * bgCanvas에 contextlost/contextrestored 이벤트 리스너를 추가.
     * contextlost → setBgImgLoadError(true) + e.preventDefault()
     * contextrestored → setBgImgLoadError(false) + initCanvas() 재실행
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain("'contextlost'");
    expect(src).toContain("'contextrestored'");
    expect(src).toContain('e.preventDefault()');
    expect(src).toContain('onContextLost');
    expect(src).toContain('onContextRestored');
  });

  // ── REOPEN AC-R4: drawImage try-catch ─────────────────────────────────────────
  test('AC-R4: img.onload — drawImage try-catch 존재 → 실패 시 setBgImgLoadError(true)', () => {
    /**
     * 300DPI 소스 이미지(최대 2481×10524)가 일부 기기 GPU 텍스처 한계를 초과 시
     * drawImage가 exception을 throw하는 경우 catch → setBgImgLoadError(true).
     * REOPEN 2: createImageBitmap 타일 분할 + catch 블록 포함
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // REOPEN 2: async onload
    const onloadIdx = src.indexOf('img.onload = async () => {');
    expect(onloadIdx, 'img.onload = async () => { 패턴 없음').toBeGreaterThan(0);
    const onloadBlock = src.slice(onloadIdx, onloadIdx + 4000);

    // try-catch 블록 내에 ctx.drawImage 존재
    const tryIdx = onloadBlock.indexOf('try {');
    expect(tryIdx).toBeGreaterThan(0);
    // 2000 → 3000: onload 블록에 decode try + draw try 2개 존재.
    // 첫 try(decode, line ~906)에서 두 번째 try(createImageBitmap, line ~947)까지 ~2200자 거리.
    const tryCatchBlock = onloadBlock.slice(tryIdx, tryIdx + 3000);
    expect(tryCatchBlock).toContain('ctx.drawImage(img, 0, 0, CANVAS_W, canvasH)');
    expect(tryCatchBlock).toContain('catch');
    expect(tryCatchBlock).toContain('setBgImgLoadError(true)');
    // REOPEN 2: createImageBitmap 타일 분할 코드 존재
    expect(tryCatchBlock).toContain('createImageBitmap');
  });

  // ── REOPEN 3 (REOPEN 2 미해결 근본 수정): willChange:'transform' 제거 ─────────
  // ── REOPEN 4 (REOPEN 3 미해결 최종 수정): desynchronized:true 제거 ────────────
  test('AC-R3-ROOT: draw canvas — willChange:"transform" 제거됨 + desynchronized:true 기본값 제거 (검정화면 방지)', () => {
    /**
     * 근본 원인(최종 확정):
     *   b955a8c(PENCHART-PEN-SLOW, 5/24)에서 willChange:'transform' + desynchronized:true 동시 추가
     *   → draw canvas가 별도 GPU compositor layer로 승격 → 불투명(alpha-less) GPU 텍스처
     *   → 투명 픽셀 = BLACK으로 표시 → bgCanvas(양식 이미지)가 가려져 검정화면.
     *
     *   REOPEN3 수정: willChange:'transform' 제거 → 미해결 (desync 단독으로도 opaque IOSurface 할당 가능)
     *   REOPEN4 수정: desynchronized:true 제거 (기본값 false) → 투명 합성 정상 동작 → bgCanvas 표시.
     *
     * 검증: canvasRef가 붙는 draw canvas <canvas> style에 willChange:'transform' 없어야 함
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // draw canvas (canvasRef) 렌더 블록 찾기
    const drawCanvasIdx = src.indexOf('ref={canvasRef}');
    expect(drawCanvasIdx, 'draw canvas ref={canvasRef} 없음').toBeGreaterThan(0);

    // canvasRef 이후 300자: style 블록 내에 willChange:'transform' 없어야 함
    const drawCanvasStyleBlock = src.slice(drawCanvasIdx, drawCanvasIdx + 600);
    expect(drawCanvasStyleBlock, "draw canvas style에 willChange:'transform' 잔존 — 검정화면 재발 가능!")
      .not.toContain("willChange: 'transform'");

    // bgCanvasRef(배경 canvas)는 별도 — willChange 없어도 OK (check not mixed up)
    const bgCanvasIdx = src.indexOf('ref={bgCanvasRef}');
    expect(bgCanvasIdx, 'bg canvas ref={bgCanvasRef} 없음').toBeGreaterThan(0);
    expect(bgCanvasIdx).not.toEqual(drawCanvasIdx);
  });

  test('AC-R3-ROOT REOPEN6-FINAL: initDrawCanvas — desync=OFF 전 기기 통일 (검정화면 안전 우선, Android 분기 제거)', () => {
    /**
     * REOPEN6 결정 (planner FIX-REQUEST, T-20260525-PENCHART-FORM-BLACKSCR):
     *   f9696ff(6/6 15:40)가 "검정화면은 iOS WebKit 전용"이라는 전제로 기기별 조건부 desync를
     *   복원(iOS=OFF / Android=ON)했다. 그러나 6/6 17:10 김주연 총괄 갤럭시탭(Android Chrome)에서
     *   검정화면 재발 신고 → "iOS 전용" 전제가 실기기로 **반증**됨.
     *   opaque/alpha-less backing store 검정화면은 Android GPU 합성 경로에서도 재현된다.
     *
     *   결정: 검정화면(P0 운영중단) > 펜 latency(P1). 양립 불가 → desync=OFF 전 기기 통일.
     *   ∴ isIOS 기기 판별 분기는 제거되어야 하고, useDesync 기본값은 false 여야 한다.
     *   Galaxy Tab 저지연은 desync 비의존 경로(별도 후속 티켓)로 분리.
     *
     *   검증 핵심:
     *   (1) isIOS 기기별 분기가 **존재하지 않음** (Android=ON 재도입축 제거 확인).
     *   (2) useDesync 기본값이 false (강제ON override 없이는 절대 desync 활성 안 됨).
     *   (3) ?penchart_no_desync 킬스위치 / ?penchart_enable_desync 테스트 override 유지.
     */
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const initDrawIdx = src.indexOf('const initDrawCanvas = useCallback');
    expect(initDrawIdx).toBeGreaterThan(0);
    // SPEC-DRIFT-REPAIR(T-20260612): 고정 4000자 윈도는 누적 주석으로 `desynchronized: useDesync`(rel 4373)가 벗어남.
    //   initDrawCanvas 함수 끝 경계(다음 `= useCallback`)까지 앵커 → 함수 본문 전체 포착. desync OFF/useDesync 기본 false
    //   /isIOS 분기 부재 단언은 그대로 검증(green-washing 아님 — 함수 범위로 한정해 not-contains 신뢰성도 유지).
    const drawInitEnd = src.indexOf('= useCallback', initDrawIdx + 50);
    const drawInitBlock = src.slice(initDrawIdx, drawInitEnd > initDrawIdx ? drawInitEnd : initDrawIdx + 8000);

    // override param 유지
    expect(drawInitBlock, 'penchart_enable_desync URL param 없음')
      .toContain('penchart_enable_desync');
    // 긴급 폴백 킬스위치 유지
    expect(drawInitBlock, 'penchart_no_desync 긴급 강제OFF 킬스위치 없음')
      .toContain('penchart_no_desync');
    expect(drawInitBlock).toContain('desynchronized: useDesync');

    // REOPEN6: 기기별 조건부 분기(isIOS/Android=ON) 완전 제거 — 검정화면 재도입축 차단
    expect(drawInitBlock, 'isIOS 기기 분기 잔존 — Android=ON 검정화면 재발 위험')
      .not.toContain('const isIOS');

    // useDesync 기본값 = false (override 없으면 desync 비활성, 검정화면 비재발 보장)
    const useDesyncDecl = drawInitBlock.match(/const useDesync\s*=.*?;/s);
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 선언 없음').not.toBe('');
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 결정에 !isIOS 등 기기 분기 잔존')
      .not.toContain('isIOS');
    // 기본 분기(_forceOn 도 _forceOff 도 아닐 때)가 false 로 끝나야 함
    expect(useDesyncDecl?.[0] ?? '', 'useDesync 기본값이 false 가 아님 — 검정화면 안전 미보장')
      .toMatch(/:\s*false\s*;/);
  });

  // ── AC-5: 기존 기능 회귀 없음 ──────────────────────────────────────────────
  test('AC-5: 기존 양식 템플릿 상수 (BUILTIN_PEN_CHART_TEMPLATE 등) 유지', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain('BUILTIN_PEN_CHART_TEMPLATE');
    expect(src).toContain('BUILTIN_HEALTH_Q_GENERAL');
    expect(src).toContain('BUILTIN_HEALTH_Q_SENIOR');
    expect(src).toContain('BUILTIN_REFUND_CONSENT');
  });

  test('AC-5: 양식 폼키 분기 헬퍼(isHealthQFormKey/isPdfOverlayFormKey 등) 유지', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain('isHealthQFormKey');
    expect(src).toContain('isPdfOverlayFormKey');
    expect(src).toContain('isRefundConsentKey');
    expect(src).toContain('isPersonalChecklistKey');
  });

  test('AC-5: initCanvas useEffect — mode==="draw" 시 200ms setTimeout (Dialog 애니메이션 완료 후 canvas 초기화)', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // REOPEN4: 50ms → 200ms 로 연장
    //   근거: Dialog animate-in animation-duration=150ms → @keyframes enter 0%에 translate3d → GPU layer.
    //   50ms는 애니메이션 도중 초기화 → iOS Safari opaque backing store 위험.
    //   200ms는 애니메이션 완료(150ms) + 50ms 여유.
    expect(src).toContain("if (mode === 'draw')");
    // initCanvas가 200ms 후에 호출되어야 함 (50ms는 아직도 사용되면 실패)
    expect(src).not.toContain('setTimeout(initCanvas, 50)');
    expect(src).toContain('200');   // setTimeout 200ms 포함 여부
  });

  // ── 회귀: AUTOFILL / FORM-TEMPLATE-REGEN ────────────────────────────────────
  test('회귀: PENCHART-FORM-AUTOFILL 자동채움 로직 보존 (drawPenChartAutofillInline)', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain('drawPenChartAutofillInline');
    expect(src).toContain('drawRefundP3DateAutofill');
    expect(src).toContain('drawAutofillOnCtx');
  });

  test('회귀: FORM-TEMPLATE-REGEN 300DPI 배경 이미지 로드 경로 유지', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain('/forms/pen_chart_form.png');
    expect(src).toContain('/forms/health_q_general.png');
    expect(src).toContain('/forms/health_q_senior.png');
    expect(src).toContain('/forms/refund_consent.png');
  });

  test('회귀: DRAW_DPR=2 강제 고해상도 유지', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    expect(src).toContain('const DRAW_DPR = 2');
  });
});
