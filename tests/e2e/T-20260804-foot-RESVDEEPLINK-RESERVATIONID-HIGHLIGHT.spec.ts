import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260804-foot-RESVDEEPLINK-RESERVATIONID-HIGHLIGHT
 *   — 풋센터CRM /admin/reservations 가 도파민TM CRM예약 뱃지 딥링크의 reservationId 쿼리를 파싱 →
 *     해당 예약을 자기 CRM(obliv-foot-crm, 자기 auth/RLS 범위) 조회 → 그 예약 날짜의 일간 뷰로 이동 +
 *     하이라이트(ring-teal-500) + 스크롤. 부재/미상/미해석 시 기존 목록/캘린더 랜딩 유지(회귀 안전).
 *
 * 원천: NEW-TASK MSG-20260804-170601-2qhc (planner). 요청자: 박민지 팀장(C0ATH4JF3E1).
 * 부모: T-20260724-dopamine-CRMBADGE-DEEPLINK-ALLBRANCH-FANOUT (RC-2 e04f7e94 — URL에 reservationId 부착 완료).
 * 본 티켓 = 그 URL을 수신하는 타깃-CRM(foot=하드포크 BASE) 측 '하이라이트-온-어라이벌' 구현.
 *
 * param 'reservationId' = 자매 crmDeeplinkRegistry(TM 사이드바 CRM 수정/취소 딥링크)와 동일 표준.
 *
 * 거대-인라인 페이지(Reservations) 관례 = source-integrity gating(정적 단언).
 * 실 브라우저 클릭/뷰 점프 착지는 supervisor field-soak(갤탭 실기기)로 닫음.
 * db_change=false(reservations read-only, DDL 0). 신규 cross-CRM 접근 0(자기 CRM 자기 예약 조회).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 도파민 뱃지 클릭 → foot 예약 pin-point 착지 (AC1)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: reservationId 딥링크 → 해당 예약으로 이동 + 하이라이트', () => {
  test('S1-1: URL 쿼리 reservationId 파싱 → clinic 준비 후 값당 1회 소비(jumpToReservationById 호출)', () => {
    // ?reservationId= 를 searchParams 로 읽는 수신부 존재
    expect(RESV_PAGE, 'reservationId searchParams 파싱 없음')
      .toContain("searchParams.get('reservationId')");
    expect(RESV_PAGE, 'reservationId → jumpToReservationById 호출 경로 없음')
      .toContain('jumpToReservationById(reservationIdParam)');
    // 값당 1회 소비 가드(같은 reservationId 재평가 시 중복 점프 방지)
    expect(RESV_PAGE, '딥링크 1회 소비 가드(deeplinkResvConsumedRef) 없음')
      .toContain('deeplinkResvConsumedRef.current === reservationIdParam');
    expect(RESV_PAGE, '소비 값 저장(deeplinkResvConsumedRef 갱신) 없음')
      .toContain('deeplinkResvConsumedRef.current = reservationIdParam');
  });

  test('S1-2: 조회 = 자기 CRM(clinic-scoped) 자기 예약 id 매칭 — 신규 cross-CRM 접근 아님 (AC3)', () => {
    const start = RESV_PAGE.indexOf('const jumpToReservationById');
    expect(start, 'jumpToReservationById 함수 없음').toBeGreaterThan(-1);
    const block = RESV_PAGE.slice(start, start + 1200);
    expect(block, 'reservations read 조회 아님').toContain(".from('reservations')");
    expect(block, '자기 CRM clinic 스코프(clinic_id) 필터 없음').toContain(".eq('clinic_id', clinic.id)");
    expect(block, 'reservationId(id) 매칭 조회 없음').toContain(".eq('id', reservationId)");
  });

  test('S1-3: 점프 = 예약 날짜로 selectedDay/weekStart + day 뷰 + 하이라이트 + 해당 카드 scrollIntoView', () => {
    const start = RESV_PAGE.indexOf('const jumpToReservationById');
    const block = RESV_PAGE.slice(start, start + 1200);
    expect(block, '예약 날짜(reservation_date) 사용 없음').toContain('reservation_date');
    expect(block, '대상 날짜로 selectedDay 점프 없음').toContain('setSelectedDay(target)');
    expect(block, '대상 주(weekStart) 점프 없음').toContain('setWeekStart(startOfWeek(target');
    expect(block, 'day 뷰 전환 없음').toContain("setViewMode('day')");
    expect(block, '대상 예약 하이라이트(selectedResvId) 없음').toContain('setSelectedResvId(row.id)');
    expect(block, '스크롤 대기(pendingJumpScrollId) 설정 없음').toContain('setPendingJumpScrollId(row.id)');
    // 스크롤 effect + 하이라이트 렌더(기존 인프라 재사용)
    expect(RESV_PAGE, '점프 카드 scrollIntoView 경로 없음')
      .toContain('data-testid="resv-card-${pendingJumpScrollId}"');
    expect(RESV_PAGE, '선택 예약 하이라이트(ring-teal-500) 렌더 없음')
      .toContain('selectedResvId === r.id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — reservationId 미상/부재 → 목록 랜딩 (회귀 안전, AC2)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: reservationId 부재/미상/미해석 → 조용히 목록 랜딩 유지', () => {
  test('S2-1: reservationId 부재 → 수신 effect early-return(점프 미실행)', () => {
    // effect 진입 가드: reservationIdParam 없으면 즉시 return
    const idx = RESV_PAGE.indexOf('if (!reservationIdParam) return;');
    expect(idx, 'reservationId 부재 early-return 가드 없음').toBeGreaterThan(-1);
    // clinic 미준비 시에도 대기(early-return)
    const eff = RESV_PAGE.slice(idx, idx + 300);
    expect(eff, 'clinic 미준비 early-return 없음').toContain('if (!clinic) return;');
  });

  test('S2-2: 미상/미해석(조회 실패·행 없음·날짜 없음·잘못된 uuid) → 조용히 return(점프 미실행)', () => {
    const start = RESV_PAGE.indexOf('const jumpToReservationById');
    const block = RESV_PAGE.slice(start, start + 1200);
    // maybeSingle + error/데이터 없음 시 조용히 return
    expect(block, 'maybeSingle 조회 아님(단건 안전조회)').toContain('.maybeSingle()');
    expect(block, '조회 실패/행 없음 폴백(early return) 없음').toContain('if (error || !data) return;');
    // 날짜 없음/파싱 실패 폴백
    expect(block, 'reservation_date 없음 폴백 없음').toContain('if (!row.reservation_date) return;');
    expect(block, '날짜 파싱 실패(NaN) 폴백 없음').toContain('if (isNaN(target.getTime())) return;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 회귀: 기존 예약목록/캘린더 + 인접 수신부 무접촉 (AC4/AC5)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 기존 동작 회귀 0 + FE-only read', () => {
  test('S3-1: FE-only — jumpToReservationById 은 reservations read 만(write 혼입 0, db_change=false)', () => {
    const start = RESV_PAGE.indexOf('const jumpToReservationById');
    const block = RESV_PAGE.slice(start, start + 1200);
    expect(block, '딥링크 조회 함수에 insert 혼입').not.toContain('.insert(');
    expect(block, '딥링크 조회 함수에 update 혼입').not.toContain('.update(');
    expect(block, '딥링크 조회 함수에 delete 혼입').not.toContain('.delete(');
    // 예약 CRUD·집계 산식 불변 — 조회 컬럼은 표시/네비용 최소셋
    expect(block, '조회가 예약 상태 변경을 시도').not.toContain(".update({ status");
  });

  test('S3-2: 인접 수신부 무접촉 — 기존 date/nearest/detail/prefill 수신부 회귀 없음', () => {
    // ?date= 수신부 유지(딥링크 URL엔 date 없어 충돌 없음)
    expect(RESV_PAGE, "기존 ?date= 수신부(dateParam) 회귀").toContain("searchParams.get('date')");
    // nearest upcoming 뷰 점프 수신부 유지(같은 점프 인프라 공유)
    expect(RESV_PAGE, 'nearest upcoming 수신부(jumpToNearestUpcoming) 회귀').toContain('jumpToNearestUpcoming');
    expect(RESV_PAGE, '예약상세 라우팅 수신부(openReservationDetail) 회귀').toContain('openReservationDetail');
    expect(RESV_PAGE, '예약하기 바로가기 수신부(openReservationFor) 회귀').toContain('openReservationFor');
    expect(RESV_PAGE, '고객 prefill 수신부(prefillCustomerForSlot) 회귀').toContain('prefillCustomerForSlot');
  });

  test('S3-3: param 표준 정합 — reservationId(자매 crmDeeplinkRegistry TM 사이드바 딥링크와 동일)', () => {
    // 문자열 'reservationId' 표준 param 파싱 — TM 사이드바 수정/취소 딥링크도 함께 pin-point 승격
    expect(RESV_PAGE, "param 표준 'reservationId' 파싱 없음").toContain("get('reservationId')");
  });
});
