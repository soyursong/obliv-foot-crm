import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260708-foot-TIMETABLE-CTXMENU-RESVDETAIL-NAVIGATE
 *   — 대시보드 통합시간표 예약 박스 우클릭 [예약상세] → 예약관리 화면 '페이지 전환' + 해당 예약 상세 오픈
 * 원천: NEW-TASK MSG-20260708-115726-jb1d (planner). 요청자: 김주연 총괄(C0ATE5P6JTH).
 *
 * 변경:
 *   - 통합시간표 예약 박스 우클릭 [예약상세] 핸들러를 prefill 신규동선(handleCardResvDetailOrCreate) →
 *     예약관리(/admin/reservations) 정본 화면 페이지 전환(handleResvDetailNavToMgmt)으로 교체.
 *   - 전체 Reservation 객체를 location.state.openReservationDetail 로 전달 → 예약관리 수신부(navDetailConsumed)가
 *     그 예약의 정본 ReservationDetailPopup 을 예약 ID 기준으로 바로 오픈(예약관리에서 그 예약 식별).
 *   - ReservationDetailPopup 은 예약관리 정본 화면에서만 단일 마운트(대시보드 로컬 인스턴스 0) — 다른 경로 사용 중이므로 팝업 유지.
 *
 * 폴백: resv 부재(방어) 시 openReservationDetail 미전달 → 예약관리 목록 화면으로 폴백(ID 라우팅 불가 폴백).
 *
 * ⚠ 인접(ADJACENCY): T-20260708-foot-DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE 의 QUICKADD 슬롯 신규생성
 *   게이팅(dashResvCreateDisabled / onSlotClick)은 무접촉. 본 건은 [예약상세] 항목 핸들러만.
 *   고객박스(체크인 큐) CustomerQuickMenu 의 prefill 동선은 불변.
 *
 * 거대-인라인 페이지(Dashboard/Reservations) 관례 = source-integrity gating(정적 단언).
 * 실 브라우저 클릭/페이지 전환 동작은 supervisor field-soak(갤탭 실기기)로 닫음. DB 무관(FE-only, db_change=false).
 */

