import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260625-foot-COLOR-CONVENTION-UNIFY-CANDIDATES — A안 색상 컨벤션 전 화면 전면 적용
 * 원천: 김주연 총괄(C0ATE5P6JTH, thread 1782203281.046699). 6/25 A안 확정 + 6/27 + 6/29 3차 재확인.
 *
 * 확정 A안(초진=파랑 / 재진=초록 / 힐러=노랑) semantic 토큰을 4개 surface 전면 적용:
 *   초진 → blue 토큰   (#EBEFF5 램프)
 *   재진 → firstvisit 토큰 (#EDF1E4 램프, A안 초록)
 *   힐러 → healer 토큰  (#FFFDE7 램프, A안 노랑)
 *
 * 작업 성격: FE-only audit+apply. 신규색 0 / DB 0 / 비즈로직 0 (旣정의 tailwind 토큰 재사용).
 *   예약관리만 잔존하던 구 T-20260611 현장반전(초진초록/재진파랑) → A안으로 복귀해 타 surface와 통일.
 *
 * 거대-인라인 established 컴포넌트(Reservations.tsx/Dashboard.tsx 등) 관례 = 소스 정적 단언으로 가드.
 *   실 브라우저 색상 렌더(초/재/힐러 카드·배지)는 supervisor field-soak(갤탭 실기기)로 최종 확정.
 *
 * 총괄 final 추가 scope(MSG-20260629-172036): 대시보드 통합시간표 슬롯 카드도 A안 컬러 적용
 *   (T-20260615 MONOTONE-TIMETABLE / THEME-MONO-REFINE-3AREA 무채색 SUPERSEDED).
 *   '재진 N' 배지는 제거 아니라 #EDF1E4(firstvisit) 적용. → 시나리오5.
 *
 * carve-out(미접촉): status.ts 칸반 teal / error 빨강 / success / Badge variant 의미색 / 재진 emerald 의미색(status.ts SSOT).
 *
 * §11 의료게이트: surface #3 의사 콜 화면(DoctorCallListBar / DoctorCallDashboard)은 §11 진료대시보드/진료관리
 *   게이트 불확실 + 이미 컨벤션 준수(초진 blue / 재진 emerald(carve-out, green-family) / sky=A안 blue 토큰)라
 *   코드 미접촉. 본 spec은 해당 surface의 '이미 정합' 상태만 회귀-가드한다(토큰 정밀교체는 게이트 확인 후 별건).
 */

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');

const RESV = read('src/pages/Reservations.tsx');
const DAYPANEL = read('src/components/ReservationDayTimeslotPanel.tsx');
const DASH = read('src/pages/Dashboard.tsx');
const STATUS = read('src/lib/status.ts');
const TW = read('tailwind.config.js');
const RESVPOPUP = read('src/components/ReservationDetailPopup.tsx');
const CHECKIN = read('src/components/CheckInDetailSheet.tsx');
const HOVER = read('src/components/CustomerHoverCard.tsx');
const CHART = read('src/pages/CustomerChartPage.tsx');
const DOCDASH = read('src/components/doctor/DoctorCallDashboard.tsx');

// ═══════════════════════════════════════════════════════════════════════════
// 토큰 SSOT — A안 토큰 값이 tailwind.config.js에 旣정의(신규색 0의 근거)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('A안 토큰 SSOT (tailwind.config.js 旣정의 — 신규색 0)', () => {
  test('TOKEN-1: 초진 파랑 = blue.50 #EBEFF5', () => {
    expect(TW, 'blue.50 A안 파랑(#EBEFF5) 토큰 누락/변경').toContain('"#EBEFF5"');
  });
  test('TOKEN-2: 재진 초록 = firstvisit.50 #EDF1E4', () => {
    expect(TW, 'firstvisit.50 A안 초록(#EDF1E4) 토큰 누락/변경').toContain('"#EDF1E4"');
  });
  test('TOKEN-3: 힐러 노랑 = healer.50 #FFFDE7', () => {
    expect(TW, 'healer.50 A안 노랑(#FFFDE7) 토큰 누락/변경').toContain('"#FFFDE7"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 예약관리 일간 + 주간 (카드·dot·칩)
//   초진=파랑(blue) / 재진=초록(firstvisit) / 힐러=노랑(healer), 일간↔주간 일관
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 예약관리 일간/주간 A안 3색', () => {
  test('S1-1: 카드 배경(KIND_CARD_STYLE) — 초진=blue / 재진=firstvisit / 힐러=healer', () => {
    expect(RESV, '초진 카드 배경이 A안 파랑(blue-50)이 아님')
      .toContain("new: 'border-l-4 border-l-blue-400 border-blue-200/80 bg-blue-50'");
    expect(RESV, '재진 카드 배경이 A안 초록(firstvisit-50)이 아님')
      .toContain("returning: 'border-l-4 border-l-firstvisit-400 border-firstvisit-200/80 bg-firstvisit-50'");
    expect(RESV, '힐러 카드 배경이 A안 노랑(healer-50)이 아님')
      .toContain("healer: 'border-l-4 border-l-healer-400 border-healer-200/80 bg-healer-50'");
  });

  test('S1-2: 카운트 dot(KIND_DOT) — 초진=blue-500 / 재진=firstvisit-500 / 힐러=healer-500', () => {
    expect(RESV, '초진 dot이 blue-500이 아님').toContain("new: 'bg-blue-500'");
    expect(RESV, '재진 dot이 firstvisit-500이 아님').toContain("returning: 'bg-firstvisit-500'");
    expect(RESV, '힐러 dot이 healer-500이 아님').toContain("healer: 'bg-healer-500'");
  });

  test('S1-3: 일간/주간 칸 칩 — 초=blue / 재=firstvisit / 힐=healer (raw yellow 잔존 0)', () => {
    // T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR(commit 578974c4) SUPERSEDE:
    //   구 3곳 `>초 /재 /HL ` full-칩 마크업이 세로축 4분류 축약표기(KIND_AXIS_LABELS.abbr: 초/재/힐/리)로 교체됨.
    //   per-cell 카운트 블록만 `bg-*-100 ... >초/재/HL ` full-칩 1쌍 잔존, 일간·주간 헤더는 abbr(text-*-700) 렌더.
    //   → A안 3색 토큰(blue/firstvisit/healer) 정합은 전 위치에서 불변. 개수 3 하드값만 stale.
    // per-cell full-칩: 초=blue / 재=firstvisit / 힐=healer 각 1쌍.
    expect((RESV.match(/bg-blue-100[^"]*text-blue-700">초 /g) || []).length,
      '초 per-cell 칩 blue 미적용').toBeGreaterThanOrEqual(1);
    expect((RESV.match(/bg-firstvisit-100[^"]*text-firstvisit-700">재 /g) || []).length,
      '재 per-cell 칩 firstvisit 미적용').toBeGreaterThanOrEqual(1);
    expect((RESV.match(/bg-healer-100[^"]*text-healer-700">HL /g) || []).length,
      'HL per-cell 칩 healer 토큰 미적용').toBeGreaterThanOrEqual(1);
    // 일간/주간 세로축 abbr 표기: 초=blue-700 / 재=firstvisit-700 / 힐=healer-700 (KIND_AXIS_LABELS.abbr).
    expect((RESV.match(/text-blue-700">\{KIND_AXIS_LABELS\.new\.abbr\}/g) || []).length,
      '초진 abbr blue 토큰 미적용(일간/주간)').toBeGreaterThanOrEqual(2);
    expect((RESV.match(/text-firstvisit-700">\{KIND_AXIS_LABELS\.returning\.abbr\}/g) || []).length,
      '재진 abbr firstvisit 토큰 미적용(일간/주간)').toBeGreaterThanOrEqual(2);
    expect((RESV.match(/text-healer-700">\{KIND_AXIS_LABELS\.healer\.abbr\}/g) || []).length,
      '힐러 abbr healer 토큰 미적용(일간/주간)').toBeGreaterThanOrEqual(2);
    // 힐러에 구 raw yellow 잔존 금지 (full-칩·abbr 공통).
    expect(RESV, 'HL 칩에 구 raw yellow 잔존').not.toContain('text-yellow-700">HL ');
    expect(RESV, '힐러 abbr에 구 raw yellow 잔존').not.toMatch(/text-yellow-700">\{KIND_AXIS_LABELS\.healer\.abbr\}/);
  });

  test('S1-4: 반전 잔재 0 — 초진에 firstvisit(green)·재진에 blue 카드배경 잔존 금지', () => {
    expect(RESV, '초진 카드에 구 firstvisit(green) 잔존(반전 미복구)')
      .not.toContain("new: 'border-l-4 border-l-firstvisit-400 border-firstvisit-200/80 bg-firstvisit-50'");
    expect(RESV, '재진 카드에 구 blue 잔존(반전 미복구)')
      .not.toContain("returning: 'border-l-4 border-l-blue-400 border-blue-200/80 bg-blue-50'");
  });

  test('S1-5: 일간 타임슬롯 패널 KindChip — 초진=blue-500 / 재진=firstvisit-500 / 힐러=healer-500', () => {
    expect(DAYPANEL, '타임슬롯 초진 dot이 A안 파랑(blue-500)이 아님')
      .toContain('dotClass="bg-blue-500" label="초진"');
    expect(DAYPANEL, '타임슬롯 재진 dot이 A안 초록(firstvisit-500)이 아님')
      .toContain('dotClass="bg-firstvisit-500" label="재진"');
    expect(DAYPANEL, '타임슬롯 힐러 dot이 healer-500이 아님')
      .toContain('dotClass="bg-healer-500" label="힐러"');
    expect(DAYPANEL, '타임슬롯 초진에 구 sage(그레이) 잔존')
      .not.toContain('dotClass="bg-sage-500" label="초진"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 대시보드 배지 + 2번차트 신분증 칩
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 대시보드 배지 + 신분증 칩', () => {
  test('S2-1: 대시보드 초진 배지 = A안 파랑(blue), 구 yellow 하드코드 잔존 0', () => {
    expect((DASH.match(/bg-blue-100 text-blue-800[^>]*>초진</g) || []).length,
      '대시보드 초진 배지 blue 미통일').toBeGreaterThanOrEqual(2);
    expect(DASH, '대시보드 초진 배지에 구 yellow 하드코드 잔존')
      .not.toContain('bg-yellow-100 text-yellow-800 text-[9px] px-0.5 py-px rounded font-medium">초진');
  });

  test('S2-2: 신분증 확인완료 칩(2번차트) = firstvisit dot (success 상태, carve-out 정합 유지)', () => {
    // success 상태 앵커 = firstvisit dot (carve-out 정합, 불변).
    expect(CHART, '신분증 확인완료 dot이 firstvisit(green success)에서 변경됨')
      .toContain('bg-firstvisit-500');
    // T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY(commit 9609a7a8) SUPERSEDE:
    //   확인완료 배지 full-background 파스텔그린(#E7EEDA)을 제거하고 무채색 glass/silver(#C7CDD4 border)로 재정의.
    //   A안 초록(firstvisit) 의미색은 왼쪽 dot(bg-firstvisit-500)에만 계승 → carve-out 정합 유지. #E7EEDA 앵커는 stale.
    expect(CHART, 'IDVERIFY-DOT-ONLY 후 배지 배경이 무채색 glass/silver(#C7CDD4)가 아님')
      .toContain('#C7CDD4');
    expect(CHART, 'IDVERIFY-DOT-ONLY 후 구 파스텔그린 배경(#E7EEDA)이 잔존')
      .not.toContain('#E7EEDA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 의사 콜 화면(§11 게이트 hold, 이미 정합) + 고객 정보 팝업
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 의사 콜 화면(정합 가드) + 고객정보 팝업', () => {
  test('S3-1: sky 램프 = A안 파랑(#EBEFF5)로 통일 — 의사 대시보드 sky 자동 A안화', () => {
    // sky 토큰 자체가 blue와 동일 A안 파랑(#EBEFF5)이므로 sky-* 사용처는 토큰 레벨에서 자동 A안.
    const skyBlock = TW.slice(TW.indexOf('sky: {'));
    expect(skyBlock.slice(0, 40), 'sky.50 A안 파랑(#EBEFF5) 미통일').toContain('"#EBEFF5"');
  });

  test('S3-2: DoctorCallDashboard VisitBadge — 초진=blue(A안) / 재진=emerald(carve-out, green-family)', () => {
    expect(DOCDASH, '의사콜 초진 배지가 blue(A안)이 아님')
      .toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    // 재진 emerald = carve-out(변경 금지). green-family라 A안 재진=초록 컨벤션 충족.
    expect(DOCDASH, '재진 emerald carve-out이 변경됨(변경 금지 위반)')
      .toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
  });

  test('S3-3: 고객정보 팝업 재진 = A안 초록(firstvisit), 구 sage(그레이) 잔존 0', () => {
    expect(RESVPOPUP, 'ReservationDetailPopup 재진이 A안 초록(firstvisit)이 아님')
      .toContain("returning: 'bg-firstvisit-100 text-firstvisit-700'");
    expect(RESVPOPUP, 'ReservationDetailPopup 재진에 구 sage 잔존')
      .not.toContain("returning: 'bg-sage-100 text-sage-700'");

    expect((CHECKIN.match(/bg-firstvisit-100 text-firstvisit-700[^>]*>재진/g) || []).length,
      'CheckInDetailSheet 재진 firstvisit 2곳 미적용').toBeGreaterThanOrEqual(1);
    expect(CHECKIN, 'CheckInDetailSheet 재진에 구 sage 잔존')
      .not.toContain('bg-sage-100 text-sage-700">재진');

    expect(HOVER, 'CustomerHoverCard 재진이 A안 초록(firstvisit)이 아님')
      .toContain("'bg-firstvisit-100 text-firstvisit-800'");
    expect(HOVER, 'CustomerHoverCard 재진에 구 sage 잔존')
      .not.toContain("'bg-sage-100 text-sage-800'");

    // 초진은 전 팝업 blue 유지
    expect(RESVPOPUP, '팝업 초진 blue 유지 깨짐').toContain("new: 'bg-blue-100 text-blue-700'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 — 회귀(carve-out 보존): 변경되면 안 되는 것들
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: carve-out 회귀 보존', () => {
  test('S4-1: 칸반 teal pinned hex 보존(#ccfbf1 / #2dd4bf)', () => {
    expect(STATUS, '칸반 treatment_waiting teal pin 변경됨')
      .toContain("treatment_waiting: 'bg-[#ccfbf1] text-[#115e59]'");
    expect(STATUS, '칸반 preconditioning teal pin 변경됨')
      .toContain("preconditioning: 'bg-[#2dd4bf] text-white'");
  });

  test('S4-2: error 빨강(cancelled) 보존', () => {
    expect(STATUS, 'cancelled 빨강 carve-out 변경됨')
      .toContain("cancelled: 'bg-red-100 text-red-600'");
  });

  test('S4-3: VISIT_TYPE_COLOR 재진 emerald 의미색 carve-out 보존 (초진은 blue)', () => {
    expect(STATUS, 'VISIT_TYPE_COLOR 초진 blue 깨짐')
      .toContain("new: 'bg-blue-100 text-blue-700'");
    expect(STATUS, 'VISIT_TYPE_COLOR 재진 emerald carve-out 변경됨(변경 금지 위반)')
      .toContain("returning: 'bg-emerald-100 text-emerald-700'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 5 — 대시보드 통합시간표 슬롯 카드 A안 컬러 (총괄 final 추가 scope)
//   T-20260615 무채색(MONOTONE-TIMETABLE / THEME-MONO-REFINE-3AREA) SUPERSEDED.
//   '재진 N' 배지는 제거 대상 아님 → #EDF1E4(firstvisit) 적용. 초진=blue / 재진=firstvisit.
//   (T-20260629-RESVMGMT-TIMETABLE-TONE-RECHECK 무채색 전제도 흡수 SUPERSEDED.)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오5: 통합시간표 A안 컬러(총괄 추가 scope, T-20260615 무채색 SUPERSEDED)', () => {
  test('S5-1: 통합시간표 방문수 배지 — 초진=blue / 재진=firstvisit (구 raw emerald 잔존 0)', () => {
    expect(DASH, "통합시간표 '초진 N' 배지가 A안 파랑(blue)이 아님")
      .toContain('bg-blue-100 px-1 py-0.5 text-[9px] font-bold text-blue-700');
    expect(DASH, "통합시간표 '재진 N' 배지가 A안 초록(firstvisit)이 아님 — #EDF1E4 미적용")
      .toContain('bg-firstvisit-100 px-1 py-0.5 text-[9px] font-bold text-firstvisit-700');
    expect(DASH, "통합시간표 '재진 N' 배지에 구 raw emerald 잔존(B2 미적용)")
      .not.toContain('bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-700');
  });

  test('S5-2: 통합시간표 컬럼 헤더 — 초진=blue / 재진=firstvisit (무채색 gray 잔존 0)', () => {
    expect(DASH, '통합시간표 초진 헤더가 A안 파랑(bg-blue-100)이 아님')
      .toContain('text-blue-700 text-center border-r bg-blue-100');
    expect(DASH, '통합시간표 재진 헤더가 A안 초록(bg-firstvisit-50)이 아님')
      .toContain('text-firstvisit-700 text-center bg-firstvisit-50');
    expect(DASH, '통합시간표 헤더에 구 무채색(bg-gray-100 초진) 잔존')
      .not.toContain('text-gray-700 text-center border-r bg-gray-100');
  });

  test('S5-3: 통합시간표 슬롯 배경 틴트 — 초진=blue-50 / 재진=firstvisit-50 (무채색 gray 틴트 잔존 0)', () => {
    expect(DASH, '통합시간표 초진 슬롯 틴트가 blue-50이 아님')
      .toContain("newCnt > 0 ? 'bg-blue-50/60' : ''");
    expect(DASH, '통합시간표 재진 슬롯 틴트가 firstvisit-50이 아님')
      .toContain("retCnt > 0 ? 'bg-firstvisit-50/50' : ''");
    expect(DASH, '통합시간표 슬롯 틴트에 구 무채색(gray-50) 잔존')
      .not.toContain("newCnt > 0 ? 'bg-gray-50/60' : ''");
  });

  test('S5-4: 통합시간표 예약 카드 — 초진(Box1)=blue / 재진(Box2)=firstvisit', () => {
    expect(DASH, '통합시간표 초진 예약카드(DraggableBox1Card)가 A안 파랑이 아님')
      .toContain('border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] w-full select-none');
    expect(DASH, '통합시간표 재진 예약카드(DraggableBox2ResvCard)가 A안 초록이 아님')
      .toContain('border border-firstvisit-200 bg-firstvisit-50 px-2 py-1 text-[11px] font-semibold w-full shadow-sm');
  });

  test('S5-5: 통합시간표 체크인 카드 box2Cls — 재진=firstvisit / 초진=blue', () => {
    expect(DASH, '통합시간표 체크인 카드 재진 스타일이 firstvisit이 아님')
      .toContain("'border-firstvisit-200 bg-firstvisit-50 hover:bg-firstvisit-100'");
    expect(DASH, '통합시간표 체크인 카드 초진 스타일이 blue가 아님')
      .toContain("'border-blue-200 bg-blue-50 hover:bg-blue-100'");
    expect(DASH, '통합시간표 체크인 카드 box2Cls에 구 무채색(gray-50 재진) 잔존')
      .not.toContain("'border-gray-300 bg-gray-50 hover:bg-gray-100'");
  });

  test('S5-6: 대시보드 진행현황 카운트 — 상태바 중복제거 후 전체/신규/재진 탭 통합 (구 emerald 잔존 0)', () => {
    // T-20260630-foot-DASH-HEADER-DEDUP-COMPACT AC-3(commit e82ef73f) SUPERSEDE:
    //   좌측 '초진·재진·수납대기·완료' 컬러 상태바(text-blue-700/firstvisit-700 <strong>)는 중복으로 제거되고,
    //   초진/재진 건수는 무채색 '전체/신규/재진' 탭(TabsTrigger, N건)으로 통합 표기(AC-2). 색상 상태바 마크업은 stale.
    //   → 카운트 소스(statusNewCount/statusReturningCount)는 탭에서 그대로 사용, 구 emerald 상태바 잔존 0 가드는 유지.
    expect(DASH, "신규 카운트가 탭(TabsTrigger '신규 {statusNewCount}건')으로 통합되지 않음")
      .toContain('신규 {statusNewCount}건');
    expect(DASH, "재진 카운트가 탭(TabsTrigger '재진 {statusReturningCount}건')으로 통합되지 않음")
      .toContain('재진 {statusReturningCount}건');
    // 구 컬러 상태바(초진 blue-700 / 재진 firstvisit-700·emerald-700 <strong>)는 제거되어 잔존 0.
    expect(DASH, '제거된 구 초진 blue-700 상태바 마크업이 잔존')
      .not.toContain('초진 <strong className="text-blue-700">{statusNewCount}</strong>');
    expect(DASH, '제거된 구 재진 상태바에 raw emerald 잔존')
      .not.toContain('재진 <strong className="text-emerald-700">{statusReturningCount}</strong>');
  });
});
