import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-20260623-foot-GREEN-PASTEL-RETUNE (김주연 총괄 — preview pick ③ 따뜻한 파스텔 그린)
 *
 * T-0622 sage(#C2CDB0)가 "별로" → 더 은은·세련된 파스텔로 재튜닝. dev-foot preview 3종 → 총괄 pick ③.
 *  - 픽 앵커 #DCEDC8 = sage-100 (배지/칩 bg = 픽 색 그대로). 동일 토큰 1곳 교체로 sage 적용 전 지점 일괄 전환.
 *  - WCAG AA(파스텔이라 글자 진하게): text=sage-700(#556E32) on white 5.73:1 / on sage-100 4.64:1 / on sage-50 5.18:1.
 *  - 추가 스코프(총괄 "1번차트 녹색 전수 체크"): 1번차트(CheckInDetailSheet) 잔존 녹색(재진 emerald + 진료차트 버튼 emerald) → sage. 고객차트=teal 유지로 두 버튼 구분 보존.
 *  - carve-out 불변: 빨강(신분증 필요)·status.ts 칸반 의미색·before/after(시술후 emerald, 의미구분)·고객차트 버튼(teal 브랜드)·수납패널(teal 브랜드) 미접촉.
 *
 * 본 spec 은 auth 불요(정적 소스 가드 + 컴파일 CSS 가드). 단일 토큰(tailwind 'sage') 재튜닝 검증.
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const chart = readFileSync(join(ROOT, 'src', 'pages', 'CustomerChartPage.tsx'), 'utf8');
const checkin = readFileSync(join(ROOT, 'src', 'components', 'CheckInDetailSheet.tsx'), 'utf8');

test.describe('GREEN-PASTEL-RETUNE — tailwind sage 토큰 파스텔 재튜닝(단일 SSOT)', () => {
  test('sage 스케일이 ③ 파스텔 그린(앵커 #DCEDC8=sage-100)으로 재튜닝됐다', () => {
    expect(tw).toMatch(/\bsage:\s*\{/);
    expect(tw).toMatch(/50:\s*"#EFF6E4"/i);   // 초진 카드 bg
    expect(tw).toMatch(/100:\s*"#DCEDC8"/i);  // 배지/칩 bg = 총괄 pick ③ 앵커
    expect(tw).toMatch(/200:\s*"#C8DDA9"/i);  // 보더
    expect(tw).toMatch(/500:\s*"#83A451"/i);  // dot
    expect(tw).toMatch(/700:\s*"#556E32"/i);  // 텍스트(AA)
    expect(tw).toMatch(/800:\s*"#43562A"/i);  // 강조 텍스트
  });

  test('구 sage(#C2CDB0 계열) 값이 토큰 슬롯에서 제거됐다(잔존 0, 주석 내 이력 언급은 허용)', () => {
    expect(tw).not.toMatch(/:\s*"#C2CDB0"/i);
    expect(tw).not.toMatch(/:\s*"#E7EDD9"/i);
    expect(tw).not.toMatch(/:\s*"#52603C"/i);
    expect(tw).not.toMatch(/:\s*"#8A9B6A"/i);
  });
});

test.describe('GREEN-PASTEL-RETUNE — 2번차트 신분증 확인완료 배지 인라인 hex 동기화', () => {
  test('확인 완료 배지 인라인 hex가 새 sage(#DCEDC8/#556E32/#C8DDA9)로 교체됐다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#DCEDC8',\s*color:\s*'#556E32',\s*border:\s*'1\.5px solid #C8DDA9'/);
    expect(chart).toMatch(/rounded-full bg-sage-500 inline-block/);
    // 구 sage 인라인 hex 제거
    expect(chart).not.toMatch(/#E7EDD9/i);
    expect(chart).not.toMatch(/#52603C/i);
    expect(chart).not.toMatch(/#D3DEBE/i);
  });

  test('신분증 "필요" 빨강 배지는 그대로 유지된다(carve-out 미치환)', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#FEE2E2',\s*color:\s*'#B91C1C',\s*border:\s*'1\.5px solid #FECACA'/);
  });
});

test.describe('GREEN-PASTEL-RETUNE — 추가 스코프: 1번차트(CheckInDetailSheet) 잔존 녹색', () => {
  test('재진 배지(2곳) emerald → sage (2번차트 재진=sage 정합)', () => {
    const sageJaejin = (checkin.match(/bg-sage-100 text-sage-700">재진|bg-sage-100 text-sage-700 shrink-0">/g) ?? []).length;
    // 인라인(작은 칩) + SheetTitle(성함 옆) 2곳
    expect(checkin).toMatch(/bg-sage-100 text-sage-700">재진/);
    expect(checkin).toMatch(/bg-sage-100 text-sage-700 shrink-0">/);
    // 구 재진 emerald 칩 제거
    expect(checkin).not.toMatch(/bg-emerald-100 text-emerald-700">재진/);
    expect(checkin).not.toMatch(/bg-emerald-100 text-emerald-700 shrink-0">\s*\n\s*재진/);
  });

  test('초진 배지는 파랑 유지(의미구분 carve-out)', () => {
    expect(checkin).toMatch(/bg-blue-100 text-blue-700/);
  });

  test('before/after(시술후 emerald)는 미접촉 — 2번차트와 정합(무차별 교체 금지)', () => {
    expect(checkin).toMatch(/after:\s*'bg-emerald-100 text-emerald-700'/);
  });

  test('진료차트 버튼 잔존 녹색 emerald → sage (총괄 1번차트 녹색 전수 체크)', () => {
    // 진료차트 버튼이 sage 파스텔로 전환
    expect(checkin).toMatch(/border-sage-400 text-sage-700 hover:bg-sage-50/);
    // 구 emerald 버튼 스타일 제거
    expect(checkin).not.toMatch(/border-emerald-400 text-emerald-700 hover:bg-emerald-50/);
    // 고객차트 버튼은 teal 브랜드 유지(두 버튼 구분 보존)
    expect(checkin).toMatch(/border-teal-400 text-teal-700 hover:bg-teal-50/);
  });
});

test.describe('GREEN-PASTEL-RETUNE — 컴파일 CSS 가드(빌드 산출물 JIT)', () => {
  test('빌드 CSS 에 새 sage hex(rgb)가 반영된다', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
    if (cssFiles.length === 0) test.skip(true, 'compiled css 미발견');
    const compiled = cssFiles.map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');
    // Tailwind 는 hex 를 rgb(R G B) 로 컴파일: sage-100=#DCEDC8→220 237 200 / sage-500=#83A451→131 164 81 / sage-700=#556E32→85 110 50.
    const sageRgbHit =
      /220 237 200/.test(compiled) || /131 164 81/.test(compiled) || /85 110 50/.test(compiled);
    expect(sageRgbHit).toBe(true);
  });
});
