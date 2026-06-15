import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-20260615-foot-THEME-MONO-REFINE-3AREA (김주연 총괄, planner MSG-20260615-113002)
 *
 * 부모 T-20260614-foot-THEME-MONOCHROME-RECOLOR(라이브 ae94d51) 후속 — 전역 토큰 재교체 아님.
 * 아래 3개 특정 영역만 국소 모노톤 정제:
 *
 *  AC1 [통합시간표 슬롯] — 초진 노랑 / 재진 초록 의미색(배경 채도) 제거 → 모노톤.
 *      구분은 텍스트(초 배지)+보더 두께로만. 전용 슬롯 카드(TimelineCheckInCard/Box1/Box2/
 *      DraggableBox1/DraggableBox2)·컬럼헤더·슬롯 배경 틴트에 한정.
 *      ⚠ carve-out 보존: 칸반 단계배지(status.ts pin)·VISIT_TYPE_COLOR 재진유형칩·힐러(healer)
 *      ·워크인(W)·노쇼·레이저 타이머(amber) 등 다른 의미색 절대 미접촉.
 *  AC2 [2번 차트(CustomerChartPage) 전체] — 장식성 다색(blue/indigo/sky/cyan/violet/purple/
 *      fuchsia/pink) → slate 모노톤. red(경고/삭제)·green/emerald(완료/재진)·amber/yellow(타이머)·
 *      teal(부모 warm-mono remap 완료)는 앱 전역 의미색 carve-out 정책상 보존.
 *  AC3 [직원 근무 캘린더 치료사 탭] — 부모 teal→brown 전역 스윕이 침범한 치료사 의미색을
 *      teal→green 으로 정정(녹색 원복). 출근자 칩(staffRoleCardClass.therapist)은 이미 green.
 *
 * 본 spec 은 auth 불요(unit 프로젝트). 정적 소스 가드 + 컴파일 CSS 가드.
 */

