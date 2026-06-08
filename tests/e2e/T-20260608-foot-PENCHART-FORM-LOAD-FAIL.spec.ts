/**
 * T-20260608-foot-PENCHART-FORM-LOAD-FAIL
 * 펜차트 양식 이미지 "불러올 수 없습니다." 폴백 재발 (김주연 총괄, 풋센터 204)
 *
 * 이번 티켓은 REFUND-FORMIMG(E1~E9 단계코드 계측·crossOrigin·decode·타일링·cache-bust 재시도)
 * 위에 쌓는 보강 — repro 확보 불가(Galaxy Tab 콘솔 캡처 불가) 상황에서:
 *
 *   AC-1: 6개 실패 분기 특정 — E1~E9 단계코드가 각 setBgImgLoadError(true) 지점에 매핑됨
 *         + 폴백 화면에 코드 노출(스크린샷 1장 진단). [REFUND-FORMIMG 자산 회귀 비파괴 검증]
 *   AC-2: network/CORS onerror 자동 재시도 1회 → 2회 상향 (현장 네트워크 블립 마진 +1).
 *   AC-3: [다시 시도] → initCanvas 재로드 + 모든 에러상태/재시도카운터 리셋(복구 가능).
 *   AC-4: 현장용 사유 힌트 — 양식명 + 일시적/영구 분류 + 행동 안내(다시 시도 vs 관리자 문의)를
 *         사람이 읽을 한 줄로 노출(data-testid=penchart-bg-error-hint). 기술코드와 별도.
 *
 * 회귀 점검: BLACK / BLACKSCR(REOPEN) / FORM-TEMPLATE-REGEN — 동일 화면 반복 수정 영역 비파괴.
 *
 * 구조(소스) 검증 — 캔버스 GPU/CORS 실패는 headless CI 에서 결정적 재현 불가(메타-루트코즈와 동일),
 *   ∴ FORMIMG/BLACK spec 과 동일하게 소스 구조 가드로 회귀를 봉인한다.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_PATH = 'src/components/PenChartTab.tsx';
const HINT_TESTID = 'penchart-bg-error-hint';
const REASON_TESTID = 'penchart-bg-error-reason';
const FALLBACK_TESTID = 'penchart-bg-load-error';

test.describe('T-20260608-foot-PENCHART-FORM-LOAD-FAIL', () => {

  // ── AC-1: 6개 실패 분기가 단계코드로 특정됨 (REFUND-FORMIMG 자산 보존) ──────────
  test('AC-1: E1~E9 단계코드가 setBgImgErrorReason 으로 전부 계측됨', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    for (const code of [
      'E1 ctx-null',
      'E2 ctx-lost(init)',
      'E3 canvas-alloc-0',
      'E4 net/CORS onerror',
      'E5 naturalWidth=0',
      'E6 ctx-lost',
      'E7 decode() throw',
      'E8 drawImage throw',
      'E9 contextlost',
    ]) {
      expect(src, `실패 stage 코드 누락: ${code}`).toContain(code);
    }
    // draw 레이어 실패도 별도 코드
    expect(src).toContain('E1d draw-ctx-null');
    expect(src).toContain('E3d draw-canvas-alloc-0');
  });

  test('AC-1: 단계코드는 폴백 UI(penchart-bg-load-error) 안쪽에 노출됨', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    const fallbackIdx = src.indexOf(FALLBACK_TESTID);
    const reasonIdx = src.indexOf(REASON_TESTID);
    expect(fallbackIdx).toBeGreaterThan(0);
    expect(reasonIdx).toBeGreaterThan(fallbackIdx);
  });

  // ── AC-2: network/CORS 자동 재시도 2회 상향 ──────────────────────────────────
  test('AC-2: img.onerror — cache-bust 재시도 임계 < 2 (2회 자동 재시도 후 fallback)', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    const oerrIdx = src.indexOf('img.onerror');
    expect(oerrIdx).toBeGreaterThan(0);
    const oerrBlock = src.slice(oerrIdx, oerrIdx + 300);
    // 2회 재시도(< 2) — 1회(< 1)에서 상향됨
    expect(oerrBlock).toContain('bgImgRetryRef.current++ < 2');
    expect(oerrBlock).not.toContain('bgImgRetryRef.current++ < 1');
    // BLACK/REFUND-FORMIMG 300자 윈도우 가드 비파괴 (cb=, img.src=, console.error, setBgImgLoadError(true))
    expect(oerrBlock).toContain('cb=');
    expect(oerrBlock).toContain('img.src =');
    expect(oerrBlock).toContain('console.error');
    expect(oerrBlock).toContain('setBgImgLoadError(true)');
  });

  // ── AC-3: 다시 시도 → initCanvas 복구 ────────────────────────────────────────
  test('AC-3: [다시 시도] onClick=initCanvas + 진입 시 에러/재시도카운터 리셋', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    // 버튼 onClick=initCanvas
    const retryIdx = src.indexOf('다시 시도');
    expect(retryIdx).toBeGreaterThan(0);
    const around = src.slice(Math.max(0, retryIdx - 400), retryIdx + 100);
    expect(around).toContain('initCanvas');
    // initCanvas 진입 시 3종 리셋 — 일시적 실패 복구 보장
    const initIdx = src.indexOf('const initCanvas = useCallback');
    expect(initIdx).toBeGreaterThan(0);
    const initBlock = src.slice(initIdx, initIdx + 500);
    expect(initBlock).toContain('setBgImgLoadError(false)');
    expect(initBlock).toContain('setBgImgErrorReason(null)');
    expect(initBlock).toContain('bgImgRetryRef.current = 0');
  });

  // ── AC-4: 현장용 사유 힌트 ────────────────────────────────────────────────────
  test('AC-4: classifyBgImgError — 일시적/영구 분류 헬퍼 존재 + 분류 테이블', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('function classifyBgImgError');
    expect(src).toContain('TRANSIENT_BG_ERROR_CODES');
    // 일시적 코드 집합 — GPU/메모리/네트워크
    expect(src).toMatch(/TRANSIENT_BG_ERROR_CODES\s*=\s*\[[^\]]*'E2'[^\]]*'E3'[^\]]*'E4'[^\]]*'E6'[^\]]*'E9'[^\]]*\]/);
    // 행동 안내 문구(다시 시도 / 관리자 문의)
    expect(src).toContain('다시 시도');
    expect(src).toContain('관리자에게 문의');
  });

  test('AC-4: 폴백 UI 에 사람이 읽는 힌트(penchart-bg-error-hint) + 양식명 노출', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain(HINT_TESTID);
    const hintIdx = src.indexOf(`data-testid="${HINT_TESTID}"`);
    expect(hintIdx).toBeGreaterThan(0);
    // 힌트는 폴백 컨테이너 안쪽 + 기술코드(reason)보다 먼저(사람이 먼저 읽도록)
    const fallbackIdx = src.indexOf(FALLBACK_TESTID);
    const reasonIdx = src.indexOf(REASON_TESTID);
    expect(hintIdx).toBeGreaterThan(fallbackIdx);
    expect(hintIdx).toBeLessThan(reasonIdx);
    // 양식명(name_ko) 결합
    const hintBlock = src.slice(hintIdx - 300, hintIdx + 300);
    expect(hintBlock).toContain('activeDrawTemplate?.name_ko');
    expect(hintBlock).toContain('classifyBgImgError');
  });

  // ── 회귀: BLACK / BLACKSCR / FORM-TEMPLATE-REGEN 비파괴 ───────────────────────
  test('회귀: BLACK 가드 — 흰 배경 + ctx null/alloc-0/contextlost + decode/tiling 유지', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain("ctx.fillStyle = '#ffffff'");
    expect(src).toContain('canvas.width === 0');
    expect(src).toContain('ctx.isContextLost()');
    expect(src).toContain("'contextlost'");
    expect(src).toContain("'contextrestored'");
    expect(src).toContain('await img.decode()');
    expect(src).toContain('createImageBitmap');
    expect(src).toContain('img.naturalWidth === 0');
  });

  test('회귀: FORM-TEMPLATE-REGEN — 로컬 양식 경로 + crossOrigin + 자동채움 보존', () => {
    const src: string = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('/forms/refund_consent.png');
    expect(src).toContain('/forms/health_q_senior.png');
    expect(src).toContain("img.crossOrigin = 'anonymous'");
    expect(src).toContain('drawRefundP3DateAutofill');
    expect(src).toContain('drawPenChartAutofillInline');
  });
});
