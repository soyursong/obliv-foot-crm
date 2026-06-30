import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-20260615-foot-MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN (김주연 총괄, planner MSG-20260615-113155)
 *
 * 형제 티켓 T-20260615-foot-THEME-MONO-REFINE-3AREA 와 동일 3건 스코프(스크린샷 동봉 재발행).
 * 부모 T-20260614-foot-THEME-MONOCHROME-RECOLOR(라이브) 후속 — 전역 토큰 재교체 아님, 국소 정제.
 *
 *  item1 [통합시간표] — 초진 노랑 / 재진 초록 의미색 배경 제거 → 모노톤(텍스트+보더 구분).
 *  item2 [2번 차트(CustomerChartPage)] — 장식성 다색(blue/indigo/sky/violet/purple/cyan/pink/
 *        fuchsia) → slate 모노톤. red(경고)·green/emerald(완료/재진)·amber/yellow(타이머)·teal(부모 warm-mono)
 *        는 의미색 carve-out 보존.
 *  item3 [직원 근무 캘린더 치료사 필터칩] — 선택 상태 칩이 bg-teal-600(→ tailwind teal→warm-brown 램프
 *        리맵으로 brown 렌더)으로 누수 → 치료사만 green 원복(출근자 치료사 배지 green 톤 일치).
 *        타 role 칩(상담실장 등) 불변(bg-teal-600 유지).
 *        ⚠ 기존 3AREA spec AC3 은 partBadgeClass(미선택) 리터럴만 검증 → 리포터가 본 brown(선택 칩)은
 *          미커버였음. 본 spec 이 선택-상태 green 분기를 가드한다.
 *
 * auth 불요(unit 프로젝트). 정적 소스 가드.
 */

