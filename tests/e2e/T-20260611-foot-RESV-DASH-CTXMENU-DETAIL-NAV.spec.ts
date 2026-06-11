import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV — 대시보드 슬롯 카드 우클릭 [예약상세] → 예약관리 라우팅 + 정본 팝업
 * 원천: NEW-TASK MSG-20260611-181147-rgzg (planner). 첨부 F0B9UUESVB4.
 *
 * 동선(신규):
 *   a) 대시보드(/admin) 슬롯 카드 우클릭 메뉴 [예약상세] (기존 우클릭 패턴 재사용)
 *   b) 클릭 시 예약관리(/admin/reservations) 로 라우팅
 *   c) 라우팅 직후 ReservationDetailPopup 이 열린 채로 보임 (대시보드 로컬 팝업 미사용 → 라우팅 후 정본 팝업 오픈)
 *   d) 팝업 = 클릭 원 예약 기준(reservation_id 유지) — 전체 Reservation 객체를 location.state 로 전달
 *
 * ⚠ 정합 우선검증(POPUP-SYNC field-soak): 예약관리 측 [예약상세]→팝업(detail/setDetail)을 이미 정본으로 보유.
 *   대시보드에 별도 ReservationDetailPopup 인스턴스를 두면 *중복 마운트*로 동기화가 깨질 수 있어 →
 *   대시보드 로컬 팝업(dashResvDetail) 제거, 단일 정본 팝업만 사용. (DB 변경 없음, FE 라우팅 + 팝업 상태)
 *
 * 거대-인라인 페이지(Dashboard/Reservations) 관례 = source-integrity gating(정적 단언).
 * 실 브라우저 클릭 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const DASH_PAGE = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 타임라인 슬롯 카드 우클릭 [예약상세] → 예약관리 라우팅 (대시보드 로컬 팝업 미사용)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 타임라인 슬롯 카드 [예약상세] → 라우팅', () => {
  test('S1-1: handleResvOpenDetailFromCtx = navigate(/admin/reservations) + openReservationDetail', () => {
    const block = DASH_PAGE.slice(
      DASH_PAGE.indexOf('const handleResvOpenDetailFromCtx'),
      DASH_PAGE.indexOf('const handleResvOpenDetailFromCtx') + 900,
    );
    expect(block, '타임라인 [예약상세] 가 예약관리로 라우팅하지 않음')
      .toContain("navigate('/admin/reservations'");
    expect(block, '클릭 원 예약 객체를 state.openReservationDetail 로 전달하지 않음')
      .toContain('openReservationDetail');
    // (b) 클릭 원 예약 기준: timelineReservations 캐시에서 reservation_id 로 복원한 resv 를 전달
    expect(block, 'reservation_id 기준 원본 예약 복원 경로 소실')
      .toContain("timelineReservations.find((r) => r.id === resvId)");
  });

  test('S1-2: 타임라인 [예약상세] 는 대시보드 로컬 팝업(setDashResvDetail)을 더 이상 열지 않음', () => {
    const block = DASH_PAGE.slice(
      DASH_PAGE.indexOf('const handleResvOpenDetailFromCtx'),
      DASH_PAGE.indexOf('const handleResvOpenDetailFromCtx') + 900,
    );
    expect(block, '대시보드 로컬 팝업 잔존(중복 마운트 위험)').not.toContain('setDashResvDetail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 고객카드 우클릭 [예약상세] → 라우팅 (연결예약) / 워크인 fallback 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 고객카드 [예약상세] → 라우팅 + L-002 fallback', () => {
  test('S2-1: handleCardResvDetailOrCreate 연결예약 경로 = 예약관리 라우팅 위임', () => {
    const block = DASH_PAGE.slice(
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate'),
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate') + 1400,
    );
    expect(block, '고객카드 연결예약 [예약상세] 라우팅 위임 없음')
      .toContain("navigate('/admin/reservations'");
    expect(block, 'openReservationDetail state 전달 없음').toContain('openReservationDetail');
    // 캐시 hit + DB refetch 두 경로 모두 라우팅 위임 (대시보드 로컬 팝업 0)
    expect(block, '대시보드 로컬 팝업 잔존(중복 마운트 위험)').not.toContain('setDashResvDetail');
  });

  test('S2-2: 워크인(연결예약 없음) → 신규예약 생성 fallback 보존 (L-002)', () => {
    const block = DASH_PAGE.slice(
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate'),
      DASH_PAGE.indexOf('const handleCardResvDetailOrCreate') + 1400,
    );
    expect(block, 'L-002 워크인 신규생성 fallback 소실').toContain('handleNewReservation(ci)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC (c)/(d) — 예약관리 정본 팝업이 라우팅 state 를 소비해 클릭 원 예약 팝업을 연다
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC: 예약관리 정본 팝업 라우팅 state 소비', () => {
  test('AC-1: Reservations 가 location.state.openReservationDetail 을 소비해 setDetail 오픈', () => {
    expect(RESV_PAGE, '예약관리가 라우팅 state(openReservationDetail) 을 읽지 않음')
      .toContain('openReservationDetail');
    // (c) 라우팅 직후 정본 팝업(detail) 오픈 — 별도 fetch 없이 전달받은 Reservation 으로 즉시 setDetail
    const eff = RESV_PAGE.slice(
      RESV_PAGE.indexOf('navDetailConsumed'),
    );
    expect(eff, 'state.openReservationDetail → setDetail 경로 없음').toContain('setDetail(resv)');
  });

  test('AC-2: 1회만 소비(중복 오픈 방지) + history.replaceState 로 state 정리', () => {
    expect(RESV_PAGE, '중복 소비 가드(navDetailConsumed) 없음').toContain('navDetailConsumed.current');
    const block = RESV_PAGE.slice(
      RESV_PAGE.indexOf('if (navDetailConsumed.current) return;'),
      RESV_PAGE.indexOf('if (navDetailConsumed.current) return;') + 500,
    );
    expect(block, '새로고침/뒤로가기 재오픈 방지용 replaceState 없음')
      .toContain("window.history.replaceState({}, '')");
  });

  test('AC-3: 예약관리 정본 팝업(detail/setDetail) 단일 인스턴스 유지 — 중복 마운트 없음', () => {
    // 정본 팝업은 reservation={detail} 1개. 대시보드 로컬 팝업 제거로 인스턴스 단일화.
    expect(RESV_PAGE).toContain('reservation={detail}');
    expect(DASH_PAGE, '대시보드 로컬 예약상세 팝업 인스턴스 잔존')
      .not.toContain('reservation={dashResvDetail}');
    expect(DASH_PAGE, '대시보드 dashResvDetail 상태 잔존').not.toContain('dashResvDetail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 회귀 — DB 무변경(FE-only) + 기존 라우팅 동선(openReservationFor) 미간섭
// ═══════════════════════════════════════════════════════════════════════════
test.describe('회귀: FE-only + 기존 동선 보존', () => {
  test('REG-1: 신규예약 라우팅 동선(openReservationFor)은 그대로 보존', () => {
    expect(RESV_PAGE).toContain('openReservationFor');
    expect(RESV_PAGE).toContain('navStateConsumed');
    // 두 동선이 별도 consumed ref 사용 → 같은 mount 에서 상호 간섭 없음
    expect(RESV_PAGE).toContain('navDetailConsumed');
  });
});