const ROOT = process.cwd();
const dashboard = readFileSync(join(ROOT, 'src', 'pages', 'Dashboard.tsx'), 'utf8');
const handover = readFileSync(join(ROOT, 'src', 'lib', 'handover.ts'), 'utf8');
const chart = readFileSync(join(ROOT, 'src', 'pages', 'CustomerChartPage.tsx'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

// ── 통합시간표 전용 슬롯 카드 구간만 슬라이스 (칸반·기타 영역 오탐 방지) ──
//   DashboardTimeline 의 슬롯 카드/헤더 컴포넌트는 box2Cls(L~1373) ~ 재진 컬럼 렌더(L~2445) 구간.
function sliceTimeline(src: string): string {
  const start = src.indexOf('// 2번 박스 활성화 스타일');
  const end = src.indexOf('{/* ── AC-7: 아코디언 패널');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('THEME-MONO-REFINE-3AREA — 정적 소스 가드 (auth 불요)', () => {
  test('AC1: 통합시간표 슬롯 카드/헤더에서 초진 노랑·재진 초록 배경 채도가 제거됐다', () => {
    // carve-out 라인(힐러 노란 배지)은 별도 테스트로 검증 → no-yellow 단언에서 제외
    const seg = sliceTimeline(dashboard).replace(
      /text-yellow-700 bg-yellow-100 border border-yellow-300/g,
      '<<HEALER_CARVEOUT>>',
    );
    // 초진 노랑(yellow) 슬롯 배경/보더/텍스트 누수 0 — 잔존 시 실패
    expect(seg).not.toMatch(/bg-yellow-50\b/);
    expect(seg).not.toMatch(/border-yellow-(300|400|500)\b/);
    expect(seg).not.toMatch(/text-yellow-(700|800|900)\b/);
    expect(seg).not.toMatch(/bg-yellow-(200|300|500|600|700)\b/);
    // 재진 초록(green) 슬롯 배경/보더/텍스트 누수 0
    expect(seg).not.toMatch(/bg-green-50\b/);
    expect(seg).not.toMatch(/border-green-(300|400)\b/);
    expect(seg).not.toMatch(/text-green-(600|700|900)\b/);
    expect(seg).not.toMatch(/bg-green-(500|600|700)\b/);
    // 모노톤 대체 클래스가 실제로 들어갔다
    expect(seg).toMatch(/border-gray-400 bg-white/);   // 초진 카드
    expect(seg).toMatch(/border-gray-300 bg-gray-50/); // 재진 카드
  });

  test('AC1(carve-out): 힐러(healer) 노란 배지 의미색은 통합시간표 슬롯 내에서 보존된다', () => {
    const seg = sliceTimeline(dashboard);
    // 힐러 배지(yellow)는 초진/재진 구분색이 아니므로 미접촉 → 잔존해야 정상
    expect(seg).toMatch(/text-yellow-700 bg-yellow-100 border border-yellow-300/);
  });

  test('AC1(carve-out): VISIT_TYPE_COLOR(재진유형칩) 공유 토큰은 status.ts 에서 미변경(emerald 보존)', () => {
    expect(status).toMatch(/returning:\s*'bg-emerald-100 text-emerald-700'/);
  });

  test('AC3: handover 치료사 part 색이 teal→green 으로 정정됐다', () => {
    expect(handover).toMatch(/code:\s*'therapist',\s*label:\s*'치료사',\s*color:\s*'green'/);
    expect(handover).toMatch(/therapist:\s*'bg-green-100 text-green-700'/);
    expect(handover).toMatch(/therapist:\s*'bg-green-50 border-green-200'/);
    // 구 teal 치료사 색 누수 0
    expect(handover).not.toMatch(/therapist:\s*'bg-teal-/);
    expect(handover).not.toMatch(/'치료사',\s*color:\s*'teal'/);
  });

  test('AC3(carve-out): 출근자 칩 therapist 의미색(green)은 status.ts 에 그대로 보존', () => {
    expect(status).toMatch(/therapist:\s*'bg-green-100 text-green-800 border-green-300'/);
  });

  test('AC2: 2번 차트(CustomerChartPage)에서 장식성 다색 계열이 0건이다 (→ slate)', () => {
    const decorative = chart.match(
      /(bg|text|border|ring|from|to|via|divide|outline|decoration|shadow|accent|caret|fill|stroke)-(purple|violet|indigo|sky|blue|cyan|fuchsia|pink)-[0-9]{2,3}/g,
    );
    expect(decorative).toBeNull();
    // slate 모노톤이 실제로 적용됐다
    expect(chart).toMatch(/bg-slate-/);
  });

  test('AC2(carve-out): 차트 내 의미색(red 경고·green/emerald 완료·amber 타이머)은 보존된다', () => {
    // 앱 전역 의미색 정책 — 차트에서도 유지
    expect(chart).toMatch(/text-red-(500|600)\b/);   // 경고/over-limit
    expect(chart).toMatch(/bg-emerald-600\b/);        // after 카메라 등 완료/성공
    expect(chart).toMatch(/bg-amber-50\b/);           // 타이머/경고 톤
  });
});

test.describe('THEME-MONO-REFINE-3AREA — 컴파일 CSS 가드 (빌드 산출물)', () => {
  test('빌드 CSS: slate 모노톤 반영 + 부모 warm-mono/칸반 pin/emerald 의미색 보존', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFile = readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
    if (!cssFile) test.skip(true, 'compiled css 미발견');
    const compiled = readFileSync(join(distAssets, cssFile!), 'utf8');

    // 부모 warm 포인트(teal dark-end) 보존 — 본 티켓은 부모 토큰 미변경
    expect(compiled).toMatch(/#6e6353/i);
    // 칸반 pin HEX 보존(레인보우 carve-out)
    expect(compiled).toContain('#ccfbf1');
    expect(compiled).toContain('#2dd4bf');
    // emerald 의미색(재진/laser/완료) 보존
    expect(compiled).toMatch(/#10b981/i); // emerald-500
  });
});