const ROOT = process.cwd();
const dashboard = readFileSync(join(ROOT, 'src', 'pages', 'Dashboard.tsx'), 'utf8');
const handover = readFileSync(join(ROOT, 'src', 'lib', 'handover.ts'), 'utf8');
const handoverPage = readFileSync(join(ROOT, 'src', 'pages', 'Handover.tsx'), 'utf8');
const chart = readFileSync(join(ROOT, 'src', 'pages', 'CustomerChartPage.tsx'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

// ── 통합시간표 전용 슬롯 카드 구간만 슬라이스 (칸반·기타 영역 오탐 방지) ──
//   T-20260625-foot-COLOR-CONVENTION-UNIFY: 앵커 코멘트 텍스트가 A안 적용으로 갱신됨 → 슬라이스 시작 마커 동기화.
function sliceTimeline(src: string): string {
  const start = src.indexOf('// 통합시간표 체크인 카드 방문유형 구분');
  const end = src.indexOf('{/* ── AC-7: 아코디언 패널');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('MONOTONE-TIMETABLE-CHART2-THERAPISTGREEN — 정적 소스 가드 (auth 불요)', () => {
  // ⚠ SUPERSEDED 2026-06-29 by T-20260625-foot-COLOR-CONVENTION-UNIFY-CANDIDATES (총괄 김주연 final, A안 확정).
  //   통합시간표 무채색(MONO) 결정 → A안 컬러(초진=파랑/재진=초록)로 총괄 본인 override.
  //   item1 은 무채색 단언 → A안 컬러 단언으로 전환(forward guard). item2/item3 은 본 supersede와 무관(유지).
  test('item1 [SUPERSEDED→A안]: 통합시간표 슬롯 카드/헤더가 A안 컬러(초진=blue / 재진=firstvisit)로 복귀했다', () => {
    const seg = sliceTimeline(dashboard);
    expect(seg, '통합시간표 초진 A안 파랑(blue) 미적용').toMatch(/bg-blue-50\b/);
    expect(seg, '통합시간표 재진 A안 초록(firstvisit) 미적용').toMatch(/bg-firstvisit-50\b/);
    expect(seg, '체크인 카드 재진이 구 무채색(gray-50)으로 회귀')
      .not.toContain("'border-gray-300 bg-gray-50 hover:bg-gray-100'");
  });

  // ⚠ SUPERSEDED(부분) 2026-06-29 by T-20260629-foot-CHART2-IDVERIFY-PASTEL-SHRINK (김주연 총괄, closed·배포).
  //   동일 reporter(총괄)가 신분확인(RRN) 배지를 의도적으로 파스텔핑크화 → 해당 배지 리터럴만 carve-out 예외.
  //   그 외 의도치 않은 장식다색(타 pink 포함) 회귀는 계속 차단.
  test('item2: 2번 차트(CustomerChartPage) 장식성 다색 → slate 모노톤 (carve-out 외 잔존 0)', () => {
    // 장식성 무지개색(blue/indigo/sky/violet/purple/fuchsia/cyan) 잔존 0 — 잔존 시 실패
    expect(chart).not.toMatch(/\b(bg|text|border)-blue-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-indigo-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-sky-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-violet-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-purple-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-fuchsia-\d/);
    expect(chart).not.toMatch(/\b(bg|text|border)-cyan-\d/);
    // pink 은 신분확인(RRN) 배지 파스텔핑크 carve-out 외 잔존 0 — 그 외 pink 잔존 시 실패
    const ID_VERIFY_PINK_CARVEOUT = ['bg-pink-100', 'text-pink-400', 'border-pink-200', 'bg-pink-300'];
    const pinkLeaks = (chart.match(/\b(?:bg|text|border)-pink-\d{2,3}/g) ?? []).filter(
      (m) => !ID_VERIFY_PINK_CARVEOUT.includes(m),
    );
    expect(pinkLeaks, `신분확인 파스텔핑크 carve-out 외 pink 잔존: ${pinkLeaks.join(', ')}`).toEqual([]);
    // 모노톤 대체(slate) 실제 적용 증거
    expect(chart).toMatch(/bg-slate-/);
  });

  test('item3(핵심): 치료사 필터 칩 선택 상태가 green 으로 원복됐다 (brown 누수 정정)', () => {
    // 선택 칩에 치료사 전용 green 분기가 있다 — 타 role 은 bg-teal-600 유지
    expect(handoverPage).toMatch(
      /p\.code === 'therapist' \? 'bg-green-600 text-white' : 'bg-teal-600 text-white'/,
    );
    // 무분기 bg-teal-600(전 role 동일 brown) 잔존 0 — 잔존 시 brown 누수 재발
    expect(handoverPage).not.toMatch(/partFilter === p\.code \? 'bg-teal-600 text-white'/);
    expect(handoverPage).not.toMatch(/formPart === p\.code \? 'bg-teal-600 text-white'/);
  });

  // ⚠ SUPERSEDED 2026-06-30 by T-20260630-foot-HANDOVER-BOX-COMPACT-MONO (11:09 PUSH AC2,
  //   김주연 총괄 자기-override): handover 박스 배경 + 파트 배지(PART_BADGE_CLASS/PART_BOX_CLASS)를
  //   전 파트 무채색(slate)으로 통일. therapist green carve-out(handover 배지/박스 한정)이 제거됨.
  //   → 미선택 배지 색 단언을 무채색 단언으로 전환(forward guard). 색 누수 재발 시 실패.
  //   단 선택 칩(item3 핵심 test)·출근자 칩(status.ts green)·통합시간표 색은 범위 밖·불변.
  test('item3(미선택 배지)[SUPERSEDED→MONO]: handover 파트 배지/박스가 무채색(slate) 통일', () => {
    // 배지·박스 모두 무채색 단일 클래스
    expect(handover).toMatch(/PART_BADGE_MONO_CLASS = 'bg-slate-200 text-slate-700'/);
    expect(handover).toMatch(/PART_BOX_MONO_CLASS = 'bg-slate-50 border-slate-200'/);
    // handover 파트 배지/박스에서 파트색(green/rose/amber/teal) 리터럴 누수 0
    expect(handover).not.toMatch(/therapist:\s*'bg-(green|teal)-/);
    expect(handover).not.toMatch(/consultant_lead:\s*'bg-rose-/);
    expect(handover).not.toMatch(/coordinator:\s*'bg-amber-/);
  });

  // shade forward 2026-06-29 by T-20260629-foot-HANDOVER-COMPACT-PASTEL (deployed b4deac63):
  //   출근자 치료사 칩 톤 경량화 green-100/800/300 → green-50/700/200. green 의미색 보존은 불변.
  test('item3(carve-out): 출근자 칩 therapist 의미색(green)은 status.ts 보존(범위 밖)', () => {
    // 출근자 치료사 배지 green 보존 — handover 파트 배지 무채색화와 무관(별 helper)
    expect(status).toMatch(/therapist:\s*'bg-green-50 text-green-700 border-green-200'/);
  });
});
