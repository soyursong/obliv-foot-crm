/**
 * T-20260629-foot-STAFFCAL-CROSSMONTH-SCHEDULE
 * 직원 근무 캘린더(파트별 인수인계, /admin/handover) — 월경계 교차 주(straddling week)
 * 직원 스케줄 0건 미표시 버그 회귀 가드.
 *
 * ── 현상 ────────────────────────────────────────────────────────────────────
 *   6월 뷰 마지막 줄(6/28~7/4)·7월 뷰 첫째 줄(동일 주)의 직원 스케줄이 통째 공백.
 *   ★ in-month 날짜(6/29·6/30)까지 공백 → "인접월 overflow 미fetch"로 설명 안 됨.
 *
 * ── 근본원인(런타임 규명) ───────────────────────────────────────────────────
 *   직원 근무 캘린더의 출근자 데이터 소스 = 구글시트(lib/dutySheet.ts 파서).
 *   시트는 "매 달 3주차 다음 달 스케줄 삽입" 규칙상, 월이 바뀌는 날짜 행
 *   (예: 29,30,1,2,3,4,5)의 빈 칼럼에 '7월' 같은 '다음 달' 라벨 셀을 함께 넣는다.
 *   extractCandidates 는 모든 행을 먼저 parseMonthHeader 로 검사하는데, 이 라벨 셀
 *   때문에 날짜 행이 'N월' 매칭 → 헤더로 오인 → continue 로 소비되어, 그 주의 날짜
 *   행이 date row 로 처리되지 못하고 → 아래 이름 행 전체가 후보에서 누락 →
 *   straddling week 통째 공백(in-month 6/29·6/30 + overflow 7/1~ 동시 소실).
 *   (실측 CSV 검증: gid=341864863, 76행 "29,30,1,2,3,4,5 … 7월" / 141행 …8월)
 *
 * ── 수정 ────────────────────────────────────────────────────────────────────
 *   parseMonthHeader 가드: 날짜 행(요일별 일자 ≥3개)은 'N월' 주석 셀이 있어도
 *   헤더가 아니다 → 헤더 판정에서 제외(날짜 행으로 처리). 월 롤오버는
 *   resolveRowDates 가 행 내부에서 직접 처리하므로 라벨 무시해도 정합. NO-DDL.
 *
 * ── 본 스펙(순수 함수 unit — auth/CSV fetch 불요, 결정론) ─────────────────────
 *   실측 시트 구조(주블록 + 3주차 '다음 달' 라벨)를 그대로 모사한 CSV 로 파서를
 *   직접 호출해 현장 클릭 시나리오 3종을 파서 레벨에서 1:1 단언한다.
 *   (직원 근무 캘린더 셀/선택일 명단은 동일 byDate 맵을 그대로 소비하므로
 *    파서 정합 = 화면 표시 정합. UI 표시 경로는 ATTENDEE-LAYOUT 스펙이 별도 가드.)
 */
import { test, expect } from '@playwright/test';
import { parseDutyAttendees, parseDutyAttendeesByDate } from '../../src/lib/dutySheet';

// 실측 시트(gid=341864863) 6월 블록 구조 모사 — 3주차 날짜 행에 '7월' 라벨 셀 동반.
//   주는 월요일 시작(월~일). 22~28(정상 6월) → 29~7/5(월경계 교차, 라벨 '7월') → 6~12(7월).
const JUNE_BLOCK_CSV = [
  '"","2026","6월","상담&코디","","","","",""',
  '"","월","화","수","목","금","토","일","",""',
  // 정상 주(전부 6월) — 헤더 인식·정상 주 무회귀 가드
  '"","22","23","24","25","26","27","28","",""',
  '"","김주연","엄경은","송지현","정연주","이가연","김지혜","휴진","",""',
  '"","김지윤","송지현","엄경은","김수린","김지윤","박민석","","",""',
  // ★ 월경계 교차 주(straddling) — 빈 칼럼에 '다음 달' 라벨 '7월' 동반(버그 트리거)
  '"","29","30","1","2","3","4","5","","7월",""',
  '"","김주연","김지윤","엄경은","송지현","정연주","박민석","휴진","",""',
  '"","엄경은","엄경은","김수린","정연주","김지윤","김규리","","",""',
  // 다음 주(전부 7월) — straddling 행을 헤더로 오인하지 않아야 컨텍스트가 7월로 정상 승계
  '"","6","7","8","9","10","11","12","",""',
  '"","총괄","송지현","엄경은","정연주","김수린","박민석","휴진","",""',
].join('\n');

