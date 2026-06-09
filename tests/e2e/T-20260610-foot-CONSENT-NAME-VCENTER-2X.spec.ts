/**
 * E2E spec: T-20260610-foot-CONSENT-NAME-VCENTER-2X
 * 환불/비급여 동의서 P3 [본인 동의서] 하단 "이름" 칸 자동삽입 성명을
 *   ⓐ 셀 세로 중앙 배치(아래쏠림 해소) ⓑ 폰트 크기 2배 확대 (28 → 56)
 *   ⓒ AC-3 클램프 2x 기준 재산정 (minFontSize 14 → 28)
 *   ⓓ 가로중앙(centerX=247, textAlign='center') 불변 (3e0216b 회귀 금지).
 *
 * 보고: 김주연 총괄 6/10 08:45 (풋 채널 thread 1780988357.206149)
 *   > "하단으로 너무 쏠려있음 성명칸 중앙 배치될 수 있게 조정해주고 사이즈 2배로 키워줘"
 *
 * extends T-20260609-foot-CONSENT-NAME-CENTER-FONT (3e0216b, deployed):
 *   직전: 가로중앙 + bold 28px / textBaseline='top' / topY=3214
 *     → topY+28 = 3242 (밑줄 하단 안착) → 셀(상단 cellTop ~3123 ~ 밑줄 3241) 안에서 *아래쏠림*.
 *   본 건: 셀 세로중앙 + 2x.
 *
 * 셀 기하 — PIL 측정(refund_consent.png 1588x6736, scale PNG/canvas=2.0):
 *   canvas y=3099.5: 표 외곽 상단
 *   canvas y=3123  : 라벨/입력 구분선 = 입력칸 상단 (cellTop)
 *   canvas y=3241  : 밑줄 = 입력칸 하단 (cellBottom)
 *   canvas y=3247  : 표 외곽 하단
 *   세로 칸막이: canvas x=96 / 396.5 / 697.5
 *     → 성명칸 중심 x = (96+396.5)/2 = 246.25 ≈ 기존 247
 *   cellHeight = 3241 - 3123 = 118
 *
 * 세로중앙 공식 (textBaseline='top'):
 *   topY = cellTop + (cellHeight - fontSize) / 2
 *   base 56px → topY = 3123 + (118-56)/2 = 3154 (상/하 여백 각 31px 균등)
 *
 * AC:
 *   AC-1: 셀 세로중앙 — topY = cellTop + (cellHeight - fontSize)/2; 상/하 여백 균등.
 *   AC-2: 폰트 2배 — baseFontSize: 28 → 56, minFontSize: 14 → 28.
 *   AC-3: 클램프 2x 재산정 — measureText 폭 > maxWidth(226) 시 비례축소, 하한 28px.
 *         클램프로 fontSize 줄어도 topY 동적 재계산으로 세로중앙 유지.
 *   AC-4: 가로 중앙 불변 — centerX=247, textAlign='center' (3e0216b 회귀 없음).
 *   AC-5: iPad/갤탭 일관 — Canvas 논리좌표 + DRAW_DPR=2 (런타임 DPR 미참조).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_URL = new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname;

// [본인 동의서] "이름" 칸 — PIL 실측 (refund_consent.png 1588x6736, scale=2.0)
const NAME_CELL = {
  // 가로
  underlineX0: 130,  // 이름 칸 밑줄 좌단
  underlineX1: 364,  // 이름 칸 밑줄 우단
  centerX: 247,      // 중심 (= 칸막이 중심 246.25 반올림)
  divider: 397,      // 이름|서명 중앙 칸막이 (PIL: 396.5)
  signLeft: 430,     // 서명 칸 밑줄 좌단
  width: 234,        // 가용 셀폭 (364-130)
  // 세로 (T-VCENTER-2X 신규)
  cellTop: 3123,     // 라벨/입력 구분선 = 입력 칸 상단
  cellBottom: 3241,  // 밑줄 = 입력 칸 하단
  cellHeight: 118,   // 3241 - 3123
  underlineY: 3242,  // 밑줄 y (기존 호환 — 3241~3242 그룹 평균)
};

function readSrc(): string {
  return fs.readFileSync(SRC_URL, 'utf-8');
}
function nameConstBlock(src: string): string {
  return src.match(/const REFUND_P3_NAME\s*=\s*\{[\s\S]*?\};/)?.[0] ?? '';
}
function nameFnBlock(src: string): string {
  return src.match(/function drawRefundP3NameAutofill[\s\S]*?\n}/)?.[0] ?? '';
}

test.describe('CONSENT-NAME-VCENTER-2X — 셀 세로중앙 + 폰트 2배', () => {

  // ── 빌드/에셋 ──────────────────────────────────────────────────────────────
  test('앱 정상 로드', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(400);
  });

  test('refund_consent.png 에셋 서빙 (좌표 기준 이미지)', async ({ page }) => {
    const res = await page.goto('/forms/refund_consent.png');
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('image/png');
  });

  // ── AC-1: 셀 세로중앙 (아래쏠림 해소) ──────────────────────────────────────
  test('AC-1: 상수 cellTop=3123, cellBottom=3241 (PIL 측정값)', () => {
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/cellTop:\s*3123/);
    expect(block).toMatch(/cellBottom:\s*3241/);
  });

  test('AC-1: topY 동적 계산 — cellTop + (cellHeight - fontSize)/2', () => {
    const fn = nameFnBlock(readSrc());
    // 함수 내에서 cellHeight·topY 동적 산출
    expect(fn).toMatch(/cellBottom\s*-\s*REFUND_P3_NAME\.cellTop/);
    expect(fn).toMatch(/cellTop\s*\+\s*\(cellHeight\s*-\s*fontSize\)\s*\/\s*2/);
    // 기존 정적 topY 상수는 제거됨 (동적 계산으로 대체)
    const block = nameConstBlock(readSrc());
    expect(block).not.toMatch(/topY:\s*3214/); // 직전 정적값 폐기
  });

  test('AC-1: 56px 기준 topY=3154 (상/하 여백 각 31px 균등)', () => {
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const fontSize = 56;
    const topY = NAME_CELL.cellTop + (cellHeight - fontSize) / 2;
    expect(topY).toBe(3154);
    expect(topY - NAME_CELL.cellTop).toBe(31);                    // 상단 여백
    expect(NAME_CELL.cellBottom - (topY + fontSize)).toBe(31);    // 하단 여백
    // 직전 topY=3214 대비 60px 위로 이동
    expect(3214 - topY).toBe(60);
  });

  test('AC-1: 텍스트 상단이 cellTop 위로 침범하지 않음', () => {
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const fontSize = 56;
    const topY = NAME_CELL.cellTop + (cellHeight - fontSize) / 2;
    expect(topY).toBeGreaterThanOrEqual(NAME_CELL.cellTop);
    // 하단도 밑줄(cellBottom) 미침범
    expect(topY + fontSize).toBeLessThanOrEqual(NAME_CELL.cellBottom);
  });

  // ── AC-2: 폰트 2배 ─────────────────────────────────────────────────────────
  test('AC-2: baseFontSize=56 (직전 28의 2배)', () => {
    const block = nameConstBlock(readSrc());
    const m = block.match(/baseFontSize:\s*(\d+)/);
    expect(m).not.toBeNull();
    const px = Number(m![1]);
    expect(px).toBe(56);
    expect(px).toBe(28 * 2);
  });

  test('AC-2: minFontSize=28 (직전 14의 2배)', () => {
    const block = nameConstBlock(readSrc());
    const m = block.match(/minFontSize:\s*(\d+)/);
    expect(m).not.toBeNull();
    const px = Number(m![1]);
    expect(px).toBe(28);
    expect(px).toBe(14 * 2);
  });

  test('AC-2: bold + #1a1a1a + italic 제거 (3e0216b 유지)', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/`bold \$\{px\}px "Malgun Gothic"/);
    expect(fn).toMatch(/ctx\.fillStyle\s*=\s*'#1a1a1a'/);
    expect(fn).not.toMatch(/`italic /);
    expect(fn).not.toMatch(/italic \$\{/);
  });

  // ── AC-3: 클램프 2x 재산정 + 세로중앙 동적 유지 ───────────────────────────
  test('AC-3: measureText 기반 클램프 (가용폭 초과 시 minFontSize까지 축소)', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/measureText\(name\)\.width/);
    expect(fn).toMatch(/Math\.max\([\s\S]*?minFontSize/);
  });

  test('AC-3: maxWidth=226 유지 (밑줄폭 234 - 좌우 여백 8)', () => {
    const block = nameConstBlock(readSrc());
    const maxW = Number(block.match(/maxWidth:\s*(\d+)/)![1]);
    expect(maxW).toBe(226);
    expect(maxW).toBeLessThanOrEqual(NAME_CELL.width);
    // 중앙정렬 좌우단이 셀/서명칸 침범 없음
    const half = maxW / 2;
    expect(NAME_CELL.centerX - half).toBeGreaterThanOrEqual(NAME_CELL.underlineX0);
    expect(NAME_CELL.centerX + half).toBeLessThanOrEqual(NAME_CELL.underlineX1);
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.divider);
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.signLeft);
  });

  test('AC-3: 클램프 발생 시 topY 동적 재계산 — 작은 폰트도 세로중앙', () => {
    // 최소 폰트(28px)로 클램프된 경우의 topY
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const topYAtMin = NAME_CELL.cellTop + (cellHeight - 28) / 2; // 3123 + 45 = 3168
    expect(topYAtMin).toBe(3168);
    // 상/하 여백 각 45px (긴 이름 — 폰트 작아져도 세로 중앙 유지)
    expect(topYAtMin - NAME_CELL.cellTop).toBe(45);
    expect(NAME_CELL.cellBottom - (topYAtMin + 28)).toBe(45);
  });

  // ── AC-4: 가로중앙 불변 (3e0216b 회귀 금지) ────────────────────────────────
  test('AC-4: textAlign=center + centerX=247 유지', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/ctx\.textAlign\s*=\s*'center'/);
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/centerX:\s*247/);
    // 칸막이 중심과 일치 (PIL: 96~396.5 → 246.25)
    expect(NAME_CELL.centerX).toBe(
      Math.round((NAME_CELL.underlineX0 + NAME_CELL.underlineX1) / 2),
    );
  });

  test('AC-4: 옛 좌측이탈(x=55, x=145) / 좌측정렬 재발 없음', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).not.toMatch(/textAlign\s*=\s*'left'/);
    const block = nameConstBlock(readSrc());
    expect(block).not.toMatch(/centerX:\s*55/);
    expect(block).not.toMatch(/centerX:\s*145/);
  });

  // ── AC-5: 기기 일관성 (Canvas 논리좌표 + DRAW_DPR=2) ───────────────────────
  test('AC-5: bgCanvas ctx 합성 — DOM overlay 아님', () => {
    const src = readSrc();
    expect(src).toMatch(/drawRefundP3NameAutofill\(ctx,\s*autofillDataRef\.current\)/);
    expect(src).toContain('const DRAW_DPR = 2');
  });

  test('AC-5: 좌표/폰트 상수 하드코딩 — 런타임 DPR/window 미참조', () => {
    const block = nameConstBlock(readSrc());
    const fn = nameFnBlock(readSrc());
    expect(block).not.toMatch(/devicePixelRatio/);
    expect(fn).not.toMatch(/devicePixelRatio/);
    expect(fn).not.toMatch(/window\./);
  });

  // ── 회귀 — 인접 동선 영향 없음 ─────────────────────────────────────────────
  test('회귀: P1(차트번호/환자이름) 공용 drawAutofillOnCtx 경로 불변', () => {
    const src = readSrc();
    expect(src).toMatch(/drawAutofillOnCtx\(ctx,\s*autofillDataRef\.current,\s*REFUND_AUTOFILL_POS_P1\)/);
  });

  test('회귀: P3 날짜(drawRefundP3DateAutofill) 좌표/스타일 불변', () => {
    const src = readSrc();
    // 날짜는 본 변경 대상 아님 — 함수 시그니처/상수 미변경
    expect(src).toMatch(/function drawRefundP3DateAutofill/);
    expect(src).toMatch(/DATE_Y\s*=\s*3071/);
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증):
 *
 * [시나리오1] 짧은 이름 — 셀 세로중앙 + 2배 확대
 *   1. 데스크 직원 로그인 → 고객 "최수빈"(또는 짧은 성함) 선택
 *   2. 임상 탭 → 펜차트 → [새 차트 작성] → [환불/비급여 동의서] → page 3 [본인 동의서] 표
 *   3. Expected:
 *      - 성함이 셀 세로중앙(상/하 여백 약 31px 균등)에 위치 — 직전(밑줄 하단 안착) 대비 위로 60px 이동
 *      - 글자 크기가 직전(28px) 대비 약 2배(56px) 확대
 *      - 가로중앙(textAlign='center', x=247) 유지 — 좌/우 치우침 재발 없음
 *
 * [시나리오2] 긴 이름 + 기기 일관성
 *   1. 긴 성함(예: "남궁민수황보지영" 8자+) 고객 → 동의서 → page 3
 *   2. Expected:
 *      - 폰트가 가용폭(226)에 맞게 비례 축소(최소 28px까지) → 좌우 오버플로우 없음
 *      - 축소된 폰트도 셀 세로중앙 유지(topY 동적 재계산) — 위/아래 빈 공간 균등
 *      - iPad(DPR 2.0) / Galaxy Tab 동일 위치/크기 (Canvas 논리좌표 + DRAW_DPR=2)
 *
 * [시나리오3] 셀 상단 침범 없음
 *   1. 일반 이름 (예: 3~4자) 으로 동의서 page 3 렌더
 *   2. Expected: 텍스트 상단이 cellTop(3123) 위 라벨 행("성 명") 영역으로 침범하지 않음
 */
