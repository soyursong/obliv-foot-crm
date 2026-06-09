/**
 * E2E spec: T-20260609-foot-CONSENT-NAME-CENTER-FONT
 * 환불/비급여 동의서 하단 [본인 동의서] "이름" 칸 자동삽입 성명을
 *   ⓐ 칸 가로 중앙정렬(좌측정렬 → center) ⓑ 폰트 확대 + bold(15 → bold 28px)
 *   ⓒ 또렷한 정자체(italic 제거) ⓓ fillStyle '#1a1a1a' (진하게).
 *   [정밀 코드 스펙 — planner MSG-20260609-165224 정본 반영]
 *
 * 보고: 김주연 총괄 6/9 — evidence ~/file_inbox/20260609/164600_F0B924NEZK5_IMG_8233.jpg
 *   하단 성명 칸 "최수빈"이 좌측·작게 표시 → 칸 중앙에 크고 또렷하게.
 *
 * extends T-20260609-foot-REFUND-NAME-AUTOFILL-POSITION (밑줄 위 안착 좌표 — 되돌리지 않음):
 *   동일 셀 기하 [본인 동의서] "이름" 칸 밑줄 y=3242, x=130~364 (중심 247, 가용폭 234px).
 *   직전 건은 좌단(x=145, textAlign left)에 안착 → 본 건은 그 위 증분으로 중심정렬 + 확대.
 *
 * 구현: drawAutofillOnCtx(공용, P1과 공유) 대신 전용 drawRefundP3NameAutofill 도입
 *   (중앙정렬 + measureText 기반 긴이름 폰트 클램프 필요 → drawRefundP3DateAutofill 선례 따름).
 *
 * AC:
 *   AC-1: 중앙정렬 — textAlign='center', 기준점 centerX=247 (칸 밑줄 중심)
 *   AC-2: 폰트 확대+bold — baseFontSize=28 'bold' (구 15px보다 큼) + fillStyle '#1a1a1a' + italic 제거
 *   AC-3: 긴 이름(≤14자) 클램프 — 측정폭이 가용폭(maxWidth=226) 초과 시 폰트 비례 축소(최소 14px),
 *         좌우 오버플로우/서명칸(x≥430)·중앙 칸막이(397) 침범 방지
 *   AC-4: iPad/갤탭 일관 — Canvas 논리좌표 합성 + DRAW_DPR=2, 런타임 DPR 미참조
 *   AC-5: 직전 안착 회귀 금지 — 동일 셀(밑줄 130~364, y=3242) 기하 유지; textBaseline='top'
 *         topY=3214 → +28px(폰트) → 하단≈3242(밑줄) 안착, 밑줄 침범 없음
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC_URL = new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname;

// [본인 동의서] "이름" 칸 — PIL 실측 (refund_consent.png 2481×10524 → canvas 794×3369)
const NAME_CELL = {
  underlineX0: 130,  // 이름 칸 밑줄 좌단
  underlineX1: 364,  // 이름 칸 밑줄 우단
  centerX: 247,      // 중심
  divider: 397,      // 이름|서명 중앙 칸막이
  signLeft: 430,     // 서명 칸 밑줄 좌단
  underlineY: 3242,  // 밑줄 y
  width: 234,        // 가용 셀폭 (364-130)
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

// [SUPERSEDED 2026-06-10 by T-20260610-foot-CONSENT-NAME-VCENTER-2X]
//   직전 정적 topY=3214 / baseFontSize=28 / minFontSize=14 단언은 본 증분(세로중앙 동적 topY +
//   2x 확대 56/28)으로 폐기. 회귀 어서션은 새 spec(T-VCENTER-2X)에서 cellTop/cellBottom 기준으로
//   재정의. 가로중앙(centerX=247, textAlign='center') 단언만 살아있는 게이트는 새 spec AC-4가 이어받음.
//   이 describe는 .skip 으로 봉인하여 변천 이력만 보존.
test.describe.skip('[SUPERSEDED] CONSENT-NAME-CENTER-FONT — 하단 본인동의서 성명 중앙정렬+확대', () => {

  // ── 빌드/에셋 ────────────────────────────────────────────────────────────
  test('앱 정상 로드', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(400);
  });

  test('refund_consent.png 에셋 서빙 (좌표 기준 이미지)', async ({ page }) => {
    const res = await page.goto('/forms/refund_consent.png');
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('image/png');
  });

  // ── AC-1: 중앙정렬 ───────────────────────────────────────────────────────
  test('AC-1: textAlign=center + centerX=247 (칸 밑줄 중심)', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/ctx\.textAlign\s*=\s*'center'/);
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/centerX:\s*247/);
    expect(NAME_CELL.centerX).toBe(
      Math.round((NAME_CELL.underlineX0 + NAME_CELL.underlineX1) / 2),
    ); // 247 = (130+364)/2
  });

  // ── AC-2: 폰트 확대 + bold + 진한 색 + 또렷한 정자체 ─────────────────────
  test('AC-2: baseFontSize=28 (구 15px보다 확대 — 정밀 코드 스펙)', () => {
    const block = nameConstBlock(readSrc());
    const m = block.match(/baseFontSize:\s*(\d+)/);
    expect(m).not.toBeNull();
    const px = Number(m![1]);
    expect(px).toBeGreaterThan(15); // 구 drawAutofillOnCtx 15px 대비 확대
    expect(px).toBe(28);
  });

  test('AC-2: bold + fillStyle #1a1a1a (진하고 또렷)', () => {
    const fn = nameFnBlock(readSrc());
    // fontOf 헬퍼가 'bold {px}px ...' 로 시작 (bold weight)
    expect(fn).toMatch(/`bold \$\{px\}px "Malgun Gothic"/);
    // 진한 글자색 — 정밀 스펙 #1a1a1a (구 gray-500 #6b7280 대비 진함)
    expect(fn).toMatch(/ctx\.fillStyle\s*=\s*'#1a1a1a'/);
    expect(fn).not.toMatch(/#6b7280/);
  });

  test('AC-2: 또렷한 정자체 — 폰트 문자열에 italic 키워드 없음', () => {
    const fn = nameFnBlock(readSrc());
    // 폰트 빌드 문자열에 italic 슬랜트 미포함 (구 drawAutofillOnCtx 의 `italic ${...}px` 와 대비)
    expect(fn).not.toMatch(/`italic /);
    expect(fn).not.toMatch(/italic \$\{/);
  });

  // ── AC-3: 긴 이름 클램프 — 오버플로우/침범 없음 ─────────────────────────
  test('AC-3: measureText 기반 폰트 클램프 (가용폭 maxWidth 초과 시 축소)', () => {
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/measureText\(name\)\.width/);
    expect(fn).toMatch(/Math\.max\([\s\S]*?minFontSize/); // 하한 클램프
    const block = nameConstBlock(readSrc());
    expect(block).toMatch(/minFontSize:\s*14/);
  });

  test('AC-3: maxWidth(226) 중앙정렬 시 좌우단이 셀 밑줄(130~364)·서명칸(430) 침범 없음', () => {
    const block = nameConstBlock(readSrc());
    const maxW = Number(block.match(/maxWidth:\s*(\d+)/)![1]); // 226
    expect(maxW).toBeLessThanOrEqual(NAME_CELL.width); // ≤ 234 (셀폭)
    const half = maxW / 2; // 113
    expect(NAME_CELL.centerX - half).toBeGreaterThanOrEqual(NAME_CELL.underlineX0); // 좌단 ≥ 130
    expect(NAME_CELL.centerX + half).toBeLessThanOrEqual(NAME_CELL.underlineX1);    // 우단 ≤ 364
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.divider);              // 칸막이(397) 미침범
    expect(NAME_CELL.centerX + half).toBeLessThan(NAME_CELL.signLeft);             // 서명칸(430) 미침범
  });

  // ── AC-4: iPad/갤탭 일관 (Canvas 논리좌표 + DRAW_DPR=2) ──────────────────
  test('AC-4: bgCanvas ctx 합성 — DOM overlay 아님', () => {
    const src = readSrc();
    expect(src).toMatch(/drawRefundP3NameAutofill\(ctx,\s*autofillDataRef\.current\)/);
    expect(src).toContain('const DRAW_DPR = 2');
  });

  test('AC-4: 좌표/폰트 상수는 하드코딩 — 런타임 DPR/window 미참조', () => {
    const block = nameConstBlock(readSrc());
    const fn = nameFnBlock(readSrc());
    expect(block).not.toMatch(/devicePixelRatio/);
    expect(fn).not.toMatch(/devicePixelRatio/);
    expect(fn).not.toMatch(/window\./);
  });

  // ── AC-5: 직전 안착 회귀 금지 ────────────────────────────────────────────
  test('AC-5: topY=3214 + 28px → 하단≈3242(밑줄) 안착 (밑줄 침범 없음)', () => {
    const block = nameConstBlock(readSrc());
    const topY = Number(block.match(/topY:\s*(\d+)/)![1]);          // 3214
    const fontSize = Number(block.match(/baseFontSize:\s*(\d+)/)![1]); // 28
    // top baseline → 텍스트 상단=topY, 하단=topY+fontSize. 하단이 밑줄(3242) 근처에 안착.
    const bottom = topY + fontSize;
    expect(bottom).toBeLessThanOrEqual(NAME_CELL.underlineY);        // ≤ 3242, 밑줄 비침범
    expect(NAME_CELL.underlineY - bottom).toBeLessThanOrEqual(6);    // 밑줄에 바짝 안착(떠보임 없음)
    const fn = nameFnBlock(readSrc());
    expect(fn).toMatch(/ctx\.textBaseline\s*=\s*'top'/);
  });

  test('AC-5: 동일 셀 기하 유지 — 옛 좌측이탈(x=55) / 부유(y=3206) 재발 없음', () => {
    const block = nameConstBlock(readSrc());
    expect(block).not.toMatch(/55/);
    expect(block).not.toMatch(/3206/);
    expect(block).toMatch(/centerX:\s*247/);
  });

  test('AC-5: P1(차트번호/환자이름) 공용 drawAutofillOnCtx 경로 불변', () => {
    const src = readSrc();
    // P1 은 여전히 공용 함수 사용 (본 변경은 P3 성명만 전용 함수로 분리)
    expect(src).toMatch(/drawAutofillOnCtx\(ctx,\s*autofillDataRef\.current,\s*REFUND_AUTOFILL_POS_P1\)/);
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증):
 *
 * [시나리오1] 짧은 이름 — 중앙·확대·또렷
 *   1. 데스크 직원 로그인 → 고객 "최수빈"(또는 짧은 성함) 선택
 *   2. 임상 탭 → 펜차트 → [새 차트 작성] → [환불/비급여 동의서] → page 3 [본인 동의서] 표로 스크롤
 *   3. Expected:
 *      - "이름" 칸 밑줄 위 *가로 중앙*에 성함이 크고 또렷한 정자체로 표시 (좌측 치우침 없음)
 *      - 구(좌측·작은 italic) 대비 확연히 큼, 밑줄 침범 없음
 *      - "서명" 칸은 빈칸(침범 없음), 날짜 "년/월/일" 정상(미변경)
 *
 * [시나리오2] 긴 이름 + 기기 일관성
 *   1. 긴 성함(예: "남궁민수황보지영" 8자+) 고객 → 동의서 → page 3
 *   2. Expected: 폰트가 칸 폭에 맞게 자동 축소되어 밑줄(130~364) 안에 중앙정렬,
 *      서명칸(430)·칸막이(397) 침범 없음
 *   3. iPad(DPR 2.0)·Galaxy Tab 동일 위치/크기 (canvas 논리좌표 + DRAW_DPR=2)
 */
