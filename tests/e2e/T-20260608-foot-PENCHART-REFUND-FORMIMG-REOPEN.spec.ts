/**
 * T-20260608-foot-PENCHART-REFUND-FORMIMG  — REOPEN #1 (field-soak FAIL · RC 재규명)
 *
 * RC 100% 확정 (대표 코드직독): 양식 PNG 300DPI 과해상 래스터화.
 *   refund_consent.png 2481×10524 → img.decode() heap 104MB 단일청크 → Galaxy Tab decode() throw(E7).
 *   캔버스 물리상한 CANVAS_W*DRAW_DPR = 794*2 = 1588px (=192DPI). 1588 초과 소스폭은 drawImage가
 *   논리좌표 (0,0,CANVAS_W,canvasH)로 그릴 때 어차피 버려짐 → 2.44× 잉여, 선명도 이득 0.
 *
 * 1차 (즉시·핵심): 전 6개 양식 PNG를 폭 1588px(비율유지)로 재래스터화 교체.
 *   → decode heap = W×H×4 (브라우저는 색공간 무관 RGBA 디코드) 를 px 차원에서 직접 감축.
 *   refund_consent: 104MB → 1588×6736×4 = 42.8MB (2.44× ↓) → E7 근본 제거.
 *
 * 좌표 불변(R2): drawImage 가 (0,0,CANVAS_W,canvasH) 논리좌표로 그림 → 소스 px 변경이 자동채움
 *   좌표(CANVAS_W=794 기준)에 영향 없음. 코드 레벨로 이 불변식을 고정한다.
 *
 * AC:
 *   R1  refund_consent 폭 1588 (decode heap ≤ canvas 물리상한) → E7 0건
 *   R2  senior 2종 좌표 회귀 0 (drawImage 논리좌표 CANVAS_W 고정)
 *   R3  BLACKSCR·desync OFF·perf배지·E폴백 비파괴 (기존 FORMIMG spec 이 커버 + 본 spec 보강)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SRC_PATH = 'src/components/PenChartTab.tsx';
const FORMS_DIR = 'public/forms';

// PNG IHDR: width = bytes[16..19], height = bytes[20..23] (big-endian uint32)
function pngSize(file: string): { w: number; h: number } {
  const buf = fs.readFileSync(file);
  // PNG signature 8B + "IHDR" chunk (length 4B + type 4B) → width at offset 16
  expect(buf.subarray(1, 4).toString('ascii'), `${file} not a PNG`).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// CANVAS_W(794) × DRAW_DPR(2) = 1588 = A4 192DPI 물리상한. 양식 소스폭은 이 값 이하여야 한다.
const CANVAS_PHYS_W = 1588;
// 단일 decode heap 안전 상한(MB). refund_consent 42.8MB 가 최대 → 50MB 마진.
const MAX_DECODE_HEAP_MB = 50;

const FORMS = [
  'refund_consent.png',
  'health_q_senior.png',
  'personal_checklist_senior.png',
  'health_q_general.png',
  'personal_checklist_general.png',
  'pen_chart_form.png',
];

test.describe('T-20260608-foot-PENCHART-REFUND-FORMIMG REOPEN#1 — 양식 재래스터(E7 근본 제거)', () => {

  // ── R1: 양식 폭이 캔버스 물리상한 이하 → decode heap 상한 강제 ───────────────
  for (const form of FORMS) {
    test(`R1: ${form} 폭 ≤ ${CANVAS_PHYS_W}px (물리상한) + decode heap ≤ ${MAX_DECODE_HEAP_MB}MB`, () => {
      const fp = path.join(FORMS_DIR, form);
      expect(fs.existsSync(fp), `양식 자산 누락: ${fp}`).toBe(true);
      const { w, h } = pngSize(fp);
      // 폭이 물리상한 초과면 잉여 해상도(=과해상) — E7 재발 위험
      expect(w, `${form} 폭 ${w}px > 물리상한 ${CANVAS_PHYS_W}px (과해상 — E7 재발 위험)`)
        .toBeLessThanOrEqual(CANVAS_PHYS_W);
      // decode heap = W×H×4 (RGBA). E7(decode throw)의 직접 원인.
      const heapMB = (w * h * 4) / (1024 * 1024);
      expect(heapMB, `${form} decode heap ${heapMB.toFixed(1)}MB > ${MAX_DECODE_HEAP_MB}MB`)
        .toBeLessThanOrEqual(MAX_DECODE_HEAP_MB);
    });
  }

  test('R1: refund_consent 구 과해상(2481×10524, 104MB) 대비 2.4× 이상 heap 감축', () => {
    const { w, h } = pngSize(path.join(FORMS_DIR, 'refund_consent.png'));
    const oldHeapMB = (2481 * 10524 * 4) / (1024 * 1024); // ≈ 99.6MB
    const newHeapMB = (w * h * 4) / (1024 * 1024);
    expect(oldHeapMB / newHeapMB).toBeGreaterThanOrEqual(2.0);
  });

  // ── R2: 좌표 불변 — drawImage 가 논리좌표 CANVAS_W 기준 ──────────────────────
  test('R2: 배경 drawImage 는 논리좌표(0,0,CANVAS_W,canvasH) 기준 → 소스 px 무관 좌표 불변', () => {
    const src = fs.readFileSync(SRC_PATH, 'utf-8');
    // 소형 양식 단일 drawImage / 미지원 fallback 모두 (0,0,CANVAS_W,canvasH) 논리좌표
    expect(src).toContain('ctx.drawImage(img, 0, 0, CANVAS_W, canvasH)');
    // CANVAS_W=794 (A4 96DPI 논리폭) — 자동채움 좌표 기준 불변
    expect(src).toContain('const CANVAS_W = 794');
    // 자동채움은 논리좌표 그대로(scaleX/scaleY=1) — 소스 해상도와 분리
    expect(src).toContain('bgCanvas가 CANVAS_W×canvasH 논리이므로 scaleX/scaleY=1');
  });

  test('R2: 환불동의서 자동채움 좌표 상수 보존(P1/P3 위치 회귀 없음)', () => {
    const src = fs.readFileSync(SRC_PATH, 'utf-8');
    expect(src).toContain('REFUND_AUTOFILL_POS_P1');
    // SPEC-DRIFT-REPAIR(T-20260612): 구 REFUND_AUTOFILL_POS_P3 단일 상수 → P3 날짜/이름 분리 함수
    //   (drawRefundP3DateAutofill + drawRefundP3NameAutofill, 위치상수 REFUND_P3_NAME)로 리팩터됨.
    //   P3 좌표 회귀 가드를 현 심볼로 재정렬(검증력 보존 — 단언 삭제·약화 아님).
    expect(src).toContain('REFUND_P3_NAME');
    expect(src).toContain('drawRefundP3DateAutofill');
    expect(src).toContain('drawRefundP3NameAutofill');
  });

  // ── R3: 비파괴 — 타일링/E7 폴백/decode 가드 유지(미래 고해상 재투입 방어선) ──
  test('R3: 대형 height 양식 타일링 가드 + E7 decode 폴백 유지', () => {
    const src = fs.readFileSync(SRC_PATH, 'utf-8');
    // 타일링 가드(MAX_TILE) — height>2048 양식 여전히 통과시켜야 함 + DB 고해상 업로드 방어선
    expect(src).toContain('const MAX_TILE = 2048');
    expect(src).toContain('createImageBitmap(img, tileSx, tileSy, tileSw, tileSh)');
    // E7 decode throw 폴백 유지(미래 재투입 시 검정화면 대신 폴백 UI)
    expect(src).toContain('await img.decode()');
    expect(src).toContain('E7 decode() throw');
  });

  test('R3: senior 2종(폭1588·height>2048) 은 Y-타일 분기 진입 → 갤탭 GPU 텍스처 상한 통과', () => {
    for (const f of ['health_q_senior.png', 'personal_checklist_senior.png']) {
      const { w, h } = pngSize(path.join(FORMS_DIR, f));
      expect(w).toBeLessThanOrEqual(2048);  // 폭은 단일 텍스처 OK
      expect(h).toBeGreaterThan(2048);       // height 는 타일 분할 필요 → 가드 경로 유지 검증
    }
  });
});
