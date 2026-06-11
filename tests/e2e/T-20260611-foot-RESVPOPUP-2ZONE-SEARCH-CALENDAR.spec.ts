import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR — 예약상세 팝업 2구역 재구성
 * 원천: 김주연 총괄(C0ATE5P6JTH, thread 1781164214.580669). AC-1 현장 직접 확정(MSG-170013-sb13):
 *   "A고객 예약 등록 완료 후 B고객 정보 불러와서 신규 예약 생성."
 *
 * 착수 게이트: depends_on 5FIX(T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX) 머지 확인 완료
 *   — d6eb549(deploy_commit) origin/main 머지됨(0 ahead/0 behind) → rebase 충돌 없음.
 *
 * 본 커밋 구현 범위 = STAGE 1 (AC-1 = 현장 직접 확정 핵심, additive·비파괴):
 *   AC-1 고객 검색창(1번구역 최상단) — InlinePatientSearch 재사용(신규 PII 경로 0).
 *         B고객 선택 → 팝업 닫고 기존 예약관리 신규예약 editor(ReservationEditor) 를 B고객 기준 오픈.
 *         🔒 L-002 LOGIC-LOCK: 신규 INSERT 로직 신설 0 — parent openNewForCustomer 가 기존 동선 재사용.
 *
 * STAGE 2(후속, 단계별 브라우저 테스트 의무 — 별도 증분):
 *   AC-2 1번구역 relocate(담당상담사·활성패키지 우→좌) + 치료내역(check_ins JOIN, net-new) + 고객메모.
 *   AC-3 2번구역 미니 캘린더(net-new) + AC-4 배치순서(예약경로/등록자/캘린더/선택일자/예약메모/예약이력).
 *   → 아래 test.fixme 로 명시 보류.
 *
 * 거대-established 컴포넌트 관례 = source-integrity gating. 실 브라우저 동작은 supervisor field-soak 로 닫음.
 * DB 무관(FE-only, 기존 테이블 JOIN/재사용).
 */

const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

