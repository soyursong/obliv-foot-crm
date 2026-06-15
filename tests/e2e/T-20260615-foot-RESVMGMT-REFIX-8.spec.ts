import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260615-foot-RESVMGMT-REFIX-8 — 풋 예약관리 레이아웃·동작 8건 리픽스
 * MQ: MSG-20260615-130038-dizc(NEW-TASK) + MSG-20260615-131441-ap23(INFO/CONSOLIDATION lf30).
 * reporter: 김주연 총괄(U0ATDB587PV). P1(AC2 배포-후-회귀 hotfix급).
 *
 * 본 spec 구현 범위 = AC1·AC5·AC6·AC7-color·AC8 (FE-only, DB 무변경, source-integrity gating).
 *   거대 인라인(Reservations.tsx) 관례 = 소스 정합 게이트. 실 렌더 검증은 supervisor field-soak(갤탭 실기기).
 *
 * 보류(코드증거 FOLLOWUP/NOTIFY 별도 발행, 본 커밋 미구현):
 *   AC2 '내 예약 시 담당자 드롭 누락' — 코드증거상 MYRESV-DEF(ac105b6)는 '담당자 드롭다운'을
 *        제거/추가한 바 없음(내예약 필터 select만 신설). 5FIX spec L24-31에 기록된 데이터소스 블로커
 *        (registrar_name = auth.uid 무연계 자유선택 마스터명)와 동일 맥락. '담당자 드롭' 정의 확정 전 추정 구현 금지 → planner FOLLOWUP.
 *   AC3 '(+) → 예약상세 팝업' — 상단 '새 예약'은 이미 newReservationMode → ReservationDetailPopup 오픈(구현 완료).
 *        슬롯 (+)는 openNewSlot(🔒L-004) = 빈슬롯 신규생성 폼, *항상 예약 미연결*. L-002 LOGIC-LOCK(신규생성 로직 삭제 금지) →
 *        임의 변경 금지, 코드증거 첨부 targeted FOLLOWUP.
 *   AC4 '일자&시간별(per-day×per-time) 집계' — 5FIX AC2(좌측 시간축 per-time-sum, a921cef) supersede 결정.
 *        일자별 헤더 합계(day-summary)는 이미 존재. per-day×per-time 최종형은 설계 결정 → supervisor NOTIFY.
 *   AC7-registrar '@예약등록자 하단우측' — registrar-tag-{id} 이미 렌더(데이터 null 의심) → FOLLOWUP에 포함.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const HOVERCARD = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 상단 컨트롤 재구성: 내예약 토글→이번주 옆 이동 + 새예약→경과분석→뷰토글 순
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 상단 컨트롤 재배치', () => {
  test('AC1-1: 내예약 select(myresv-filter)가 "이번 주" 버튼 직후(좌측 기간 그룹)로 이동', () => {
    const idxThisWeek = RESV_PAGE.indexOf("viewMode === 'week' ? '이번 주' : '오늘'");
    const idxMyResv = RESV_PAGE.indexOf('data-testid="myresv-filter"');
    const idxProgressBtn = RESV_PAGE.indexOf('data-testid="progress-filter-btn"');
    expect(idxThisWeek, '"이번 주" 토글 텍스트 누락').toBeGreaterThan(-1);
    expect(idxMyResv, 'myresv-filter 누락').toBeGreaterThan(-1);
    // 내예약 select가 '이번 주' 직후, 그리고 경과분석 버튼보다 *앞*(좌측 그룹)에 위치
    expect(idxMyResv, '내예약 select가 "이번 주"보다 앞 — 이동 미반영').toBeGreaterThan(idxThisWeek);
    expect(idxMyResv, '내예약 select가 경과분석 버튼 뒤 — 우측 그룹 잔존(이동 미반영)').toBeLessThan(idxProgressBtn);
  });

  test('AC1-2: 우측 그룹 순서 = 새 예약 → 경과분석 (새예약이 경과분석보다 앞)', () => {
    const idxNew = RESV_PAGE.indexOf('새 예약');
    const idxProgressBtn = RESV_PAGE.indexOf('data-testid="progress-filter-btn"');
    expect(idxNew, '"새 예약" 버튼 누락').toBeGreaterThan(-1);
    expect(idxNew, '새 예약이 경과분석보다 뒤 — 순서 재배치 미반영').toBeLessThan(idxProgressBtn);
  });

  test('AC1-3: AC1 의도 주석으로 추적성 확보', () => {
    expect(RESV_PAGE).toMatch(/REFIX-8 AC1[\s\S]*?이번 주/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — 일괄배치 기능 제거 (버튼 + batchCheckIn 핸들러 + dead-code)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC5: 일괄배치 제거', () => {
  test('AC5-1: batchCheckIn 핸들러 정의 제거', () => {
    expect(RESV_PAGE, 'batchCheckIn 핸들러 잔존').not.toContain('const batchCheckIn = async');
  });

  test('AC5-2: "일괄 배치" 버튼 렌더 제거', () => {
    expect(RESV_PAGE, '일괄 배치 버튼 라벨 잔존').not.toContain('일괄 배치 (');
    expect(RESV_PAGE, 'batchCheckIn 호출 잔존').not.toContain('batchCheckIn(confirmed)');
  });

  test('AC5-3: 제거 의도 주석 기록(잔존 RPC 무해 명시)', () => {
    expect(RESV_PAGE).toMatch(/REFIX-8 AC5[\s\S]*?일괄 배치[\s\S]*?제거/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC6 — 요일·일자 헤더 중앙정렬 + 폰트 확대
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC6: 헤더 중앙정렬·폰트 확대', () => {
  test('AC6-1: 날짜 헤더 th className = text-center + text-sm font-semibold', () => {
    // AC6 주석 직후 헤더 셀 base className 문자열(좌측정렬/소형 → 중앙/확대) 검증.
    const m = RESV_PAGE.match(/REFIX-8 AC6[^\n]*\n\s*'([^']*overflow-hidden[^']*)'/);
    expect(m, 'AC6 헤더 base className 문자열 파싱 실패').toBeTruthy();
    const head = m![1];
    expect(head, '헤더 중앙정렬(text-center) 누락').toContain('text-center');
    expect(head, '헤더 폰트 확대(text-sm) 누락').toContain('text-sm');
    expect(head, '헤더 굵기(font-semibold) 누락').toContain('font-semibold');
    expect(head, '구 좌측정렬(text-left) 잔존').not.toContain('text-left');
  });

  test('AC6-2: 헤더 하단 day-summary 칩도 중앙정렬(justify-center)', () => {
    const m = RESV_PAGE.match(/data-testid=\{`day-summary-[\s\S]{0,120}?className="([^"]+)"/);
    expect(m, 'day-summary className 파싱 실패').toBeTruthy();
    expect(m![1], 'day-summary 중앙정렬(justify-center) 누락').toContain('justify-center');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC7-color — 고객박스 성함 검정 통일
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC7: 성함 검정 통일', () => {
  test('AC7-1: 취소/미연결 plain span 성함 = text-gray-900', () => {
    const m = RESV_PAGE.match(/REFIX-8 AC7[\s\S]{0,120}?'font-semibold text-gray-900'/);
    expect(m, 'plain span 성함 검정(text-gray-900) 적용 누락').toBeTruthy();
  });

  test('AC7-2: CustomerHoverCard compact 트리거 성함 = text-gray-900 (활성카드 상태색 상속 차단)', () => {
    const m = HOVERCARD.match(/compact \? '([^']*text-gray-900[^']*)'/);
    expect(m, 'hovercard compact 성함 검정(text-gray-900) 적용 누락').toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC8 — 취소고객 클릭 시 별도창 차트 → 인앱 차트 패널 통일
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC8: 취소고객 인앱 차트 통일', () => {
  test('AC8-1: window.open( 차트 호출(별도창) 완전 제거 — 코드 호출 0', () => {
    // 취소 분기 span onClick이 window.open(`/chart/...`)로 별도창을 열던 코드 제거(주석 텍스트는 'window.open '로 paren 없음).
    expect(RESV_PAGE, 'window.open( 호출 잔존(별도창 차트 버그)').not.toContain('window.open(');
  });

  test('AC8-2: 취소 고객 클릭이 정상예약과 동일 인앱 차트(handleResvOpenChart)로 통일', () => {
    const m = RESV_PAGE.match(/REFIX-8 AC8[\s\S]{0,500}?handleResvOpenChart\(resvAsCheckIn\(r\)\)/);
    expect(m, 'AC8 인앱 차트(handleResvOpenChart) 동선 통일 미반영').toBeTruthy();
  });
});
