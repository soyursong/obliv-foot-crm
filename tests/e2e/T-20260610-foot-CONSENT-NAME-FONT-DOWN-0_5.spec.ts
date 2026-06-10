/**
 * E2E spec: T-20260610-foot-CONSENT-NAME-FONT-DOWN-0_5
 * 환불/비급여 동의서 P3 [본인 동의서] 하단 "이름" 칸 자동삽입 성명 폰트 0.5 미세 축소.
 *   baseFontSize: 56 → 42  (직전 T-VCENTER-2X 의 56 에서 0.5 미세축소)
 *   minFontSize : 28 → 21  (42 기준 동일 0.75 비율)
 *   centerX·cellTop·cellBottom·maxWidth·textAlign·세로중앙 식 전부 불변.
 *
 * 보고: 김주연 총괄 6/10 (풋 채널 thread 1781050107.524149)
 *   > "동의서 성명칸 자동삽입 글자 크기를 0.5 줄여줘"
 *
 * extends T-20260610-foot-CONSENT-NAME-VCENTER-2X (deployed, base 56):
 *   세로중앙 공식(textBaseline='top'): topY = cellTop + (cellHeight - fontSize)/2
 *   → fontSize 감소를 자동 반영하므로 좌표 작업 불요(쏠림 없음).
 *
 * ⚠ 동일 슬롯 5번째 터치 (28→56→42 폰트 왕복). 본 건으로 수렴 마감 —
 *   상수 주석을 42/21 기준으로 동기 갱신.
 *
 * 셀 기하 — PIL 측정(refund_consent.png 1588x6736, scale PNG/canvas=2.0):
 *   cellTop=3123 / cellBottom=3241 / cellHeight=118 / centerX=247  (전부 불변)
 *
 * 세로중앙 (base 42px):
 *   topY = 3123 + (118-42)/2 = 3161 (상/하 여백 각 38px 균등)
 *
 * AC:
 *   AC-1: 폰트 축소 — baseFontSize 56 → 42, minFontSize 28 → 21.
 *   AC-2: 세로중앙 자동 유지 — topY=3161 (상/하 38px 균등), 쏠림 없음.
 *   AC-3: 가로중앙 회귀 없음 — centerX=247, textAlign='center'.
 *   AC-4: 긴이름 클램프 정상 — measureText > maxWidth(226) 시 비례축소, 하한 21px.
 *   AC-5: iPad/갤탭 일관 — Canvas 논리좌표 + DRAW_DPR=2 (런타임 DPR 미참조).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_URL = new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname;

// [본인 동의서] "이름" 칸 — PIL 실측 (refund_consent.png 1588x6736, scale=2.0)
const NAME_CELL = {
  underlineX0: 130,  // 이름 칸 밑줄 좌단
  underlineX1: 364,  // 이름 칸 밑줄 우단
  centerX: 247,      // 중심 (= 칸막이 중심 246.25 반올림)
  divider: 397,      // 이름|서명 중앙 칸막이 (PIL: 396.5)
  signLeft: 430,     // 서명 칸 밑줄 좌단
  width: 234,        // 가용 셀폭 (364-130)
  cellTop: 3123,     // 라벨/입력 구분선 = 입력 칸 상단
  cellBottom: 3241,  // 밑줄 = 입력 칸 하단
  cellHeight: 118,   // 3241 - 3123
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

test.describe('CONSENT-NAME-FONT-DOWN-0_5 — 성명 폰트 56→42 미세축소 (수렴 마감)', () => {

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

  // ── AC-1: 폰트 축소 ────────────────────────────────────────────────────────
  test('AC-1: baseFontSize=42 (직전 56에서 축소, 옛 56/28 회귀 없음)', () => {
    const block = nameConstBlock(readSrc());
    const m = block.match(/baseFontSize:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(42);
    // 직전값(56) 폐기 확인
    expect(block).not.toMatch(/baseFontSize:\s*56/);
  });

  test('AC-1: minFontSize=21 (42 기준 0.75 비율, 옛 28 회귀 없음)', () => {
    const block = nameConstBlock(readSrc());
    const m = block.match(/minFontSize:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(21);
    expect(block).not.toMatch(/minFontSize:\s*28/);
  });

  test('AC-1: base 42 < 직전 base 56 (축소 방향 검증)', () => {
    const block = nameConstBlock(readSrc());
    const base = Number(block.match(/baseFontSize:\s*(\d+)/)![1]);
    expect(base).toBeLessThan(56);
  });

  // ── AC-2: 세로중앙 자동 유지 (좌표 식 불변) ────────────────────────────────
  test('AC-2: topY 동적 식 불변 — cellTop + (cellHeight - fontSize)/2', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/cellBottom\s*-\s*REFUND_P3_NAME\.cellTop/);
    expect(fn).toMatch(/cellTop\s*\+\s*\(cellHeight\s*-\s*fontSize\)\s*\/\s*2/);
  });

  test('AC-2: 42px 기준 topY=3161 (상/하 여백 각 38px 균등)', () => {
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const fontSize = 42;
    const topY = NAME_CELL.cellTop + (cellHeight - fontSize) / 2;
    expect(topY).toBe(3161);
    expect(topY - NAME_CELL.cellTop).toBe(38);                  // 상단 여백
    expect(NAME_CELL.cellBottom - (topY + fontSize)).toBe(38);  // 하단 여백
  });

  test('AC-2: 셀 경계 미침범 (상단·하단 모두)', () => {
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const fontSize = 42;
    const topY = NAME_CELL.cellTop + (cellHeight - fontSize) / 2;
    expect(topY).toBeGreaterThanOrEqual(NAME_CELL.cellTop);
    expect(topY + fontSize).toBeLessThanOrEqual(NAME_CELL.cellBottom);
  });

  test('AC-2: 셀 기하 상수 불변 (cellTop=3123, cellBottom=3241, centerX=247)', () => {
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/cellTop:\s*3123/);
    expect(block).toMatch(/cellBottom:\s*3241/);
    expect(block).toMatch(/centerX:\s*247/);
    expect(block).toMatch(/maxWidth:\s*226/);
  });

  // ── AC-3: 가로중앙 회귀 없음 ───────────────────────────────────────────────
  test('AC-3: textAlign=center + centerX=247 유지', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/ctx\.textAlign\s*=\s*'center'/);
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/centerX:\s*247/);
    expect(NAME_CELL.centerX).toBe(
      Math.round((NAME_CELL.underlineX0 + NAME_CELL.underlineX1) / 2),
    );
  });

  test('AC-3: 좌측정렬/좌측이탈(55,145) 재발 없음', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).not.toMatch(/textAlign\s*=\s*'left'/);
    const block = nameConstBlock(readSrc());
    expect(block).not.toMatch(/centerX:\s*55/);
    expect(block).not.toMatch(/centerX:\s*145/);
  });

  // ── AC-4: 긴이름 클램프 정상 (하한 21px) ───────────────────────────────────
  test('AC-4: measureText 기반 클램프 — minFontSize까지 축소', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/measureText\(name\)\.width/);
    expect(fn).toMatch(/Math\.max\([\s\S]*?minFontSize/);
  });

  test('AC-4: maxWidth=226 — 중앙정렬 좌우단 셀/서명칸 미침범', () => {
    const block = nameConstBlock(readSrc());
    const maxW = Number(block.match(/maxWidth:\s*(\d+)/)![1]);
    expect(maxW).toBe(226);
    expect(maxW).toBeLessThanOrEqual(NAME_CELL.width);
    const half = maxW / 2;
    expect(NAME_CELL.centerX - half).toBeGreaterThanOrEqual(NAME_CELL.underlineX0);
    expect(NAME_CELL.centerX + half).toBeLessThanOrEqual(NAME_CELL.underlineX1);
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.divider);
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.signLeft);
  });

  test('AC-4: 최소폰트(21px) 클램프 시 세로중앙 유지 — topY=3171.5', () => {
    const cellHeight = NAME_CELL.cellBottom - NAME_CELL.cellTop;
    const topYAtMin = NAME_CELL.cellTop + (cellHeight - 21) / 2;
    expect(topYAtMin).toBe(3171.5);
    expect(topYAtMin - NAME_CELL.cellTop).toBe(48.5);
    expect(NAME_CELL.cellBottom - (topYAtMin + 21)).toBe(48.5);
  });

  // ── AC-5: 기기 일관성 ──────────────────────────────────────────────────────
  test('AC-5: bgCanvas ctx 합성 + DRAW_DPR=2', () => {
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

  // ── 스타일 불변 (italic 제거·bold·#1a1a1a) ─────────────────────────────────
  test('스타일 불변: bold + #1a1a1a + italic 없음', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/`bold \$\{px\}px "Malgun Gothic"/);
    expect(fn).toMatch(/ctx\.fillStyle\s*=\s*'#1a1a1a'/);
    expect(fn).not.toMatch(/`italic /);
  });

  // ── 회귀 — 인접 동선 영향 없음 ─────────────────────────────────────────────
  test('회귀: P1(차트번호/환자이름) 공용 drawAutofillOnCtx 경로 불변', () => {
    const src = readSrc();
    expect(src).toMatch(/drawAutofillOnCtx\(ctx,\s*autofillDataRef\.current,\s*REFUND_AUTOFILL_POS_P1\)/);
  });

  test('회귀: P3 날짜(drawRefundP3DateAutofill) 좌표/스타일 불변', () => {
    const src = readSrc();
    expect(src).toMatch(/function drawRefundP3DateAutofill/);
    expect(src).toMatch(/DATE_Y\s*=\s*3071/);
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증):
 *
 * [시나리오1] 짧은 이름 — 폰트 0.5 미세축소 + 세로중앙 유지
 *   1. 데스크 직원 로그인 → 고객 "최수빈"(짧은 성함) 선택
 *   2. 임상 탭 → 펜차트 → [새 차트 작성] → [환불/비급여 동의서] → page 3 [본인 동의서] 표
 *   3. Expected:
 *      - 글자 크기가 직전(56px) 대비 약간 작아짐(42px) — "0.5 줄임" 체감
 *      - 성함이 셀 세로중앙(상/하 여백 약 38px 균등) — 쏠림 없음(직전 위치감 유지)
 *      - 가로중앙(textAlign='center', x=247) 유지 — 좌/우 치우침 재발 없음
 *
 * [시나리오2] 긴 이름 + 기기 일관성
 *   1. 긴 성함(예: "남궁민수황보지영" 8자+) 고객 → 동의서 → page 3
 *   2. Expected:
 *      - 폰트가 가용폭(226)에 맞게 비례 축소(최소 21px까지) → 좌우 오버플로우 없음
 *      - 축소된 폰트도 셀 세로중앙 유지(topY 동적 재계산)
 *      - iPad(DPR 2.0) / Galaxy Tab 동일 위치/크기
 *
 * [시나리오3] 셀 상단 침범 없음
 *   1. 일반 이름(3~4자) 으로 동의서 page 3 렌더
 *   2. Expected: 텍스트 상단이 cellTop(3123) 위 라벨 행("성 명") 영역으로 침범하지 않음
 */
