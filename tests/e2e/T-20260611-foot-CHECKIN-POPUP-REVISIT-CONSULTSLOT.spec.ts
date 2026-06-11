import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-CHECKIN-POPUP-REVISIT-CONSULTSLOT — 예약상세 팝업 [체크인 전환] 재진 슬롯 회귀 fix
 *
 * 버그: 통합시간표 우클릭 [예약상세] → 팝업 [체크인 전환] 클릭 시 재진(returning) 환자가
 *   [상담대기](consult_waiting)로 잘못 활성화. 기대 = [치료대기](treatment_waiting).
 *
 * 원인: fbb843b(CTXMENU-UNIFY-CANONICAL, 14:54 deploy)가 카드/타임라인 우클릭 진입점을
 *   [예약하기]→[예약상세] 재배선. 이후 ReservationDetailPopup.doCheckIn 이 재진 카드의 활성
 *   경로가 되며, 잔존하던 CHECKIN-FIRST-INFO 의 'consult_waiting' 전(全) visit_type 하드코딩이
 *   재진을 상담대기로 잘못 활성화(권준서 F-1548).
 *
 * fix: canonical 분기 복원 — returning ? treatment_waiting : consult_waiting.
 *   canonical 출처 = T-20260522-foot-REVISIT-TREAT-WAIT(ebe1dd7) / NewCheckInDialog:223 / Dashboard:5195.
 *
 * AC-1: 우클릭 [예약상세]→[체크인 전환] 재진 → treatment_waiting 슬롯
 * AC-2: 초진/워크인 → consult_waiting 유지 (회귀 없음)
 * AC-3: handleReservationCheckIn 등 다른 체크인 경로(셀프/수동/[+체크인]) canonical 분기 일관
 * AC-4: E2E 재진 예약상세 팝업 체크인전환 → treatment_waiting 시나리오
 *
 * 거대-인라인/established 컴포넌트 관례 = source-integrity gating(소스 정적 단언)으로 회귀 차단.
 * 실 브라우저 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only, status enum 기존 재사용).
 */

const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const NEW_CHECKIN_DIALOG = fs.readFileSync(path.resolve('src/components/NewCheckInDialog.tsx'), 'utf-8');
const DASHBOARD = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const SELF_CHECKIN = fs.readFileSync(path.resolve('src/pages/SelfCheckIn.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: 예약상세 팝업 doCheckIn — 재진 → treatment_waiting 분기 복원
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 예약상세 팝업 체크인전환 재진 슬롯', () => {
  test('AC-1-1: doCheckIn INSERT status 가 canonical 분기(returning ? treatment_waiting : consult_waiting)', () => {
    expect(
      DETAIL_POPUP,
      'ReservationDetailPopup.doCheckIn 의 status 가 canonical 분기여야 함',
    ).toContain("status: reservation.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting'");
  });

  test('AC-1-2: 전(全) visit_type 하드코딩(status: \'consult_waiting\')이 제거됨', () => {
    // 회귀 원인이던 무조건 consult_waiting 하드코딩 단언이 사라졌는지 확인.
    expect(
      DETAIL_POPUP.includes("status: 'consult_waiting'"),
      "ReservationDetailPopup 에 무조건 consult_waiting 하드코딩이 잔존하면 안 됨",
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3: 다른 체크인 경로 canonical 분기 일관 (회귀 가드)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3: 체크인 경로별 canonical 분기 일관', () => {
  test('AC-3-1: NewCheckInDialog([+체크인]) — returning → treatment_waiting', () => {
    expect(NEW_CHECKIN_DIALOG).toContain(
      "status: visitType === 'returning' ? 'treatment_waiting' : 'consult_waiting'",
    );
  });

  test('AC-3-2: Dashboard.handleReservationCheckIn — returning → treatment_waiting', () => {
    expect(DASHBOARD).toContain(
      "res.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting'",
    );
  });

  test('AC-3-3: SelfCheckIn(셀프접수) — returning → treatment_waiting', () => {
    expect(SELF_CHECKIN).toContain("? 'treatment_waiting'");
    // returning 분기가 treatment_waiting 인지 구조 확인
    expect(SELF_CHECKIN).toMatch(/visitType === 'returning'\s*\n?\s*\?\s*'treatment_waiting'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4: 예약상세 팝업 [체크인 전환] 진입점 + 재진 직행 배선 (소스 정적 단언)
//   실 브라우저 클릭→슬롯 활성화는 supervisor field-soak 로 마감(레포 관례).
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4: 체크인전환 진입점·배선', () => {
  test('AC-4-1: [체크인 전환] 버튼이 팝업에 렌더된다', () => {
    expect(DETAIL_POPUP).toContain('체크인 전환');
  });

  test('AC-4-2: convertToCheckIn — 모든 visit_type 이 doCheckIn 직행 (초진 구 정보입력 폼 제거 후)', () => {
    // T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE 반영:
    //   초진 구 정보입력 폼(CheckinFirstInfoDialog) 제거로 convertToCheckIn 은 분기 없이 doCheckIn 직행.
    //   재진/초진 슬롯 분기는 doCheckIn 내부 canonical(AC-1-1/AC-2)로 유지 → 본 ticket 의도 무회귀.
    expect(DETAIL_POPUP).toMatch(/const convertToCheckIn = async \(\) => \{[\s\S]*?await doCheckIn\(\);[\s\S]*?\};/);
    // 구 정보입력 폼 분기(showFirstInfoDialog) 가 잔존하면 안 됨.
    expect(DETAIL_POPUP.includes('showFirstInfoDialog'), 'showFirstInfoDialog 잔존 금지').toBe(false);
  });
});

test('AC-2: 초진/워크인 분기 유지 — doCheckIn else 경로가 consult_waiting', () => {
  // canonical 분기의 else(초진/예약없이방문) 가 consult_waiting 임을 단언 (AC-2 회귀 없음).
  expect(DETAIL_POPUP).toContain("? 'treatment_waiting' : 'consult_waiting'");
});
