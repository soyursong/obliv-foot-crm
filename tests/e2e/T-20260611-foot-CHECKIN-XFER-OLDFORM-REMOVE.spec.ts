import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE — 초진 [체크인 전환] 구 정보입력 폼(주민번호+동의서) 제거
 *
 * 현장(김주연 총괄): 통합시간표에서 초진 환자 [체크인 전환] 시 뜨는 팝업에 "주민번호 입력란 +
 *   (옛날 양식) 건보 자격조회 동의서"가 같이 로드됨 → 그 옛날 양식 UI 제거.
 *
 * AC-0 식별:
 *   [체크인 전환] 팝업 = src/components/ReservationDetailPopup.tsx (통합시간표 staff-side 예약상세 팝업).
 *   초진(new) [체크인 전환] → convertToCheckIn → setShowFirstInfoDialog(true) → <CheckinFirstInfoDialog>.
 *   구 양식 출처 = src/components/CheckinFirstInfoDialog.tsx
 *     · 주민번호 input (data-testid="checkin-info-rrn")
 *     · 건강보험 자격조회 동의서 블록(HIRA_CONSENT_CONTENT + checkbox)
 *     · 서명 패드
 *   동일 컴포넌트가 Dashboard.tsx(칸반 카드 경로)에도 import 되어 있었으나 그 경로는
 *   _handleReservationCheckIn(접수버튼 제거로 dead, void 처리)에서만 트리거 → 실사용 LIVE 경로는
 *   ReservationDetailPopup 뿐. 정책(RRN-FIELD-REMOVE deployed / CHECKIN-CONSENT-REMOVE closed)에 따라
 *   staff 양 진입점 모두에서 제거 + 컴포넌트 삭제.
 *
 * AC-1: 주민번호 입력 필드 제거 (birth_date 컬럼·데이터 존치, UI만)
 * AC-2: 구 동의서 양식 UI 블록 제거 (import·상태변수·모달 정리)
 * AC-3: 체크인 전환 후 상태 전이·저장 무회귀 (doCheckIn slot 분기 그대로)
 * AC-4: Dashboard(칸반 카드) 동일 양식도 함께 제거 (dead 경로 정리)
 *
 * 레포 관례 = 거대-인라인/established 컴포넌트는 source-integrity gating(소스 정적 단언)으로 회귀 차단,
 *   실 브라우저 클릭 동작은 supervisor field-soak 로 마감. DB 무관(FE-only, 컬럼 존치).
 */

const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const DASHBOARD = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC-0/AC-2: 구 양식 컴포넌트(CheckinFirstInfoDialog) 완전 제거
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-0/AC-2: 구 정보입력 폼 컴포넌트 제거', () => {
  test('AC-0-1: CheckinFirstInfoDialog.tsx 파일이 삭제됨', () => {
    expect(
      fs.existsSync(path.resolve('src/components/CheckinFirstInfoDialog.tsx')),
      'CheckinFirstInfoDialog.tsx 가 잔존하면 안 됨',
    ).toBe(false);
  });

  test('AC-2-1: ReservationDetailPopup 에 CheckinFirstInfoDialog import/렌더 없음', () => {
    expect(DETAIL_POPUP.includes('CheckinFirstInfoDialog'), 'import/렌더 잔존 금지').toBe(false);
    expect(DETAIL_POPUP.includes('showFirstInfoDialog'), '상태변수 잔존 금지').toBe(false);
  });

  test('AC-2-2: 주민번호 입력 + 건보동의서 testid 가 팝업 트리에서 사라짐', () => {
    // 구 양식의 RRN input / 동의서 체크박스 testid 가 컴포넌트 삭제로 어디에도 없어야 함.
    expect(DETAIL_POPUP.includes('checkin-info-rrn')).toBe(false);
    expect(DETAIL_POPUP.includes('checkin-info-consent-checkbox')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-1/AC-3: 체크인 전환 진입점 — 폼 없이 직행 + slot 분기 무회귀
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1/AC-3: 체크인 전환 직행 + 무회귀', () => {
  test('AC-1-1: convertToCheckIn 은 분기 없이 doCheckIn 직행', () => {
    expect(DETAIL_POPUP).toMatch(/const convertToCheckIn = async \(\) => \{[\s\S]*?await doCheckIn\(\);[\s\S]*?\};/);
    // 초진 분기(visit_type === 'new' → setShowFirstInfoDialog) 잔존 금지
    expect(DETAIL_POPUP.includes('setShowFirstInfoDialog')).toBe(false);
  });

  test('AC-3-1: doCheckIn 의 slot 분기(canonical)가 그대로 유지됨 — 무회귀', () => {
    // CONSULTSLOT(P0)가 확립한 canonical 슬롯 분기를 본 작업이 건드리지 않았음을 단언.
    expect(DETAIL_POPUP).toContain(
      "status: reservation.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting'",
    );
  });

  test('AC-4-1: [체크인 전환] 버튼은 그대로 렌더된다', () => {
    expect(DETAIL_POPUP).toContain('체크인 전환');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4: Dashboard(칸반 카드) 동일 양식 제거
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4: Dashboard 동일 양식 제거', () => {
  test('AC-4-2: Dashboard 에 CheckinFirstInfoDialog / firstInfoTarget 잔존 없음', () => {
    expect(DASHBOARD.includes('CheckinFirstInfoDialog'), 'import/렌더 잔존 금지').toBe(false);
    expect(DASHBOARD.includes('firstInfoTarget'), '상태변수 잔존 금지').toBe(false);
  });
});