test.describe('T-20260629-foot-STAFFCAL-CROSSMONTH-SCHEDULE 월경계 교차 주 직원 스케줄 표시', () => {
  // ── 현장 시나리오 1: 6월 뷰 마지막 줄(6/28~7/4) — in-month 날짜 정상 표시 (AC-1) ──
  //   버그 재현 시 6/29·6/30 이 0건이었음. 가드: in-month 날짜에 출근자 존재.
  test('S1 6월 뷰 마지막 줄 — in-month 6/29·6/30 직원 스케줄 정상 표시', () => {
    const byDate = parseDutyAttendeesByDate(JUNE_BLOCK_CSV);

    expect(byDate['2026-06-29'] ?? []).toEqual(expect.arrayContaining(['김주연', '엄경은']));
    expect(byDate['2026-06-30'] ?? []).toEqual(expect.arrayContaining(['김지윤', '엄경은']));
    // straddling week in-month 날짜는 절대 공백이면 안 됨(버그 회귀 가드)
    expect((byDate['2026-06-29'] ?? []).length).toBeGreaterThan(0);
    expect((byDate['2026-06-30'] ?? []).length).toBeGreaterThan(0);
    console.log('[CROSSMONTH] S1 in-month 6/29·6/30 표시 OK', byDate['2026-06-29'], byDate['2026-06-30']);
  });

  // ── 현장 시나리오 2: 7월 뷰 첫째 줄(6/28~7/4) — overflow(다음월) 날짜 정상 표시 (AC-2) ──
  //   동일한 한 주를 7월 뷰 첫 줄에서도 봤을 때 7/1~7/4 가 정상 표시되어야 함.
  test('S2 7월 뷰 첫째 줄 — overflow 7/1~7/4 직원 스케줄 정상 표시', () => {
    const byDate = parseDutyAttendeesByDate(JUNE_BLOCK_CSV);

    expect(byDate['2026-07-01'] ?? []).toEqual(expect.arrayContaining(['엄경은', '김수린']));
    expect(byDate['2026-07-02'] ?? []).toEqual(expect.arrayContaining(['송지현', '정연주']));
    expect(byDate['2026-07-03'] ?? []).toEqual(expect.arrayContaining(['정연주', '김지윤']));
    expect(byDate['2026-07-04'] ?? []).toEqual(expect.arrayContaining(['박민석', '김규리']));
    // 7/5(일)은 '휴진'만 → 정상적으로 빈 결과(REST 토큰 skip). overflow 무존재가 아니라 휴무.
    expect(byDate['2026-07-05'] ?? []).toHaveLength(0);
    console.log('[CROSSMONTH] S2 overflow 7/1~7/4 표시 OK');
  });

  // ── 현장 시나리오 3: 정상 주·인접 주 무회귀 + 라벨 행이 컨텍스트를 깨지 않음 (AC-4) ──
  test('S3 정상 주(6/22~)·다음 주(7/6~) 무회귀 — straddling 라벨이 월 컨텍스트 미파손', () => {
    const byDate = parseDutyAttendeesByDate(JUNE_BLOCK_CSV);

    // 정상 6월 주 — 헤더 정상 인식(6월 컨텍스트)으로 6/22 가 6월로 해석
    expect(byDate['2026-06-22'] ?? []).toEqual(expect.arrayContaining(['김주연', '김지윤']));
    expect(byDate['2026-06-26'] ?? []).toEqual(expect.arrayContaining(['이가연', '김지윤']));
    // 다음 주(7/6~): straddling 행을 헤더로 오인했다면 ctxMonth 승계가 깨져 7/6 이 비거나
    //   엉뚱한 달로 갔을 것. 정상이면 7/6(월)=총괄→김주연 치환, 7/7(화)=송지현 으로 해석.
    expect(byDate['2026-07-06'] ?? []).toEqual(expect.arrayContaining(['김주연']));
    expect(byDate['2026-07-06'] ?? []).not.toContain('총괄'); // 토큰 노출 금지
    expect(byDate['2026-07-07'] ?? []).toEqual(expect.arrayContaining(['송지현']));
    expect((byDate['2026-07-06'] ?? []).length).toBeGreaterThan(0);
    console.log('[CROSSMONTH] S3 정상 주·다음 주 무회귀 OK');
  });

  // ── AC-3: 타 월경계 교차 주(7월말~8월초, 라벨 '8월')도 동일 패턴 재현 X ──
  test('S4 타 월경계(7/27~8/2, 라벨 "8월") 교차 주도 정상 표시', () => {
    const julyBlock = [
      '"","2026","7월","상담&코디","","","","",""',
      '"","월","화","수","목","금","토","일","",""',
      '"","27","28","29","30","31","1","2","","8월"', // straddling, 라벨 '8월'
      '"","김주연","엄경은","송지현","정연주","이가연","김지혜","휴진","",""',
      '"","김수린","김지윤","엄경은","김수린","김지윤","박민석","","",""',
    ].join('\n');
    const byDate = parseDutyAttendeesByDate(julyBlock);

    // in-month 7월 + overflow 8월 모두 표시
    expect(byDate['2026-07-29'] ?? []).toEqual(expect.arrayContaining(['송지현', '엄경은']));
    expect(byDate['2026-07-31'] ?? []).toEqual(expect.arrayContaining(['이가연', '김지윤']));
    expect(byDate['2026-08-01'] ?? []).toEqual(expect.arrayContaining(['김지혜', '박민석']));
    expect((byDate['2026-07-29'] ?? []).length).toBeGreaterThan(0);
    expect((byDate['2026-08-01'] ?? []).length).toBeGreaterThan(0);
    console.log('[CROSSMONTH] S4 7→8월 경계 교차 주 표시 OK');
  });

  // ── AC-4: 진짜 월 헤더 행(요일별 일자 <3개)은 여전히 헤더로 인식 (가드 과탐지 방지) ──
  test('S5 진짜 월 헤더(연/월 행)는 여전히 헤더로 인식 — 단일 날짜 조회 회귀 없음', () => {
    // 7월 헤더 + 라벨 없는 정상 날짜 행 → 7/1 로 해석되어야(헤더 인식 정상)
    const headerCsv = [
      '"","2026","7월","상담&코디","",""',
      '"","월","화","수","목","금"',
      '"","1","2","3","4","5"',
      '"","엄경은","김수린","송지현","정연주","휴진"',
    ].join('\n');
    const jul1 = parseDutyAttendees(headerCsv, '2026-07-01');
    expect(jul1).toEqual(['엄경은']);
    // 6/1 로는 안 잡힘(7월 헤더 정상 인식 가드)
    expect(parseDutyAttendees(headerCsv, '2026-06-01')).toHaveLength(0);
    console.log('[CROSSMONTH] S5 진짜 월 헤더 인식 무회귀 OK');
  });
});
