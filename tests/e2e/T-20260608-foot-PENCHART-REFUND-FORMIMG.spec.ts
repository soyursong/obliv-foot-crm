/**
 * T-20260608-foot-PENCHART-REFUND-FORMIMG
 * 환불/비급여 동의서 펜차트 양식 배경 이미지 미로드 — "양식 이미지를 불러올 수 없습니다."
 *
 * 진단 결론 (단정 금지·증거 기반):
 *   - 후보 #2(b5a7979 회귀): 배제 — b5a7979 diff는 펜 성능 프로파일러만 변경, 이미지 로드 경로 무변경.
 *   - 후보 #1(signed URL 만료): 배제 방향 — refund_consent.template_path='/forms/refund_consent.png'
 *     (DB seed 20260522060000) = 로컬 정적 자산, 서명 URL 아님(TTL 무관).
 *   - 후보 #3(CORS/WebView) + 메모리: 유력 잔존 — refund_consent 는 최대 양식(bgCanvas 1588×6738,
 *     소스 2481×10524 ≈ 26MP). "양식 이미지를 불러올 수 없습니다." 단일 UI 는 8개 서로 다른 실패
 *     지점(E1~E9)이 합쳐진 것이라 콘솔 없이는 원인 식별 불가.
 *
 * 핵심: LATENCY 티켓 메타-루트코즈 = "Galaxy Tab 콘솔 캡처 불가 → 추정 배포 → 빗나감".
 *   ∴ b5a7979 가 펜 성능을 화면 배지로 노출한 것과 동일 전략으로,
 *
 *   AC-1: img.onerror 시 cache-bust(?cb=) 1회 자동 재시도 — Android WebView crossOrigin 캐시 오염
 *         (비-CORS 캐시 응답 재사용) + 일시 네트워크 블립을 즉시 회복.
 *   AC-2: 8개 실패 stage(E1~E9) 코드를 에러 폴백 UI 에 화면 노출(data-testid=penchart-bg-error-reason)
 *         → 다음 현장 스크린샷 1장으로 실제 원인 stage 확정.
 *   AC-3: 회귀 비파괴 — BLACK 가드/perf 배지/desync OFF/로컬 양식 경로 보존.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_PATH = 'src/components/PenChartTab.tsx';
const ERROR_REASON_TESTID = 'penchart-bg-error-reason';

test.describe('T-20260608-foot-PENCHART-REFUND-FORMIMG', () => {

  // ── AC-1: cache-bust 자동 재시도 ─────────────────────────────────────────────
  test('AC-1: img.onerror — bgImgRetryRef cache-bust 1회 자동 재시도 후에만 fallback', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');

    // 재시도 카운터 ref 선언
    expect(src).toContain('bgImgRetryRef');

    const oerrIdx = src.indexOf('img.onerror');
    expect(oerrIdx).toBeGreaterThan(0);
    const oerrBlock = src.slice(oerrIdx, oerrIdx + 300);

    // onerror 본문: 재시도 분기(cache-bust ?cb=) → 그 다음에야 fallback
    expect(oerrBlock).toContain('bgImgRetryRef.current');
    expect(oerrBlock).toContain('cb=');
    expect(oerrBlock).toContain('img.src =');
    // 재시도 소진 후 fallback (BLACK spec 과 동일 윈도우 보존 검증)
    expect(oerrBlock).toContain('setBgImgLoadError(true)');
    expect(oerrBlock).toContain('console.error');
  });

  test('AC-1: 재시도 카운터는 initCanvas 진입 시 0 으로 리셋(양식 진입마다 1회 재시도 보장)', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');

    const initIdx = src.indexOf('const initCanvas = useCallback');
    expect(initIdx).toBeGreaterThan(0);
    const initBlock = src.slice(initIdx, initIdx + 500);
    expect(initBlock).toContain('bgImgRetryRef.current = 0');
    expect(initBlock).toContain('setBgImgErrorReason(null)');
  });

  // ── AC-2: 실패 단계 코드 화면 노출 ───────────────────────────────────────────
  test('AC-2: bgImgErrorReason 상태 선언 + 폴백 UI 에 화면 노출', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');

    expect(src).toContain('bgImgErrorReason');
    expect(src).toContain('setBgImgErrorReason');
    expect(src).toContain(ERROR_REASON_TESTID);

    // 화면 노출은 bgImgErrorReason 조건부 렌더 + 기존 에러 UI(penchart-bg-load-error) 안에 위치
    const reasonIdx = src.indexOf(ERROR_REASON_TESTID);
    expect(reasonIdx).toBeGreaterThan(0);
    const around = src.slice(Math.max(0, reasonIdx - 400), reasonIdx + 100);
    expect(around).toContain('bgImgErrorReason');
    // 에러 폴백 컨테이너 안쪽이어야 함(에러일 때만 노출)
    const loadErrIdx = src.indexOf('penchart-bg-load-error');
    expect(loadErrIdx).toBeGreaterThan(0);
    expect(reasonIdx).toBeGreaterThan(loadErrIdx);
  });

  test('AC-2: 8개 실패 stage(E1~E9) 코드가 각 setBgImgLoadError(true) 지점에 매핑됨', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');

    // 8개 stage 코드(콘솔 없이 스크린샷 1장으로 원인 가르기 위한 핀)
    for (const code of [
      'E1 ctx-null',        // bg ctx null
      'E2 ctx-lost(init)',  // bg ctx lost (init)
      'E3 canvas-alloc-0',  // bg canvas alloc 0 (메모리)
      'E4 net/CORS onerror',// network/CORS (재시도 후)
      'E5 naturalWidth=0',  // decode 실패
      'E6 ctx-lost',        // ctx lost (onload/post-decode/tile)
      'E7 decode() throw',  // decode 예외
      'E8 drawImage throw', // drawImage/createImageBitmap 예외
      'E9 contextlost',     // contextlost 이벤트
    ]) {
      expect(src, `실패 stage 코드 누락: ${code}`).toContain(code);
    }
    // draw 레이어 실패도 별도 코드(E1d/E3d)로 구분
    expect(src).toContain('E1d draw-ctx-null');
    expect(src).toContain('E3d draw-canvas-alloc-0');
  });

  test('AC-2: reason 노출은 PHI/긴 URL 직접 노출 방지(urlTail 꼬리만)', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('urlTail');
    // 전체 bgUrl 이 아니라 끝 28자 꼬리만 노출
    expect(src).toContain('bgUrl.slice(-28)');
  });

  // ── AC-3: 회귀 비파괴 ────────────────────────────────────────────────────────
  test('AC-3: BLACK 가드 비파괴 — 흰 배경 fillRect + ctx null/alloc-0/contextlost 가드 유지', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');

    expect(src).toContain("ctx.fillStyle = '#ffffff'");
    expect(src).toContain('ctx.fillRect(0, 0, CANVAS_W, canvasH)');
    expect(src).toContain('canvas.width === 0');
    expect(src).toContain('ctx.isContextLost()');
    expect(src).toContain("'contextlost'");
    expect(src).toContain('penchart-bg-load-error');
    expect(src).toContain('다시 시도');
  });

  test('AC-3: b5a7979 펜 성능 배지(perf) 비파괴', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('penchart-perf-badge');
    expect(src).toContain('penchart_perf');
  });

  test('AC-3: desync OFF 기본 + 로컬 양식 경로 보존', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('desynchronized: useDesync');
    expect(src).toContain('/forms/refund_consent.png');
    expect(src).toContain('/forms/health_q_senior.png');
    // crossOrigin='anonymous' 유지 — bgCanvas.toDataURL() PDF 저장(non-taint) 필수
    expect(src).toContain("img.crossOrigin = 'anonymous'");
  });

  test('AC-3: 자동채움(refund_consent P1/P3) 회귀 없음', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('drawRefundP3DateAutofill');
    expect(src).toContain('REFUND_AUTOFILL_POS_P1');
    expect(src).toContain('REFUND_AUTOFILL_POS_P3');
  });
});