const DASH_PAGE = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 예약 박스 [예약상세] = 예약관리 페이지 전환 + openReservationDetail(예약 ID 기준)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 통합시간표 예약박스 [예약상세] → 예약관리 페이지 전환', () => {
  test('S1-1: handleResvDetailNavToMgmt = navigate(/admin/reservations) + openReservationDetail(전체 Reservation)', () => {
    const start = DASH_PAGE.indexOf('const handleResvDetailNavToMgmt');
    expect(start, 'handleResvDetailNavToMgmt 핸들러 없음').toBeGreaterThan(-1);
    const block = DASH_PAGE.slice(start, start + 500);
    expect(block, '예약관리로 페이지 전환(navigate) 없음').toContain("navigate('/admin/reservations'");
    expect(block, '예약 ID 기준 식별용 openReservationDetail state 전달 없음').toContain('openReservationDetail');
    // 클릭 원 예약(전체 Reservation 객체)을 resvContextMenu 에서 취득해 전달 → 예약관리에서 그 예약 바로 식별
    expect(block, 'resvContextMenu.reservation(원본 예약) 취득 경로 소실').toContain('resvContextMenu?.reservation');
  });

  test('S1-2: resv 부재 → openReservationDetail 미전달(예약관리 목록 폴백) — dead 진입점 방지', () => {
    const start = DASH_PAGE.indexOf('const handleResvDetailNavToMgmt');
    const block = DASH_PAGE.slice(start, start + 500);
    // resv 있으면 state 동봉, 없으면 undefined(=목록 폴백). 조건부 전달 형태 검증.
    expect(block, 'resv 부재 폴백(조건부 state) 경로 소실').toContain('resv ? { state:');
  });

  test('S1-3: 예약 박스 CustomerQuickMenu 의 onNewReservation 이 신규 핸들러로 배선', () => {
    // 예약 박스 메뉴는 resvContextMenu 를 checkIn 으로 어댑트(resvAsCheckIn). 해당 메뉴 블록만 검사.
    const anchor = DASH_PAGE.indexOf('checkIn={resvContextMenu ? resvAsCheckIn(resvContextMenu.reservation) : null}');
    expect(anchor, '예약 박스 CustomerQuickMenu 앵커 소실').toBeGreaterThan(0);
    const block = DASH_PAGE.slice(anchor, anchor + 700);
    expect(block, '예약 박스 [예약상세] 가 신규 핸들러(handleResvDetailNavToMgmt)로 배선되지 않음')
      .toContain('onNewReservation={handleResvDetailNavToMgmt}');
    // prefill 신규동선(handleCardResvDetailOrCreate)은 이 메뉴에서 제거됨
    expect(block, '예약 박스 메뉴에 prefill 신규동선 잔존(교체 미완)')
      .not.toContain('onNewReservation={handleCardResvDetailOrCreate}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 예약관리 수신부가 state 를 소비해 그 예약의 정본 팝업을 연다(예약 ID 식별)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 예약관리 정본 팝업 라우팅 state 소비(그 예약 식별)', () => {
  test('S2-1: Reservations 가 location.state.openReservationDetail → setDetail(resv) 로 정본 팝업 오픈', () => {
    expect(RESV_PAGE, '예약관리가 openReservationDetail state 를 읽지 않음').toContain('openReservationDetail');
    const eff = RESV_PAGE.slice(RESV_PAGE.indexOf('navDetailConsumed'));
    expect(eff, 'state.openReservationDetail → setDetail(resv) 경로 없음(추가 fetch 없이 즉시 오픈)')
      .toContain('setDetail(resv)');
  });

  test('S2-2: 1회만 소비(중복 오픈 방지) + history.replaceState 로 state 정리', () => {
    expect(RESV_PAGE, '중복 소비 가드(navDetailConsumed) 없음').toContain('navDetailConsumed.current');
    const block = RESV_PAGE.slice(
      RESV_PAGE.indexOf('if (navDetailConsumed.current) return;'),
      RESV_PAGE.indexOf('if (navDetailConsumed.current) return;') + 500,
    );
    expect(block, '새로고침/뒤로가기 재오픈 방지용 replaceState 없음').toContain("window.history.replaceState({}, '')");
  });

  test('S2-3: ReservationDetailPopup = 예약관리 정본 단일 마운트, 대시보드 로컬 인스턴스 0', () => {
    // 다른 경로(예약관리)에서 사용 중 → 팝업 유지. 대시보드에는 로컬 팝업 마운트 없음.
    expect(RESV_PAGE, '예약관리 정본 팝업 마운트 소실').toContain('<ReservationDetailPopup');
    expect(DASH_PAGE, '대시보드에 로컬 ReservationDetailPopup 마운트 잔존(중복)').not.toContain('<ReservationDetailPopup');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 인접 무접촉(QUICKADD 게이팅) + 고객박스 prefill 불변 + FE-only(데이터·저장 무접촉)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 인접 게이팅 무접촉 + 고객박스 불변 + FE-only', () => {
  test('S3-1: QUICKADD 슬롯 신규생성 게이팅(dashResvCreateDisabled / onSlotClick)은 무접촉', () => {
    // 인접 티켓(DASH-TIMETABLE-RESV-BROKEN-QUICKADD-DISABLE)의 게이팅 신호가 그대로 보존되어야 함.
    expect(DASH_PAGE, 'dashResvCreateDisabled 게이팅 소실(인접 티켓 침범)').toContain('dashResvCreateDisabled');
    expect(DASH_PAGE, 'onSlotClick 조건부 배선(생성 차단) 소실').toContain('dashResvCreateDisabled ? undefined');
  });

  test('S3-2: 고객박스(체크인 큐) CustomerQuickMenu 의 prefill 동선은 불변', () => {
    // 고객박스 메뉴는 여전히 handleCardResvDetailOrCreate(prefillCustomerForSlot) 유지.
    expect(DASH_PAGE, '고객박스 메뉴 prefill 동선(handleCardResvDetailOrCreate) 소실')
      .toContain('onNewReservation={handleCardResvDetailOrCreate}');
    const handler = DASH_PAGE.slice(
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate'),
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate') + 700,
    );
    expect(handler, 'prefillCustomerForSlot 동선 소실').toContain('prefillCustomerForSlot');
  });

  test('S3-3: FE-only — 예약 데이터/상태/저장 무접촉(신규 핸들러는 화면 전환만)', () => {
    const start = DASH_PAGE.indexOf('const handleResvDetailNavToMgmt');
    const block = DASH_PAGE.slice(start, start + 500);
    // 화면 전환(navigate)만. supabase write/insert/update/delete 없음.
    expect(block, '신규 핸들러에 DB write 혼입(insert)').not.toContain('.insert(');
    expect(block, '신규 핸들러에 DB write 혼입(update)').not.toContain('.update(');
    expect(block, '신규 핸들러에 DB write 혼입(delete)').not.toContain('.delete(');
    expect(block, '신규 핸들러에 supabase 접근 혼입').not.toContain('supabase');
  });
});
