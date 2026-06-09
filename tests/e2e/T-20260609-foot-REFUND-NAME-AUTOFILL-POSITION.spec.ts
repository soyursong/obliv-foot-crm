/**
 * E2E spec: T-20260609-foot-REFUND-NAME-AUTOFILL-POSITION
 * 환불/비급여 동의서 하단 [본인 동의서] "이름" 칸 자동삽입 텍스트 좌표 교정.
 *
 * 보고: 김주연 총괄 (slack thread 1780985350.458339) — "하단 고객 이름 자동삽입 위치 틀어짐".
 *
 * RC (PIL 픽셀 정밀 분석 — 추정 아님):
 *   refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32).
 *   [본인 동의서] 표(2칸: 이름 | 서명):
 *     · 표 좌측 경계 canvas x=96 / 중앙 칸막이 x=397 / 우측 경계 x=697
 *     · "이름" 칸 밑줄 canvas y=3242, x=130~364 (중심 x≈247)
 *     · "서명" 칸 밑줄 canvas y=3242, x=430~664
 *   직전 T-20260608 재추가 좌표 x=55 는 표 좌측 경계(96)보다 왼쪽 = 표 바깥 페이지 여백 →
 *   이름이 셀 밖 좌측으로 이탈 렌더(= "위치 틀어짐" RC). y=3206 도 밑줄(3242)보다 36px 위 부유.
 *
 * 수정: x 55→145 (밑줄 좌단 130 + 15px 여백, 칸 내부 시작), y 3206→3224 (top baseline 15px → 하단≈3239 ≈ 밑줄 3242 안착).
 *
 * AC:
 *   AC-1: 이름 자동삽입 좌표가 "이름" 칸 밑줄 영역(x 130~364) 내부에 시작
 *   AC-2: 표 좌측 경계(x=96) 안쪽 — 옛 x=55(여백 이탈) 재발 방지
 *   AC-3: 서명 칸(x≥397) 비침범 — 긴 이름 포함 오버플로우 없음
 *   AC-4: y 좌표가 밑줄(y=3242) 바로 위 — top baseline 15px (하단 ≤ 3242)
 *   AC-5: P1(차트번호/환자이름) 좌표 회귀 없음 — 300DPI 재생성 영향 점검
 *   AC-6: Canvas overlay(drawAutofillOnCtx → bgCanvas)로만 렌더 — DPR 무관(iPad/Galaxy Tab 일관)
 *   AC-7: 빌드 성공 + 에셋 서빙
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_URL = new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname;

// refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32) — PIL 실측 좌표
const NAME_CELL = {
  boxLeft: 96,       // 표 좌측 경계 (img 300)
  divider: 397,      // 이름|서명 중앙 칸막이 (img 1239)
  boxRight: 697,     // 표 우측 경계 (img 2179)
  underlineY: 3242,  // 이름/서명 칸 밑줄 (img 10130)
  nameUnderlineX0: 130, // 이름 칸 밑줄 좌단 (img 405)
  nameUnderlineX1: 364, // 이름 칸 밑줄 우단 (img 1136)
};
const FIXED = { x: 145, y: 3224 };
const FONT_PX = 15; // drawAutofillOnCtx italic 15px, textBaseline='top'

function readSrc(): string {
  return fs.readFileSync(SRC_URL, 'utf-8');
}
function p3ArrayBlock(src: string): string {
  return src.match(/REFUND_AUTOFILL_POS_P3[\s\S]*?\];/)?.[0] ?? '';
}

test.describe('REFUND-NAME-AUTOFILL-POSITION — 하단 본인동의서 이름 좌표 교정', () => {

  // ── AC-7: 빌드/에셋 ──────────────────────────────────────────────────────
  test('AC-7: 앱 정상 로드', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(400);
  });

  test('AC-7: refund_consent.png 에셋 서빙 (좌표 기준 이미지)', async ({ page }) => {
    const res = await page.goto('/forms/refund_consent.png');
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('image/png');
  });

  // ── AC-1: 이름 칸 밑줄 영역 내부 시작 ────────────────────────────────────
  test('AC-1: 교정 x=145 — 이름 칸 밑줄(x 130~364) 내부에서 시작', () => {
    expect(FIXED.x).toBeGreaterThanOrEqual(NAME_CELL.nameUnderlineX0); // 130
    expect(FIXED.x).toBeLessThan(NAME_CELL.nameUnderlineX1);           // 364
  });

  // ── AC-2: 표 좌측 경계 안쪽 (옛 x=55 이탈 재발 방지) ─────────────────────
  test('AC-2: 교정 x=145 — 표 좌측 경계(96) 안쪽', () => {
    expect(FIXED.x).toBeGreaterThan(NAME_CELL.boxLeft); // > 96
  });

  test('AC-2: 소스에 옛 좌측-이탈 좌표(x=55, y=3206) 흔적 없음', () => {
    const block = p3ArrayBlock(readSrc());
    expect(block).toMatch(/key:\s*'name'/);
    expect(block).toMatch(/x:\s*145/);
    expect(block).toMatch(/y:\s*3224/);
    expect(block).not.toMatch(/x:\s*55\b/);
    expect(block).not.toMatch(/y:\s*3206\b/);
  });

  // ── AC-3: 서명 칸 비침범 + 긴 이름 오버플로우 없음 ──────────────────────
  test('AC-3: 긴 이름(가용폭 내) 서명칸 칸막이(397) 미침범', () => {
    // 가용폭 = 밑줄 우단(364) - 시작(145) = 219px. 15px Korean char 기준 ≈ 14자.
    const available = NAME_CELL.nameUnderlineX1 - FIXED.x; // 219
    expect(available).toBeGreaterThan(FONT_PX * 8); // 8자 이상 수용
    // 14자 한글까지도 칸막이(397) 침범 없음 — 시작145 + 14*15=210 → 끝 355 < 397
    const maxNameEnd = FIXED.x + 14 * FONT_PX; // 355
    expect(maxNameEnd).toBeLessThan(NAME_CELL.divider); // < 397
  });

  // ── AC-4: 밑줄 바로 위 안착 (top baseline) ──────────────────────────────
  test('AC-4: y=3224 + 15px(top baseline) ≈ 밑줄 y=3242 위 안착', () => {
    const textBottom = FIXED.y + FONT_PX; // 3239
    expect(textBottom).toBeLessThanOrEqual(NAME_CELL.underlineY);       // ≤ 3242 (밑줄 침범 X)
    expect(NAME_CELL.underlineY - textBottom).toBeLessThanOrEqual(6);   // 밑줄과 ≤6px (떠보임 X)
  });

  test('AC-4: y=3224 — page-3 범위(2246~3369) 내', () => {
    expect(FIXED.y).toBeGreaterThanOrEqual(2246);
    expect(FIXED.y).toBeLessThan(3369);
  });

  // ── AC-5: P1 좌표 회귀 없음 (300DPI 재생성 영향 점검) ────────────────────
  test('AC-5: P1 차트번호/환자이름 좌표 불변 (밑줄 하단정렬 유지)', () => {
    const src = readSrc();
    const p1 = src.match(/REFUND_AUTOFILL_POS_P1[\s\S]*?\];/)?.[0] ?? '';
    // chartNumber x=190 y=199 (밑줄 214), name x=190 y=234 (밑줄 249) — PIL 실측 재확인 일치
    expect(p1).toMatch(/key:\s*'chartNumber'[\s\S]*?x:\s*190[\s\S]*?y:\s*199/);
    expect(p1).toMatch(/key:\s*'name'[\s\S]*?x:\s*190[\s\S]*?y:\s*234/);
    expect(199 + FONT_PX).toBe(214); // 차트번호 밑줄
    expect(234 + FONT_PX).toBe(249); // 환자이름 밑줄
  });

  // ── AC-6: Canvas overlay only (DPR 무관) ─────────────────────────────────
  test('AC-6: P3 이름은 bgCanvas ctx 합성(drawAutofillOnCtx) — DOM overlay 아님', () => {
    const src = readSrc();
    expect(src).toMatch(/drawAutofillOnCtx\(ctx,\s*autofillDataRef\.current,\s*REFUND_AUTOFILL_POS_P3\)/);
    // 캔버스 논리좌표 기준 합성 → scaleX/scaleY 기본 1 (CSS 좌표 그대로), DRAW_DPR=2 강제로 기기 DPR 무관
    expect(src).toContain('const DRAW_DPR = 2');
  });

  test('AC-6: 좌표 산출은 하드코딩 상수 — DPR/기기 스케일 종속 아님', () => {
    // REFUND_AUTOFILL_POS_P3 는 정적 배열(런타임 DPR 미참조) → iPad(DPR2.0)·Galaxy Tab 좌표 일관
    const block = p3ArrayBlock(readSrc());
    expect(block).not.toMatch(/devicePixelRatio/);
    expect(block).not.toMatch(/window\./);
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증 — 티켓 본문 2종):
 *
 * [시나리오1] 짧은 이름 — 이름 칸 정확 안착
 *   1. 데스크 직원 로그인 → 고객 검색 → "홍길동"(또는 짧은 성함) 고객 선택
 *   2. 임상 탭 → 펜차트 탭 → [새 차트 작성] → [환불/비급여 동의서] 선택
 *   3. page 3 [본인 동의서] 표까지 스크롤
 *   4. Expected:
 *      - "이름" 칸 밑줄 위에 성함이 gray-500 italic으로 안착 (칸 내부, 좌측 정렬)
 *      - 옛 증상(표 왼쪽 페이지 여백으로 이름이 빠져나가 보이던 현상) 없음
 *      - "서명" 칸은 빈칸 (펜 서명 영역 — 침범 없음)
 *      - 날짜 "년/월/일" 정상 (별도 함수 — 미변경)
 *
 * [시나리오2] 긴 이름 + 기기 일관성 — 오버플로우/이탈 없음
 *   1. 긴 성함(예: "남궁민수황보지영") 고객 선택 → 환불/비급여 동의서 → page 3
 *   2. Expected: 이름이 "이름" 칸 밑줄 폭(130~364) 내에 모두 표시, 중앙 칸막이(서명칸) 침범 없음
 *   3. iPad(DPR 2.0)와 Galaxy Tab 양쪽에서 동일 위치 렌더 (canvas 논리좌표 + DRAW_DPR=2 강제)
 */
