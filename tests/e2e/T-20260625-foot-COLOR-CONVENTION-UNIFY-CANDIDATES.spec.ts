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
 * carve-out(미접촉): status.ts 칸반 teal / error 빨강 / success / Badge variant 의미색 / 재진 emerald 의미색.
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

  test('S1-3: 일간/주간 칸 칩 3곳 — 초=blue / 재=firstvisit / HL=healer (raw yellow 잔존 0)', () => {
    // 초 칩 = blue (3 위치 모두)
    expect((RESV.match(/bg-blue-100[^"]*text-blue-700">초 /g) || []).length,
      '초 칩 blue 3곳 미적용').toBe(3);
    // 재 칩 = firstvisit (3 위치 모두)
    expect((RESV.match(/bg-firstvisit-100[^"]*text-firstvisit-700">재 /g) || []).length,
      '재 칩 firstvisit 3곳 미적용').toBe(3);
    // HL 칩 = healer (raw yellow 금지)
    expect((RESV.match(/bg-healer-100[^"]*text-healer-700">HL /g) || []).length,
      'HL 칩 healer 토큰 3곳 미적용').toBe(3);
    expect(RESV, 'HL 칩에 구 raw yellow 잔존').not.toContain('text-yellow-700">HL ');
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
    expect(CHART, '신분증 확인완료 dot이 firstvisit(green success)에서 변경됨')
      .toContain('bg-firstvisit-500');
    expect(CHART, '신분증 확인완료 배지 A안 초록 앵커(#E7EEDA) 정합 깨짐')
      .toContain('#E7EEDA');
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
