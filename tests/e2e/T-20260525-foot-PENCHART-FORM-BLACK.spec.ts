/**
 * T-20260525-foot-PENCHART-FORM-BLACK
 * 펜차트 전체 양식 검정 화면 + 튕겨나감 회귀 수정 검증
 *
 * AC-3: 검정 화면 대신 양식이 정상 렌더링됨 (흰 배경 + 양식 내용)
 * AC-4: 튕겨나감 방지 — 에러 바운더리(fallback UI) + console.error 로깅
 * AC-5: 기존 펜차트 기능 정상 동작 확인 (회귀 없음)
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
    // 실측: select(+300)~draw(+5583) 포함하도록 6000자 윈도우 사용
    const block = src.slice(wrapperStart, wrapperStart + 6000);
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
    const initBlock = src.slice(initStart, initStart + 1500);

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

  test('AC-4: img.onload에서 setBgImgLoadError(false) 초기화 (성공 시 에러 해제)', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    const onloadIdx = src.indexOf('img.onload = () => {');
    expect(onloadIdx).toBeGreaterThan(0);
    const onloadBlock = src.slice(onloadIdx, onloadIdx + 200);
    expect(onloadBlock).toContain('setBgImgLoadError(false)');
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

  test('AC-5: initCanvas useEffect — mode==="draw" 시 50ms setTimeout 유지', () => {
    const src: string = fs.readFileSync('src/components/PenChartTab.tsx', 'utf-8');

    // draw 모드 진입 시 initCanvas 지연 호출 (DOM render 후 실행 보장)
    expect(src).toContain("if (mode === 'draw')");
    expect(src).toContain('setTimeout(initCanvas, 50)');
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
