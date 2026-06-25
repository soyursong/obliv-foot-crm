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

test.describe('WARMPASTEL-DESATURATE A안 — firstvisit(초록) 램프 = A안 ⑨ 따듯 파스텔 A', () => {
  test('firstvisit 램프가 A안 ⑨ 초록 값으로 확정됐다', () => {
    expect(tw).toMatch(/\bfirstvisit:\s*\{/);
    expect(tw).toMatch(/50:\s*"#EDF1E4"/i);  // 초진 카드 bg = A안 ⑨
    expect(tw).toMatch(/100:\s*"#E7EEDA"/i); // 배지/칩 bg = A안 ⑨
    expect(tw).toMatch(/200:\s*"#D7E0C4"/i); // 보더 = A안 ⑨
    expect(tw).toMatch(/400:\s*"#AFC38C"/i); // 좌측바 = A안 ⑨
    expect(tw).toMatch(/500:\s*"#A0B57E"/i); // dot = A안 ⑨
    expect(tw).toMatch(/700:\s*"#566A3D"/i); // 텍스트(AA) = A안 ⑨
  });

  test('구 7f45fda2 firstvisit 값(#DCE9CC 등)이 토큰 슬롯에서 제거됐다(주석 이력 언급은 무관)', () => {
    expect(tw).not.toMatch(/:\s*"#DCE9CC"/i);
    expect(tw).not.toMatch(/:\s*"#819C59"/i);
    expect(tw).not.toMatch(/:\s*"#546838"/i);
    expect(tw).not.toMatch(/:\s*"#DCEDC8"/i); // 그 이전 맑은 파스텔도 부재 확인
  });

  test('2번차트 신분증 확인완료 배지 인라인 hex가 A안 firstvisit 값으로 동기화됐다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#E7EEDA',\s*color:\s*'#566A3D',\s*border:\s*'1\.5px solid #D7E0C4'/);
    expect(chart).toMatch(/rounded-full bg-firstvisit-500 inline-block/);
  });
});

test.describe('WARMPASTEL-DESATURATE A안 — blue(재진·info)·sky(의사 대시보드) = A안 ⑨ 파랑', () => {
  test('tailwind blue 램프가 A안 ⑨ 파랑 값으로 확정됐다', () => {
    expect(tw).toMatch(/\bblue:\s*\{/);
    expect(tw).toMatch(/50:\s*"#EBEFF5"/i);
    expect(tw).toMatch(/100:\s*"#E4EAF3"/i);
    expect(tw).toMatch(/200:\s*"#D2DBEA"/i);
    expect(tw).toMatch(/500:\s*"#90A2C2"/i);
    expect(tw).toMatch(/700:\s*"#45587A"/i);
  });

  test('tailwind sky 램프가 A안 파랑(blue와 동일 톤)으로 통일됐다', () => {
    expect(tw).toMatch(/\bsky:\s*\{/);
    expect(tw).toMatch(/50:\s*"#EBEFF5"/i);
    expect(tw).toMatch(/200:\s*"#D2DBEA"/i);
    expect(tw).toMatch(/700:\s*"#45587A"/i);
  });

  test('구 7f45fda2 blue/sky 값(#F0F6FE·#2E56C7·#116593 등)이 제거됐다(A안 확정)', () => {
    expect(tw).not.toMatch(/:\s*"#F0F6FE"/i);
    expect(tw).not.toMatch(/:\s*"#2E56C7"/i);
    expect(tw).not.toMatch(/:\s*"#116593"/i);
    expect(tw).not.toMatch(/:\s*"#1d4ed8"/i); // Tailwind 기본 blue-700도 부재
  });
});

test.describe('WARMPASTEL-DESATURATE A안 — 힐러 노랑 #FFFDE7 전용 토큰(AC6 carve-out)', () => {
  test('healer 토큰이 A안 #FFFDE7 family 로 정의됐다', () => {
    expect(tw).toMatch(/\bhealer:\s*\{/);
    expect(tw).toMatch(/50:\s*"#FFFDE7"/i);  // bg = A안 (맑은 파스텔)
    expect(tw).toMatch(/200:\s*"#FFF59D"/i); // 보더 = A안
    expect(tw).toMatch(/400:\s*"#FFEE58"/i); // 좌측바 = A안
    expect(tw).toMatch(/500:\s*"#FBC02D"/i); // dot(골드) = A안
    expect(tw).toMatch(/700:\s*"#B7791F"/i); // 텍스트 = A안
  });

  test('예약 healer 카드/dot 이 전역 yellow(의미색) 대신 healer 전용 토큰을 쓴다', () => {
    expect(resv).toMatch(/healer:\s*'border-l-4 border-l-healer-400 border-healer-200\/80 bg-healer-50'/);
    expect(resv).toMatch(/healer:\s*'bg-healer-500'/);
    // 힐러 카드/ dot 이 더 이상 raw yellow 토큰을 직접 참조하지 않는다
    expect(resv).not.toMatch(/healer:\s*'border-l-4 border-l-yellow-400 border-yellow-200\/80 bg-yellow-50'/);
    expect(resv).not.toMatch(/healer:\s*'bg-yellow-400'/);
  });
});

test.describe('WARMPASTEL-DESATURATE A안 — 역할 매핑·carve-out 불변(미접촉)', () => {
  test('초진=firstvisit(초록)·재진=blue(파랑) 예약카드 매핑 구조가 유지된다(톤만 변경 / AC7 flip 미적용)', () => {
    expect(resv).toMatch(/new:\s*'border-l-4 border-l-firstvisit-400 border-firstvisit-200\/80 bg-firstvisit-50'/);
    expect(resv).toMatch(/returning:\s*'border-l-4 border-l-blue-400 border-blue-200\/80 bg-blue-50'/);
  });

  test('status.ts 칸반 teal pin(의미색)은 미접촉 — 본 톤 변경에 비종속', () => {
    expect(status).toMatch(/#ccfbf1|#115e59|#2dd4bf/i);
  });

  test('신분증 "필요" 빨강 배지(error carve-out)는 그대로 유지된다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#FEE2E2',\s*color:\s*'#B91C1C',\s*border:\s*'1\.5px solid #FECACA'/);
  });
});

test.describe('WARMPASTEL-DESATURATE A안 — 컴파일 CSS 가드(빌드 산출물 JIT)', () => {
  test('빌드 CSS 에 A안 hex(rgb)가 반영된다 (firstvisit/blue/healer)', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
    if (cssFiles.length === 0) test.skip(true, 'compiled css 미발견');
    const compiled = cssFiles.map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');
    // Tailwind 는 hex 를 rgb(R G B) 로 컴파일.
    //   firstvisit-700 #566A3D→86 106 61 / blue-700 #45587A→69 88 122 / healer-50 #FFFDE7→255 253 231
    const hit =
      /86 106 61/.test(compiled) ||
      /69 88 122/.test(compiled) ||
      /255 253 231/.test(compiled) ||
      /251 192 45/.test(compiled); // healer-500 #FBC02D
    expect(hit).toBe(true);
  });
});
