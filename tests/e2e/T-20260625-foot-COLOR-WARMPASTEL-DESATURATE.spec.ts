import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-20260625-foot-COLOR-WARMPASTEL-DESATURATE (김주연 총괄, thread 1782203281.046699)
 *   요청: "맑은 파스텔에서 파랑/초록만 채도 조금 더 빼줘 — 따듯 파스텔 정도?"
 *
 * 직전 적용("맑은 파스텔") 기준, 파랑(blue·재진/info)·하늘(sky·의사 대시보드)·초록(firstvisit·초진)
 * 토큰의 채도를 ~18~20% 낮춤(명도 L·색상 H 유지 → WCAG 대비 보존). 동일 토큰 소스 1곳 override 로
 * 전 화면 일괄 적용.
 *
 * 불변 carve-out(미접촉): status.ts 칸반 teal pin / error 빨강 / success·재진 emerald / Badge variant 의미색.
 * 역할 매핑 불변: 초진=파랑·재진=초록(톤만 변경).
 *
 * 본 spec = 현 색 체계(sage=그레이, 초진 그린=firstvisit, blue/sky=desat override)의 권위 living regression.
 *   ⚠ 선행 T-0622 SAGE-RECOLOR / T-0623 PASTEL-RETUNE 은 sage=그린 앵커(#DCEDC8) 시절 작성 → CHART2-MONOTONE
 *      redesign(sage→그레이·그린→firstvisit)로 superseded. 본 spec 이 그 자리를 대체한다.
 *
 * auth 불요(정적 소스 가드 + 컴파일 CSS 가드).
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const chart = readFileSync(join(ROOT, 'src', 'pages', 'CustomerChartPage.tsx'), 'utf8');
const resv = readFileSync(join(ROOT, 'src', 'pages', 'Reservations.tsx'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

test.describe('WARMPASTEL-DESATURATE — firstvisit(초진 초록) 채도↓ 재튜닝', () => {
  test('firstvisit 램프가 따듯 sage(채도↓) 값으로 재튜닝됐다', () => {
    expect(tw).toMatch(/\bfirstvisit:\s*\{/);
    expect(tw).toMatch(/50:\s*"#EFF4E6"/i);  // 초진 카드 bg
    expect(tw).toMatch(/100:\s*"#DCE9CC"/i); // 배지/칩 bg 앵커(구 #DCEDC8 채도↓)
    expect(tw).toMatch(/200:\s*"#C7D8AE"/i); // 보더
    expect(tw).toMatch(/500:\s*"#819C59"/i); // dot(묵직한 sage)
    expect(tw).toMatch(/700:\s*"#546838"/i); // 텍스트(AA)
    expect(tw).toMatch(/800:\s*"#42522E"/i);
  });

  test('구 firstvisit 앵커(#DCEDC8 등)가 토큰 슬롯에서 제거됐다(주석 이력 언급은 무관)', () => {
    expect(tw).not.toMatch(/:\s*"#DCEDC8"/i);
    expect(tw).not.toMatch(/:\s*"#C8DDA9"/i);
    expect(tw).not.toMatch(/:\s*"#556E32"/i);
    expect(tw).not.toMatch(/:\s*"#83A451"/i);
  });

  test('2번차트 신분증 확인완료 배지 인라인 hex가 새 firstvisit 값으로 동기화됐다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#DCE9CC',\s*color:\s*'#546838',\s*border:\s*'1\.5px solid #C7D8AE'/);
    expect(chart).toMatch(/rounded-full bg-firstvisit-500 inline-block/);
  });
});

test.describe('WARMPASTEL-DESATURATE — blue(재진·info)·sky(의사 대시보드) 채도↓ override', () => {
  test('tailwind blue 램프가 채도↓ 값으로 override 됐다(명도 유지)', () => {
    expect(tw).toMatch(/\bblue:\s*\{/);
    expect(tw).toMatch(/50:\s*"#F0F6FE"/i);
    expect(tw).toMatch(/100:\s*"#DEEAFB"/i);
    expect(tw).toMatch(/200:\s*"#C5DCF8"/i);
    expect(tw).toMatch(/700:\s*"#2E56C7"/i);
  });

  test('tailwind sky 램프가 채도↓ 값으로 override 됐다(명도 유지)', () => {
    expect(tw).toMatch(/\bsky:\s*\{/);
    expect(tw).toMatch(/50:\s*"#F1F9FE"/i);
    expect(tw).toMatch(/200:\s*"#C0E4F7"/i);
    expect(tw).toMatch(/700:\s*"#116593"/i);
  });

  test('Tailwind 기본 blue/sky vivid 값이 토큰 슬롯에서 제거됐다(따듯화 확인)', () => {
    expect(tw).not.toMatch(/:\s*"#1d4ed8"/i); // 기본 blue-700
    expect(tw).not.toMatch(/:\s*"#bfdbfe"/i); // 기본 blue-200
    expect(tw).not.toMatch(/:\s*"#0369a1"/i); // 기본 sky-700
  });
});

test.describe('WARMPASTEL-DESATURATE — 역할 매핑·carve-out 불변(미접촉)', () => {
  test('초진=파랑/firstvisit·재진=파랑(blue) 매핑 구조가 유지된다(톤만 변경)', () => {
    expect(resv).toMatch(/new:\s*'border-l-4 border-l-firstvisit-400 border-firstvisit-200\/80 bg-firstvisit-50'/);
    expect(resv).toMatch(/returning:\s*'border-l-4 border-l-blue-400 border-blue-200\/80 bg-blue-50'/);
  });

  test('status.ts 칸반 teal pin(의미색)은 미접촉 — 본 톤 변경에 비종속', () => {
    expect(status).toMatch(/#ccfbf1|#115e59|#2dd4bf/i);
  });

  test('신분증 "필요" 빨강 배지(error carve-out)는 그대로 유지된다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#FEE2E2',\s*color:\s*'#B91C1C',\s*border:\s*'1\.5px solid #FECACA'/);
  });

  test('healer 노랑은 미접촉(파랑/초록만 변경)', () => {
    expect(resv).toMatch(/healer:\s*'border-l-4 border-l-yellow-400 border-yellow-200\/80 bg-yellow-50'/);
  });
});

test.describe('WARMPASTEL-DESATURATE — 컴파일 CSS 가드(빌드 산출물 JIT)', () => {
  test('빌드 CSS 에 새 desat hex(rgb)가 반영된다', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
    if (cssFiles.length === 0) test.skip(true, 'compiled css 미발견');
    const compiled = cssFiles.map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');
    // Tailwind 는 hex 를 rgb(R G B) 로 컴파일.
    //   firstvisit-700 #546838→84 104 56 / firstvisit-100 #DCE9CC→220 233 204
    //   blue-700 #2E56C7→46 86 199 / sky-700 #116593→17 101 147
    const hit =
      /84 104 56/.test(compiled) ||
      /220 233 204/.test(compiled) ||
      /46 86 199/.test(compiled) ||
      /17 101 147/.test(compiled);
    expect(hit).toBe(true);
  });
});
