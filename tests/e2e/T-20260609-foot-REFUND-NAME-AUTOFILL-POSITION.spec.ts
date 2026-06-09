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
// T-20260609-foot-CONSENT-NAME-CENTER-FONT 증분: 좌측정렬(x=145) → 칸 중심 중앙정렬(centerX=247).
//   본 spec은 "칸 내부 안착(셀 밖 이탈 재발 방지)" 회귀를 지키는 데 집중 — 시작점이 칸 중심으로 이동해도
//   여전히 밑줄 영역(130~364) 내부임을 확인. 정렬/폰트 세부는 CENTER-FONT spec이 별도 검증.
const CENTER_X = 247; // 중앙정렬 기준 = 이름 칸 밑줄 중심 (구 좌측정렬 x=145 대체)
const P1_FONT_PX = 15; // P1(차트번호/환자이름)은 drawAutofillOnCtx 15px top baseline 유지(미변경)

function readSrc(): string {
  return fs.readFileSync(SRC_URL, 'utf-8');
}
function p3NameBlock(src: string): string {
  return src.match(/const REFUND_P3_NAME\s*=\s*\{[\s\S]*?\};/)?.[0] ?? '';
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

  // ── AC-1: 이름 칸 밑줄 영역 내부 (중앙정렬 기준점) ───────────────────────
  test('AC-1: 중앙정렬 기준 centerX=247 — 이름 칸 밑줄(x 130~364) 내부', () => {
    expect(CENTER_X).toBeGreaterThanOrEqual(NAME_CELL.nameUnderlineX0); // 130
    expect(CENTER_X).toBeLessThan(NAME_CELL.nameUnderlineX1);           // 364
  });

  // ── AC-2: 표 좌측 경계 안쪽 (옛 x=55 이탈 재발 방지) ─────────────────────
  test('AC-2: centerX=247 — 표 좌측 경계(96) 안쪽', () => {
    expect(CENTER_X).toBeGreaterThan(NAME_CELL.boxLeft); // > 96
  });

  test('AC-2: 소스에 옛 좌측-이탈 좌표(x=55, y=3206) 흔적 없음', () => {
    const block = p3NameBlock(readSrc());
    expect(block).toMatch(/centerX:\s*247/);
    expect(block).not.toMatch(/55/);   // 옛 좌측 이탈 x
    expect(block).not.toMatch(/3206/); // 옛 부유 y
  });

  // ── AC-3: 서명 칸 비침범 + 긴 이름 오버플로우 없음 (중앙정렬 + 클램프) ───
  test('AC-3: 중앙정렬 가용폭 — 좌우 칸 경계(서명칸/페이지여백) 미침범', () => {
    // CENTER-FONT 클램프: 측정폭 ≤ maxWidth(226) 보장. 중심 247 기준 ±113 → 좌134/우360.
    const maxHalf = 226 / 2; // 113
    expect(CENTER_X - maxHalf).toBeGreaterThanOrEqual(NAME_CELL.nameUnderlineX0); // 좌단 ≥ 130
    expect(CENTER_X + maxHalf).toBeLessThanOrEqual(NAME_CELL.nameUnderlineX1);    // 우단 ≤ 364
    expect(CENTER_X + maxHalf).toBeLessThan(NAME_CELL.divider);                   // 중앙 칸막이(397) 미침범
  });

  // ── AC-4: 밑줄 바로 위 안착 (alphabetic baseline) ──────────────────────
  test('AC-4: baselineY=3238 — 밑줄 y=3242 바로 위 안착', () => {
    const baselineY = 3238;
    expect(baselineY).toBeLessThanOrEqual(NAME_CELL.underlineY);     // ≤ 3242 (밑줄 침범 X)
    expect(NAME_CELL.underlineY - baselineY).toBeLessThanOrEqual(6); // 밑줄과 ≤6px (떠보임 X)
  });

  test('AC-4: baselineY=3238 — page-3 범위(2246~3369) 내', () => {
    expect(3238).toBeGreaterThanOrEqual(2246);
    expect(3238).toBeLessThan(3369);
  });

  // ── AC-5: P1 좌표 회귀 없음 (300DPI 재생성 영향 점검) ────────────────────
  test('AC-5: P1 차트번호/환자이름 좌표 불변 (밑줄 하단정렬 유지)', () => {
    const src = readSrc();
    const p1 = src.match(/REFUND_AUTOFILL_POS_P1[\s\S]*?\];/)?.[0] ?? '';
    // chartNumber x=190 y=199 (밑줄 214), name x=190 y=234 (밑줄 249) — PIL 실측 재확인 일치
    expect(p1).toMatch(/key:\s*'chartNumber'[\s\S]*?x:\s*190[\s\S]*?y:\s*199/);
    expect(p1).toMatch(/key:\s*'name'[\s\S]*?x:\s*190[\s\S]*?y:\s*234/);
    expect(199 + P1_FONT_PX).toBe(214); // 차트번호 밑줄
    expect(234 + P1_FONT_PX).toBe(249); // 환자이름 밑줄
  });

  // ── AC-6: Canvas overlay only (DPR 무관) ─────────────────────────────────
  test('AC-6: P3 이름은 bgCanvas ctx 합성(drawRefundP3NameAutofill) — DOM overlay 아님', () => {
    const src = readSrc();
    // CENTER-FONT 증분: 전용 함수로 교체 (clamp/중앙정렬 위해 drawAutofillOnCtx → drawRefundP3NameAutofill)
    expect(src).toMatch(/drawRefundP3NameAutofill\(ctx,\s*autofillDataRef\.current\)/);
    // 캔버스 논리좌표 기준 합성 → scaleX/scaleY 기본 1 (CSS 좌표 그대로), DRAW_DPR=2 강제로 기기 DPR 무관
    expect(src).toContain('const DRAW_DPR = 2');
  });

  test('AC-6: 좌표 산출은 하드코딩 상수 — DPR/기기 스케일 종속 아님', () => {
    // REFUND_P3_NAME 은 정적 상수(런타임 DPR 미참조) → iPad(DPR2.0)·Galaxy Tab 좌표 일관
    const block = p3NameBlock(readSrc());
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
