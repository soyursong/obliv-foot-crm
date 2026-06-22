import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-20260622-foot-GREEN-COLOR-SAGE-RECOLOR (김주연 총괄 — 스와치 #C2CDB0 + 스크린샷 3장)
 *
 * 풋센터 녹색(emerald/green) 의미색 → 세이지 톤 교체.
 *  - 기준 앵커 #C2CDB0(RGB 194,205,176) = sage-300. WCAG AA 가능 스케일 파생.
 *    text=sage-700(#52603C) on white 6.58:1 / on sage-100(#E7EDD9) 5.49:1 (AA 본문 ≥4.5 ✓).
 *  - 대상 A: CustomerChartPage 신분증 "확인 완료" 배지 — green-100/700/200/500 → 세이지.
 *            (신분증 "필요" 빨강 #FEE2E2/#B91C1C/#FECACA 는 그대로)
 *  - 대상 B: 예약관리 초진 녹색 — Reservations(KIND_CARD_STYLE/KIND_DOT/초카운트칩),
 *            ReservationDayTimeslotPanel 초진 dot, CustomerHoverCard 재진 칩.
 *  - 권장 C: checked_in(Reservations) / returning(ReservationDetailPopup) 녹색도 일관성 위해 sage.
 *            단 의미구분(초진 vs 재진)은 hue(blue) 유지로 보존.
 *  - 제외(무차별 교체 금지): 일반 success 아이콘(체크/토글/focus ring emerald)·치료사 info 패널.
 *
 * 본 spec 은 auth 불요(정적 소스 가드 + 컴파일 CSS 가드). 단일 토큰(tailwind 'sage') 채택 검증.
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const chart = readFileSync(join(ROOT, 'src', 'pages', 'CustomerChartPage.tsx'), 'utf8');
const resv = readFileSync(join(ROOT, 'src', 'pages', 'Reservations.tsx'), 'utf8');
const panel = readFileSync(join(ROOT, 'src', 'components', 'ReservationDayTimeslotPanel.tsx'), 'utf8');
const hover = readFileSync(join(ROOT, 'src', 'components', 'CustomerHoverCard.tsx'), 'utf8');
const popup = readFileSync(join(ROOT, 'src', 'components', 'ReservationDetailPopup.tsx'), 'utf8');

test.describe('GREEN-COLOR-SAGE-RECOLOR — tailwind 토큰 (단일 SSOT)', () => {
  test('sage 스케일이 단일 토큰으로 정의되고 앵커 #C2CDB0=sage-300 이다', () => {
    expect(tw).toMatch(/\bsage:\s*\{/);
    expect(tw).toMatch(/300:\s*"#C2CDB0"/i);   // 앵커(기준 스와치)
    expect(tw).toMatch(/100:\s*"#E7EDD9"/i);   // 배지 bg
    expect(tw).toMatch(/200:\s*"#D3DEBE"/i);   // 보더
    expect(tw).toMatch(/500:\s*"#8A9B6A"/i);   // dot
    expect(tw).toMatch(/700:\s*"#52603C"/i);   // 텍스트(AA)
    expect(tw).toMatch(/800:\s*"#3D472D"/i);   // 강조 텍스트
  });
});

test.describe('GREEN-COLOR-SAGE-RECOLOR — 대상 A: 신분증 확인 완료 배지', () => {
  test('확인 완료 배지가 세이지(#E7EDD9/#52603C/#D3DEBE/bg-sage-500)로 교체됐다', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#E7EDD9',\s*color:\s*'#52603C',\s*border:\s*'1\.5px solid #D3DEBE'/);
    expect(chart).toMatch(/rounded-full bg-sage-500 inline-block/);
    // 구 그린 하드코딩 제거(확인완료 배지 한정)
    expect(chart).not.toMatch(/backgroundColor:\s*'#DCFCE7'/);
    expect(chart).not.toMatch(/rounded-full bg-green-500 inline-block/);
  });

  test('신분증 "필요" 빨강 배지는 그대로 유지된다(미치환)', () => {
    expect(chart).toMatch(/backgroundColor:\s*'#FEE2E2',\s*color:\s*'#B91C1C',\s*border:\s*'1\.5px solid #FECACA'/);
    expect(chart).toMatch(/rounded-full bg-red-500 inline-block animate-pulse/);
  });
});

test.describe('GREEN-COLOR-SAGE-RECOLOR — 대상 B/C: 예약관리 녹색', () => {
  test('초진 카드/도트 emerald → sage (재진 파랑·힐러 노랑 유지)', () => {
    expect(resv).toMatch(/new:\s*'border-l-4 border-l-sage-400 border-sage-200\/80 bg-sage-50'/);
    expect(resv).toMatch(/new:\s*'bg-sage-500'/);
    // 재진 파랑·힐러 노랑은 비종속 보존(의미구분)
    expect(resv).toMatch(/returning:\s*'border-l-4 border-l-blue-400 border-blue-200\/80 bg-blue-50'/);
    expect(resv).toMatch(/healer:\s*'border-l-4 border-l-yellow-400 border-yellow-200\/80 bg-yellow-50'/);
    // 구 초진 emerald 카드/도트 제거
    expect(resv).not.toMatch(/new:\s*'border-l-4 border-l-emerald-400/);
    expect(resv).not.toMatch(/new:\s*'bg-emerald-500'/);
  });

  test('초진 카운트 칩(2곳) emerald → sage', () => {
    const sageChip = (resv.match(/bg-sage-100 px-[\d.]+ py-0\.5 text-sage-700">초/g) ?? []).length;
    expect(sageChip).toBe(2);
    expect(resv).not.toMatch(/bg-emerald-100 px-[\d.]+ py-0\.5 text-emerald-700">초/);
  });

  test('checked_in 상태 배지 emerald → sage', () => {
    expect(resv).toMatch(/checked_in:\s*'bg-sage-100 text-sage-700 border-sage-200'/);
    expect(resv).not.toMatch(/checked_in:\s*'bg-emerald-100 text-emerald-700 border-emerald-200'/);
  });

  test('ReservationDayTimeslotPanel 초진 dot emerald → sage', () => {
    expect(panel).toMatch(/dotClass="bg-sage-500" label="초진"/);
    expect(panel).not.toMatch(/dotClass="bg-emerald-500" label="초진"/);
    // 재진 파랑·힐러 노랑 유지
    expect(panel).toMatch(/dotClass="bg-blue-500" label="재진"/);
    expect(panel).toMatch(/dotClass="bg-yellow-400" label="힐러"/);
  });

  test('CustomerHoverCard 재진 칩 emerald → sage (초진 파랑 유지)', () => {
    expect(hover).toMatch(/'bg-blue-100 text-blue-800' : 'bg-sage-100 text-sage-800'/);
    expect(hover).not.toMatch(/'bg-emerald-100 text-emerald-800'/);
  });

  test('ReservationDetailPopup 재진 배지 emerald → sage (초진 파랑·체험 amber 유지)', () => {
    expect(popup).toMatch(/returning:\s*'bg-sage-100 text-sage-700'/);
    expect(popup).toMatch(/new:\s*'bg-blue-100 text-blue-700'/);
    expect(popup).toMatch(/experience:\s*'bg-amber-100 text-amber-700'/);
    expect(popup).not.toMatch(/returning:\s*'bg-emerald-100 text-emerald-700'/);
  });
});

test.describe('GREEN-COLOR-SAGE-RECOLOR — 제외 영역 비침범', () => {
  test('일반 success 아이콘(청진기 등 text-emerald-500)은 보존된다(무차별 교체 금지)', () => {
    // CustomerHoverCard 치료메모 청진기 아이콘 = 장식 emerald → 미치환
    expect(hover).toMatch(/text-emerald-500/);
  });
});

test.describe('GREEN-COLOR-SAGE-RECOLOR — 컴파일 CSS 가드 (빌드 산출물)', () => {
  test('빌드 CSS 에 sage hex(앵커·bg·text)가 반영된다(JIT 생성 확인)', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    // 페이지별 청크에 흩어지므로 전체 css 결합 스캔
    const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
    if (cssFiles.length === 0) test.skip(true, 'compiled css 미발견');
    const compiled = cssFiles.map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');

    // Tailwind 는 opacity 지원 위해 hex 를 rgb(R G B) 로 컴파일한다.
    //   sage-100=#E7EDD9→231 237 217 / sage-500=#8A9B6A→138 155 106 / sage-700=#52603C→82 96 60.
    //   1개 이상 JIT 으로 생성됐다 = sage 클래스 실사용 증거.
    const sageRgbHit =
      /231 237 217/.test(compiled) || /138 155 106/.test(compiled) || /82 96 60/.test(compiled);
    expect(sageRgbHit).toBe(true);
  });
});