test.describe('AC-1 STAGE1 — 고객 검색창 + B고객 연속 신규예약 (현장 확정)', () => {
  test('팝업이 InlinePatientSearch(기존 검색 컴포넌트)를 재사용한다 — 신규 PII 경로 0', () => {
    expect(DETAIL_POPUP).toContain("from '@/components/InlinePatientSearch'");
    expect(DETAIL_POPUP).toContain('<InlinePatientSearch');
  });

  test('검색창은 1번구역 최상단 + onNewReservationForCustomer 가드(graceful degrade)', () => {
    // onNewReservationForCustomer 미전달 환경(Dashboard 뷰어)에선 검색창 숨김
    expect(DETAIL_POPUP).toContain('onNewReservationForCustomer &&');
    expect(DETAIL_POPUP).toContain('id="resv-popup-customer-search"');
    expect(DETAIL_POPUP).toContain('다른 고객 신규예약');
  });

  test('🔒 L-002 — 팝업 내부에 신규예약 INSERT 로직을 신설하지 않는다(parent 위임)', () => {
    // 검색창 선택은 parent 콜백으로만 위임 — 팝업이 reservations 테이블에 직접 INSERT 금지.
    expect(DETAIL_POPUP).toContain('if (!onNewReservationForCustomer) return;');
    expect(DETAIL_POPUP).not.toContain("from('reservations').insert");
    expect(DETAIL_POPUP).toContain('handleSelectOtherCustomer');
  });

  test('parent(Reservations) 가 기존 ReservationEditor 신규 동선(openNewForCustomer)을 재사용', () => {
    expect(RESV_PAGE).toContain('const openNewForCustomer');
    // 기존 editor 상태(setEditor)에 B고객 customer_id 프리필 — 신규 생성 로직 재사용
    expect(RESV_PAGE).toContain('onNewReservationForCustomer={openNewForCustomer}');
    expect(RESV_PAGE).toMatch(/openNewForCustomer[\s\S]*setEditor\(\{[\s\S]*customer_id: p\.id/);
  });

  test('B고객 신규예약 visit_type 기본값 = returning(연속 등록 동선)', () => {
    expect(RESV_PAGE).toMatch(/openNewForCustomer[\s\S]*visit_type: 'returning'/);
  });
});

test.describe('STAGE 2 — 1번구역 relocate + 치료내역(net-new) (AC-2)', () => {
  test('2구역 컨테이너 존재 + zone1 이 zone2 보다 먼저 렌더', () => {
    const z1 = DETAIL_POPUP.indexOf('data-testid="popup-zone1-customer"');
    const z2 = DETAIL_POPUP.indexOf('data-testid="popup-zone2-reservation"');
    expect(z1).toBeGreaterThan(-1);
    expect(z2).toBeGreaterThan(z1);
  });

  test('AC-2 RELOCATE: 담당상담사·활성패키지가 1번구역(zone1)으로 이동', () => {
    const z1 = DETAIL_POPUP.indexOf('data-testid="popup-zone1-customer"');
    const z2 = DETAIL_POPUP.indexOf('data-testid="popup-zone2-reservation"');
    const consultantIdx = DETAIL_POPUP.indexOf('data-testid="popup-consultant"');
    const packageIdx = DETAIL_POPUP.indexOf('>활성 패키지</div>');
    // 둘 다 zone1 영역(z1 < idx < z2)
    expect(consultantIdx).toBeGreaterThan(z1);
    expect(consultantIdx).toBeLessThan(z2);
    expect(packageIdx).toBeGreaterThan(z1);
    expect(packageIdx).toBeLessThan(z2);
  });

  test('AC-2 담당상담사 raw UUID resolve: allStaff(전체 staff) 로 이름 매핑(staffName)', () => {
    // 기존 consultant-만-로드 게이트 제거 → 전체 활성 staff 로드 후 이름 resolve
    expect(DETAIL_POPUP).toContain('setAllStaff');
    expect(DETAIL_POPUP).toContain('const staffName');
    expect(DETAIL_POPUP).toContain('display_name ?? s.name');
    expect(DETAIL_POPUP).not.toContain(".eq('role', 'consultant')");
  });

  test('AC-2 치료내역 net-new: check_ins treatment 필드 JOIN(신규 테이블/컬럼 0)', () => {
    expect(DETAIL_POPUP).toContain("from('check_ins')");
    expect(DETAIL_POPUP).toContain('treatment_category, treatment_contents, treatment_kind, therapist_id');
    expect(DETAIL_POPUP).toContain('data-testid="popup-treatment-history"');
    expect(DETAIL_POPUP).toContain('지정치료사');
    expect(DETAIL_POPUP).toContain('담당치료사');
  });

  test('AC-2 고객메모 ≠ 예약메모: 고객메모는 1번구역(zone1)', () => {
    const z1 = DETAIL_POPUP.indexOf('data-testid="popup-zone1-customer"');
    const z2 = DETAIL_POPUP.indexOf('data-testid="popup-zone2-reservation"');
    const customerMemoIdx = DETAIL_POPUP.indexOf('고객 특이사항·성향·주차 등');
    expect(customerMemoIdx).toBeGreaterThan(z1);
    expect(customerMemoIdx).toBeLessThan(z2);
  });
});

test.describe('STAGE 2 — 2번구역 미니캘린더 + 배치순서 (AC-3/AC-4)', () => {
  test('AC-3 미니 캘린더 재사용(MiniMonthCalendar) — 2번구역에 위치', () => {
    expect(DETAIL_POPUP).toContain("from '@/components/MiniMonthCalendar'");
    expect(DETAIL_POPUP).toContain('<MiniMonthCalendar');
    const z2 = DETAIL_POPUP.indexOf('data-testid="popup-zone2-reservation"');
    expect(DETAIL_POPUP.indexOf('<MiniMonthCalendar')).toBeGreaterThan(z2);
  });

  test('AC-4 2번구역 배치순서: 예약경로→예약등록자→캘린더→선택일자/시간→예약메모→예약이력', () => {
    const seq = [
      'data-testid="popup-visit-route"',
      'data-testid="popup-registrar"',
      '<MiniMonthCalendar',
      '선택한 일자 및 시간',
      '>예약메모</div>',
      'data-testid="popup-reservation-history"',
    ].map((m) => DETAIL_POPUP.indexOf(m));
    // 모두 발견 + 엄격 오름차순
    for (const idx of seq) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]);
  });

  test('AC-4 #6 예약이력 = 전체 히스토리 + 변경이력(ReservationAuditLogPanel) 통합', () => {
    const histIdx = DETAIL_POPUP.indexOf('data-testid="popup-reservation-history"');
    expect(histIdx).toBeGreaterThan(-1);
    // 변경이력 패널은 히스토리 블록 내부에 함께 렌더
    expect(DETAIL_POPUP.indexOf('ReservationAuditLogPanel', histIdx)).toBeGreaterThan(histIdx);
  });

  test('🔒 L-002 회귀: Stage2 에도 팝업 내부 신규예약 INSERT 신설 없음', () => {
    expect(DETAIL_POPUP).not.toContain("from('reservations').insert");
  });
});
